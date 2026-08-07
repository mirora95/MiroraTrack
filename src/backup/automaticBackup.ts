import type {
  BackupResult,
  DbBackupPort,
} from "../application/ports";
import {
  AUTOMATIC_BACKUP_METADATA_ID,
  type Settings,
} from "../finance/types";
import type {
  AutomaticBackupService,
  BackupMetadataStore,
} from "../platform/backupPort";

const HOUR_MS = 60 * 60 * 1000;

export const AUTOMATIC_BACKUP_DEBOUNCE_MS = 5_000;
export const AUTOMATIC_BACKUP_FAILURE_COOLDOWN_MS = 60_000;

export interface BackupActivationSource {
  subscribe(listener: () => void): () => void;
}

export type AutomaticBackupPhase =
  | "stopped"
  | "idle"
  | "scheduled"
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "paused";

export interface AutomaticBackupStatus {
  readonly phase: AutomaticBackupPhase;
  readonly nextEligibleAt?: string;
  readonly result?: BackupResult;
}

export type AutomaticBackupOutcome =
  | {
      readonly phase: "success";
      readonly result: Extract<BackupResult, { readonly success: true }>;
    }
  | {
      readonly phase: "warning";
      readonly result: Extract<BackupResult, { readonly success: true }>;
    }
  | {
      readonly phase: "failed";
      readonly result: Extract<BackupResult, { readonly success: false }>;
    };

export interface AutomaticBackupCoordinatorDependencies {
  readonly settings: { get(): Promise<Settings> };
  readonly metadata: Pick<BackupMetadataStore, "get">;
  readonly database: Pick<DbBackupPort, "snapshotAll">;
  readonly backup: Pick<AutomaticBackupService, "create">;
  readonly activation?: BackupActivationSource;
  readonly clock?: () => Date;
  readonly debounceMs?: number;
  readonly failureCooldownMs?: number;
}

/**
 * Coordinates automatic snapshots without becoming part of the finance
 * transaction. Finance mutations only mark the coordinator dirty after their
 * own atomic commit succeeds.
 */
export class AutomaticBackupCoordinator {
  private readonly dependencies: AutomaticBackupCoordinatorDependencies;
  private readonly listeners = new Set<(status: AutomaticBackupStatus) => void>();
  private currentStatus: AutomaticBackupStatus = { phase: "stopped" };
  private started = false;
  private paused = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribeActivation: (() => void) | undefined;
  private inFlight: Promise<AutomaticBackupOutcome | undefined> | undefined;
  private dirty = false;
  private localLastSuccessAt: number | undefined;
  private localLastAttemptAt: number | undefined;

  constructor(dependencies: AutomaticBackupCoordinatorDependencies) {
    this.dependencies = dependencies;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.paused = false;
    this.generation += 1;
    this.unsubscribeActivation = this.dependencies.activation?.subscribe(
      () => this.onActivation(),
    );
    this.publish({ phase: "idle" });
    this.requestRecalculation(this.generation);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.paused = false;
    this.dirty = false;
    this.generation += 1;
    this.clearTimer();
    this.unsubscribeActivation?.();
    this.unsubscribeActivation = undefined;
    this.publish({ phase: "stopped" });
  }

  pause(): Promise<void> {
    if (!this.started || this.paused) {
      return this.inFlight?.then(() => undefined) ?? Promise.resolve();
    }
    this.paused = true;
    this.dirty = false;
    this.generation += 1;
    this.clearTimer();
    this.publish({ phase: "paused" });
    return this.inFlight?.then(() => undefined) ?? Promise.resolve();
  }

  resume(): void {
    if (!this.started || !this.paused) return;
    this.paused = false;
    this.generation += 1;
    this.publish({ phase: "idle" });
    this.requestRecalculation(this.generation);
  }

  notifyStructuredDataChanged(): void {
    if (!this.started || this.paused) return;
    this.dirty = true;
    if (this.inFlight) return;
    this.scheduleDirty();
  }

  retryNow(): Promise<AutomaticBackupOutcome> {
    return this.run(true);
  }

  status(): AutomaticBackupStatus {
    return this.currentStatus;
  }

  subscribe(
    listener: (status: AutomaticBackupStatus) => void,
  ): () => void {
    this.listeners.add(listener);
    notifyListener(listener, this.currentStatus);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private onActivation(): void {
    if (!this.started || this.paused || this.inFlight || this.dirty) return;
    this.requestRecalculation(this.generation);
  }

  private scheduleDirty(): void {
    if (!this.started || this.paused || !this.dirty) return;
    this.clearTimer();
    const generation = this.generation;
    this.publish({
      phase: "scheduled",
      nextEligibleAt: new Date(
        this.now() + (this.dependencies.debounceMs ??
          AUTOMATIC_BACKUP_DEBOUNCE_MS),
      ).toISOString(),
    });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.isCurrent(generation)) return;
      this.dirty = false;
      void this.run(false);
    }, this.dependencies.debounceMs ?? AUTOMATIC_BACKUP_DEBOUNCE_MS);
  }

  private run(manual: true): Promise<AutomaticBackupOutcome>;
  private run(manual: false): Promise<AutomaticBackupOutcome | undefined>;
  private run(manual: boolean): Promise<AutomaticBackupOutcome | undefined> {
    if (this.inFlight) return this.inFlight;
    if (this.paused) {
      return Promise.resolve(manual ? failedOutcome() : undefined);
    }

    const generation = this.generation;
    this.clearTimer();
    this.dirty = false;
    const operation = this.execute(manual, generation)
      .catch((): AutomaticBackupOutcome => {
        this.localLastAttemptAt = this.now();
        const outcome = failedOutcome();
        if (this.isCurrent(generation)) this.publish(outcome);
        return outcome;
      })
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = undefined;
        if (!this.started || this.paused) return;
        if (this.dirty) {
          this.scheduleDirty();
        } else {
          this.requestRecalculation(this.generation);
        }
      });
    this.inFlight = operation;
    return operation;
  }

  private async execute(
    manual: boolean,
    generation: number,
  ): Promise<AutomaticBackupOutcome | undefined> {
    const settings = await this.dependencies.settings.get();
    if (!manual && !settings.automaticBackupsEnabled) {
      if (this.isCurrent(generation)) this.publish({ phase: "idle" });
      return undefined;
    }
    if (!manual && !this.isCurrent(generation)) return undefined;

    const attemptedAt = this.now();
    this.localLastAttemptAt = attemptedAt;
    if (this.isCurrent(generation)) this.publish({ phase: "running" });
    const snapshot = await this.dependencies.database.snapshotAll(
      new Date(attemptedAt).toISOString(),
    );
    const result = await this.dependencies.backup.create(
      snapshot,
      settings.backupFolderPath,
    );
    if (result.success) this.localLastSuccessAt = attemptedAt;
    const outcome: AutomaticBackupOutcome = result.success
      ? {
          phase: result.warning === undefined ? "success" : "warning",
          result,
        }
      : { phase: "failed", result };
    if (this.isCurrent(generation)) this.publish(outcome);
    return outcome;
  }

  private async recalculate(generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.dirty || this.inFlight) return;
    const [settings, stored] = await Promise.all([
      this.dependencies.settings.get(),
      this.dependencies.metadata.get(AUTOMATIC_BACKUP_METADATA_ID),
    ]);
    if (!this.isCurrent(generation) || this.dirty || this.inFlight) return;
    this.clearTimer();
    if (!settings.automaticBackupsEnabled) {
      if (!isTerminal(this.currentStatus)) this.publish({ phase: "idle" });
      return;
    }

    const now = this.now();
    const interval = settings.automaticBackupIntervalHours * HOUR_MS;
    const storedSuccess = timestamp(stored?.lastSuccessfulAt);
    const success = latest(storedSuccess, this.localLastSuccessAt);
    const normalDue = success === undefined ? now : success + interval;
    const storedAttempt = timestamp(stored?.lastAttemptAt);
    const attempt = latest(storedAttempt, this.localLastAttemptAt);
    const failed = stored?.status === "failed" ||
      (this.localLastAttemptAt !== undefined &&
        this.localLastSuccessAt !== this.localLastAttemptAt);
    const due = failed && attempt !== undefined
      ? attempt + (this.dependencies.failureCooldownMs ??
          AUTOMATIC_BACKUP_FAILURE_COOLDOWN_MS)
      : normalDue;

    if (due <= now) {
      void this.run(false);
      return;
    }
    const nextEligibleAt = new Date(due).toISOString();
    this.publish(isTerminal(this.currentStatus)
      ? { ...this.currentStatus, nextEligibleAt }
      : { phase: "scheduled", nextEligibleAt });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.isCurrent(generation)) void this.run(false);
    }, Math.min(due - now, 2_147_483_647));
  }

  private publish(status: AutomaticBackupStatus): void {
    this.currentStatus = status;
    for (const listener of this.listeners) notifyListener(listener, status);
  }

  private requestRecalculation(generation: number): void {
    void this.recalculate(generation).catch(() => {
      if (this.isCurrent(generation) && !isTerminal(this.currentStatus)) {
        this.publish({ phase: "idle" });
      }
    });
  }

  private isCurrent(generation: number): boolean {
    return this.started && !this.paused && generation === this.generation;
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private now(): number {
    return (this.dependencies.clock ?? (() => new Date()))().getTime();
  }
}

function failedOutcome(): AutomaticBackupOutcome {
  return {
    phase: "failed",
    result: {
      success: false,
      errorCode: "UNKNOWN",
      message: "Automatic backup could not be completed",
    },
  };
}

function isTerminal(
  status: AutomaticBackupStatus,
): status is AutomaticBackupOutcome & AutomaticBackupStatus {
  return status.phase === "success" ||
    status.phase === "warning" ||
    status.phase === "failed";
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function latest(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function notifyListener(
  listener: (status: AutomaticBackupStatus) => void,
  status: AutomaticBackupStatus,
): void {
  try {
    listener(status);
  } catch {
    // A presentation listener must never interrupt backup persistence.
  }
}
