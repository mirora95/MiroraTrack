import type { MiroraTrackDatabase } from "../database/db";
import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
} from "../database/db";
import { validateSettings } from "../application/settingsService";

export type StartupPreparationResult =
  | { readonly status: "ready" }
  | {
      readonly status: "recovery-required";
      readonly reason:
        | "invalid-metadata"
        | "invalid-settings"
        | "startup-preparation-failed";
    };

export interface StartupPreparationOptions {
  readonly beforeCommit?: () => void | Promise<void>;
}

export async function prepareDatabaseForStartup(
  db: MiroraTrackDatabase,
  options: StartupPreparationOptions = {},
): Promise<StartupPreparationResult> {
  try {
    return await db.transaction(
      "rw",
      db.metadata,
      db.settings,
      db.accounts,
      db.calculationCaches,
      async () => {
        const [metadata, settings, accounts] = await Promise.all([
          db.metadata.get(APP_METADATA_KEY),
          db.settings.get("primary"),
          db.accounts.toArray(),
        ]);
        if (
          !metadata ||
          !hasExactlyKeys(metadata, [
            "key",
            "schemaVersion",
            "calculationVersion",
            "ledgerRevision",
            "createdAt",
            "updatedAt",
          ]) ||
          metadata.key !== APP_METADATA_KEY ||
          metadata.schemaVersion !== DATABASE_VERSION ||
          metadata.calculationVersion !== CALCULATION_VERSION ||
          !Number.isSafeInteger(metadata.ledgerRevision) ||
          metadata.ledgerRevision < 0 ||
          !isIsoDate(metadata.createdAt) ||
          !isIsoDate(metadata.updatedAt)
        ) {
          return {
            status: "recovery-required",
            reason: "invalid-metadata",
          } as const;
        }
        if (settings !== undefined) {
          try {
            validateSettings(settings);
            if (
              accounts.length === 0 ||
              (settings.defaultAccountId !== undefined &&
                !accounts.some(({ id }) => id === settings.defaultAccountId))
            ) {
              throw new Error("Settings reference an unavailable account");
            }
          } catch {
            return {
              status: "recovery-required",
              reason: "invalid-settings",
            } as const;
          }
        } else if (accounts.length > 0) {
          return {
            status: "recovery-required",
            reason: "invalid-settings",
          } as const;
        }

        const staleKeys = (await db.calculationCaches.toArray())
          .filter(
            (cache) =>
              cache.calculationVersion !== metadata.calculationVersion ||
              cache.sourceRevision !== metadata.ledgerRevision,
          )
          .map(({ key }) => key);
        if (staleKeys.length > 0) {
          await db.calculationCaches.bulkDelete(staleKeys);
        }
        await options.beforeCommit?.();
        return { status: "ready" } as const;
      },
    );
  } catch {
    return {
      status: "recovery-required",
      reason: "startup-preparation-failed",
    };
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function hasExactlyKeys(
  value: object,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

export interface PostRenderScheduler {
  readonly requestIdle?: (callback: () => void) => number;
  readonly cancelIdle?: (handle: number) => void;
  readonly setFallback: (callback: () => void) => number;
  readonly clearFallback: (handle: number) => void;
}

export function scheduleAfterFirstRender(
  callback: () => void,
  scheduler: Partial<PostRenderScheduler> = {},
): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) callback();
  };
  const requestIdle =
    scheduler.requestIdle ??
    (typeof window !== "undefined" &&
    typeof window.requestIdleCallback === "function"
      ? (task: () => void) => window.requestIdleCallback(task)
      : undefined);
  const cancelIdle =
    scheduler.cancelIdle ??
    (typeof window !== "undefined" &&
    typeof window.cancelIdleCallback === "function"
      ? (handle: number) => window.cancelIdleCallback(handle)
      : undefined);
  const setFallback =
    scheduler.setFallback ??
    ((task: () => void) => window.setTimeout(task, 0));
  const clearFallback =
    scheduler.clearFallback ??
    ((handle: number) => window.clearTimeout(handle));

  if (requestIdle) {
    const handle = requestIdle(run);
    return () => {
      cancelled = true;
      cancelIdle?.(handle);
    };
  }
  const handle = setFallback(run);
  return () => {
    cancelled = true;
    clearFallback(handle);
  };
}
