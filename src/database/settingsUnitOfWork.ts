import type {
  SettingsReadPort,
  SettingsSnapshot,
  SettingsUnitOfWork,
} from "../application/ports";
import { ValidationError } from "../application/validation";
import type { Settings } from "../finance/types";
import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
  type MiroraTrackDatabase,
} from "./db";

export type SettingsUnitOfWorkStage =
  | "afterSettings"
  | "afterMetadata"
  | "afterCacheClear"
  | "beforeCommit";

export class DexieSettingsRepository
implements SettingsReadPort, SettingsUnitOfWork {
  private readonly db: MiroraTrackDatabase;
  private readonly options: {
    readonly clock?: () => string;
    readonly onStage?: (stage: SettingsUnitOfWorkStage) => void;
  };

  constructor(
    db: MiroraTrackDatabase,
    options: {
      readonly clock?: () => string;
      readonly onStage?: (stage: SettingsUnitOfWorkStage) => void;
    } = {},
  ) {
    this.db = db;
    this.options = options;
  }

  async getSettingsSnapshot(): Promise<SettingsSnapshot> {
    return this.db.transaction(
      "r",
      this.db.settings,
      this.db.metadata,
      async () => {
        const settings = await this.db.settings.get("primary");
        const metadata = await this.db.metadata.get(APP_METADATA_KEY);
        if (!settings || !metadata) throw new Error("Application settings are missing");
        return { settings, revision: metadata.ledgerRevision };
      },
    );
  }

  async replaceSettings(
    expected: Settings,
    next: Settings,
    expectedRevision: number,
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.settings,
      this.db.metadata,
      this.db.calculationCaches,
      async () => {
        const [current, metadata] = await Promise.all([
          this.db.settings.get("primary"),
          this.db.metadata.get(APP_METADATA_KEY),
        ]);
        if (
          !current ||
          canonical(current) !== canonical(expected) ||
          !metadata ||
          metadata.ledgerRevision !== expectedRevision
        ) {
          throw new ValidationError("CONCURRENT_MODIFICATION", "settings");
        }
        if (
          metadata.schemaVersion !== DATABASE_VERSION ||
          metadata.calculationVersion !== CALCULATION_VERSION ||
          metadata.ledgerRevision === Number.MAX_SAFE_INTEGER
        ) throw new Error("App metadata is invalid");
        await this.db.settings.put(next);
        this.options.onStage?.("afterSettings");
        await this.db.metadata.put({
          ...metadata,
          ledgerRevision: metadata.ledgerRevision + 1,
          updatedAt: (this.options.clock ?? (() => new Date().toISOString()))(),
        });
        this.options.onStage?.("afterMetadata");
        await this.db.calculationCaches.clear();
        this.options.onStage?.("afterCacheClear");
        this.options.onStage?.("beforeCommit");
      },
    );
  }
}

export class DexieSettingsUnitOfWork extends DexieSettingsRepository {}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
