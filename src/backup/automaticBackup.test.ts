import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BackupEnvelope } from "./schema";
import {
  AutomaticBackupCoordinator,
  AUTOMATIC_BACKUP_DEBOUNCE_MS,
  AUTOMATIC_BACKUP_FAILURE_COOLDOWN_MS,
  type BackupActivationSource,
} from "./automaticBackup";
import type { BackupMetadata, Settings } from "../finance/types";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function settings(
  overrides: Partial<Settings> = {},
): Settings {
  return {
    key: "primary",
    baseCurrency: "USD" as Settings["baseCurrency"],
    locale: "en-US",
    dateFormat: "yyyy-MM-dd",
    automaticBackupsEnabled: true,
    automaticBackupIntervalHours: 24,
    ...overrides,
  };
}

function metadata(
  overrides: Partial<BackupMetadata> = {},
): BackupMetadata {
  return {
    id: "automatic" as BackupMetadata["id"],
    status: "success",
    schemaVersion: 5,
    lastAttemptAt: new Date(NOW.getTime() - HOUR).toISOString(),
    lastSuccessfulAt: new Date(NOW.getTime() - HOUR).toISOString(),
    ...overrides,
  };
}

function setup(options: {
  readonly currentSettings?: Settings;
  readonly currentMetadata?: BackupMetadata | undefined;
  readonly activation?: BackupActivationSource;
} = {}) {
  let currentSettings = options.currentSettings ?? settings();
  let currentMetadata = options.currentMetadata;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const snapshot = {} as BackupEnvelope;
  const database = {
    snapshotAll: vi.fn().mockResolvedValue(snapshot),
  };
  const backup = {
    create: vi.fn().mockResolvedValue({
      success: true as const,
      path: "D:\\Backups\\backup.json",
      directory: "D:\\Backups",
    }),
  };
  const metadataStore = {
    get: vi.fn(async () => currentMetadata),
  };
  const settingsStore = {
    get: vi.fn(async () => currentSettings),
  };
  const coordinator = new AutomaticBackupCoordinator({
    settings: settingsStore,
    metadata: metadataStore,
    database,
    backup,
    ...(options.activation === undefined ? {} : { activation: options.activation }),
    clock: () => new Date(Date.now()),
  });
  return {
    coordinator,
    database,
    backup,
    metadataStore,
    settingsStore,
    pending,
    release,
    setSettings(value: Settings) { currentSettings = value; },
    setMetadata(value: BackupMetadata | undefined) { currentMetadata = value; },
  };
}

describe("AutomaticBackupCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("backs up on start when no successful backup exists", async () => {
    const subject = setup({ currentMetadata: undefined });

    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(subject.database.snapshotAll).toHaveBeenCalledWith(NOW.toISOString());
    expect(subject.backup.create).toHaveBeenCalledTimes(1);
  });

  it("waits until the persisted success interval and recalculates without setInterval drift", async () => {
    const lastSuccess = new Date(NOW.getTime() - 23 * HOUR).toISOString();
    const subject = setup({ currentMetadata: metadata({
      lastAttemptAt: lastSuccess,
      lastSuccessfulAt: lastSuccess,
    }) });

    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.backup.create).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(subject.backup.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(subject.backup.create).toHaveBeenCalledTimes(1);
  });

  it("treats warning metadata as a successful interval anchor", async () => {
    const subject = setup({ currentMetadata: metadata({ status: "warning" }) });

    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(subject.backup.create).not.toHaveBeenCalled();
  });

  it("debounces and coalesces successful structured mutations", async () => {
    const subject = setup({ currentMetadata: metadata() });
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    subject.coordinator.notifyStructuredDataChanged();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_BACKUP_DEBOUNCE_MS - 1);
    subject.coordinator.notifyStructuredDataChanged();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_BACKUP_DEBOUNCE_MS - 1);
    expect(subject.backup.create).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(subject.backup.create).toHaveBeenCalledTimes(1);
  });

  it("shares an in-flight promise and schedules one trailing dirty backup", async () => {
    const subject = setup({ currentMetadata: metadata() });
    subject.backup.create.mockReturnValueOnce(subject.pending.then(() => ({
      success: true as const,
      path: "D:\\Backups\\one.json",
      directory: "D:\\Backups",
    })));
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    const first = subject.coordinator.retryNow();
    const second = subject.coordinator.retryNow();
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    subject.coordinator.notifyStructuredDataChanged();
    subject.coordinator.notifyStructuredDataChanged();
    subject.release();
    await first;

    await vi.advanceTimersByTimeAsync(AUTOMATIC_BACKUP_DEBOUNCE_MS);
    expect(subject.backup.create).toHaveBeenCalledTimes(2);
  });

  it("records failures through the service, swallows them, and observes cooldown", async () => {
    const failedAt = NOW.toISOString();
    const withSuccess = metadata({
      status: "failed",
      lastAttemptAt: failedAt,
      errorCode: "PERMISSION_DENIED",
    });
    const { lastSuccessfulAt: _removed, ...failed } = withSuccess;
    const subject = setup({ currentMetadata: failed });
    subject.backup.create.mockRejectedValueOnce(new Error("native failure"));

    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_BACKUP_FAILURE_COOLDOWN_MS - 1);
    expect(subject.backup.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(subject.backup.create).toHaveBeenCalledTimes(1);
    await expect(subject.coordinator.retryNow()).resolves.toMatchObject({
      phase: "success",
      result: { success: true },
    });
  });

  it("manual retry bypasses disabled scheduling and remains single-flight", async () => {
    const subject = setup({
      currentSettings: settings({ automaticBackupsEnabled: false }),
      currentMetadata: undefined,
    });
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.backup.create).not.toHaveBeenCalled();

    await expect(subject.coordinator.retryNow()).resolves.toMatchObject({
      phase: "success",
      result: { success: true },
    });
    expect(subject.backup.create).toHaveBeenCalledTimes(1);
  });

  it("returns typed warning and failure outcomes without throwing into callers", async () => {
    const warning = setup({
      currentSettings: settings({ automaticBackupsEnabled: false }),
    });
    warning.backup.create.mockResolvedValueOnce({
      success: true as const,
      path: "D:\\Backups\\warning.json",
      directory: "D:\\Backups",
      warning: { code: "RETENTION_WARNING" as const },
    });
    warning.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    await expect(warning.coordinator.retryNow()).resolves.toMatchObject({
      phase: "warning",
      result: { success: true, warning: { code: "RETENTION_WARNING" } },
    });

    const failed = setup({
      currentSettings: settings({ automaticBackupsEnabled: false }),
    });
    failed.backup.create.mockResolvedValueOnce({
      success: false as const,
      errorCode: "PERMISSION_DENIED" as const,
      message: "Backup folder permission was denied",
    });
    failed.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    await expect(failed.coordinator.retryNow()).resolves.toMatchObject({
      phase: "failed",
      result: { success: false, errorCode: "PERMISSION_DENIED" },
    });
  });

  it("returns and publishes a safe failed outcome when snapshot or metadata persistence throws", async () => {
    const snapshotFailure = setup({
      currentSettings: settings({ automaticBackupsEnabled: false }),
    });
    snapshotFailure.database.snapshotAll.mockRejectedValueOnce(
      new Error("private internal path"),
    );
    snapshotFailure.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    await expect(snapshotFailure.coordinator.retryNow()).resolves.toEqual({
      phase: "failed",
      result: {
        success: false,
        errorCode: "UNKNOWN",
        message: "Automatic backup could not be completed",
      },
    });
    expect(snapshotFailure.coordinator.status()).toEqual({
      phase: "failed",
      result: expect.objectContaining({ success: false }),
    });

    const metadataFailure = setup({
      currentSettings: settings({ automaticBackupsEnabled: false }),
    });
    metadataFailure.metadataStore.get
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("metadata read also failed"));
    metadataFailure.backup.create.mockRejectedValueOnce(
      new Error("metadata persistence failed"),
    );
    metadataFailure.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    await expect(metadataFailure.coordinator.retryNow()).resolves.toMatchObject({
      phase: "failed",
      result: { success: false, errorCode: "UNKNOWN" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(metadataFailure.coordinator.status()).toMatchObject({
      phase: "failed",
      result: { success: false, errorCode: "UNKNOWN" },
    });
  });

  it("start and stop are idempotent and activation listeners are StrictMode safe", async () => {
    let listener: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const activation: BackupActivationSource = {
      subscribe: vi.fn((next) => {
        listener = next;
        return unsubscribe;
      }),
    };
    const subject = setup({
      currentMetadata: metadata(),
      activation,
    });

    subject.coordinator.start();
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(activation.subscribe).toHaveBeenCalledTimes(1);

    listener?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.backup.create).not.toHaveBeenCalled();

    subject.coordinator.stop();
    subject.coordinator.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(activation.subscribe).toHaveBeenCalledTimes(2);
  });

  it("recovers scheduling when StrictMode restarts during an in-flight backup", async () => {
    const subject = setup({ currentMetadata: undefined });
    subject.backup.create.mockReturnValueOnce(subject.pending.then(() => ({
      success: true as const,
      path: "D:\\Backups\\one.json",
      directory: "D:\\Backups",
    })));
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.backup.create).toHaveBeenCalledTimes(1);

    subject.coordinator.stop();
    subject.coordinator.start();
    subject.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(subject.coordinator.status()).toEqual(expect.objectContaining({
      phase: "scheduled",
    }));
    expect(vi.getTimerCount()).toBe(1);
  });

  it("tolerates missing onboarding settings and backs up after the successful initialization notification", async () => {
    const subject = setup({ currentMetadata: undefined });
    subject.settingsStore.get.mockRejectedValueOnce(
      new Error("Application settings are missing"),
    );

    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.backup.create).not.toHaveBeenCalled();

    subject.coordinator.notifyStructuredDataChanged();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_BACKUP_DEBOUNCE_MS);
    expect(subject.backup.create).toHaveBeenCalledTimes(1);
  });

  it("pause discards pending work and resume reevaluates eligibility", async () => {
    const subject = setup({ currentMetadata: metadata() });
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);
    subject.coordinator.notifyStructuredDataChanged();
    subject.coordinator.pause();
    await vi.advanceTimersByTimeAsync(AUTOMATIC_BACKUP_DEBOUNCE_MS);
    expect(subject.backup.create).not.toHaveBeenCalled();

    subject.coordinator.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(subject.backup.create).not.toHaveBeenCalled();
  });

  it("publishes status changes and supports idempotent unsubscribe", async () => {
    const subject = setup({ currentMetadata: undefined });
    const listener = vi.fn();
    const unsubscribe = subject.coordinator.subscribe(listener);
    subject.coordinator.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      phase: "running",
    }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      phase: "success",
    }));
    unsubscribe();
    unsubscribe();
  });

  it("isolates subscriber failures from backup scheduling", async () => {
    const subject = setup({ currentMetadata: undefined });
    subject.coordinator.subscribe(() => {
      throw new Error("subscriber failed");
    });

    expect(() => subject.coordinator.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    expect(subject.backup.create).toHaveBeenCalledTimes(1);
  });
});
