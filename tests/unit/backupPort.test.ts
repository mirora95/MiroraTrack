import { describe, expect, it, vi } from "vitest";

import type { BackupEnvelope } from "../../src/backup/schema";
import {
  AutomaticBackupService,
  BackupPortError,
  TauriBackupPort,
  type NativeInvoke,
} from "../../src/platform/backupPort";
import type { BackupMetadata } from "../../src/finance/types";

const iso = "2026-07-29T08:30:00.000Z";

function envelope(): BackupEnvelope {
  return {
    app: "MiroraTrack",
    schemaVersion: 4,
    exportedAt: iso,
    data: {
      metadata: [{
        key: "app",
        schemaVersion: 5,
        calculationVersion: 2,
        ledgerRevision: 0,
        createdAt: iso,
        updatedAt: iso,
      }],
      settings: [{
        key: "primary",
        baseCurrency: "USD" as never,
        locale: "en-US",
        dateFormat: "yyyy-MM-dd",
        automaticBackupsEnabled: true,
        automaticBackupIntervalHours: 24,
      }],
      accounts: [],
      transactions: [],
      budgets: [],
      auditEntries: [],
      backupMetadata: [],
      calculationCaches: [],
    },
  };
}

describe("TauriBackupPort", () => {
  it.each([
    ["createAutomaticBackup", "automatic"],
    ["createSafetyBackup", "safety"],
  ] as const)("routes %s through create_backup with a canonical payload and distinct purpose", async (method, purpose) => {
    const invoke = vi.fn<NativeInvoke>().mockResolvedValue({
      path: "C:\\Backups\\snapshot.json",
      directory: "C:\\Backups",
    });
    const port = new TauriBackupPort(invoke);

    await expect(port[method](envelope(), "C:\\Backups")).resolves.toEqual({
      success: true,
      path: "C:\\Backups\\snapshot.json",
      directory: "C:\\Backups",
    });
    expect(invoke).toHaveBeenCalledWith("create_backup", {
      payload: expect.stringMatching(/^\{"app":"MiroraTrack"/),
      configuredDirectory: "C:\\Backups",
      purpose,
    });
  });

  it("routes JSON and CSV exports through their bounded native commands", async () => {
    const invoke = vi.fn<NativeInvoke>()
      .mockResolvedValueOnce({ path: "C:\\Exports\\data.json", directory: "C:\\Exports" })
      .mockResolvedValueOnce({ path: "C:\\Exports\\data.csv", directory: "C:\\Exports" });
    const port = new TauriBackupPort(invoke);

    await port.exportJson(envelope());
    await port.exportCsv("id,amount\r\none,1.00\r\n");

    expect(invoke).toHaveBeenNthCalledWith(1, "export_json", {
      payload: expect.stringMatching(/^\{"app":"MiroraTrack"/),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "export_csv", {
      csv: "id,amount\r\none,1.00\r\n",
    });
  });

  it("returns null when folder, export, or import dialogs are cancelled", async () => {
    const invoke = vi.fn<NativeInvoke>().mockResolvedValue(null);
    const port = new TauriBackupPort(invoke);

    await expect(port.chooseBackupFolder()).resolves.toBeNull();
    await expect(port.exportJson(envelope())).resolves.toBeNull();
    await expect(port.exportCsv("id\r\n")).resolves.toBeNull();
    await expect(port.importJson()).resolves.toBeNull();

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "choose_backup_directory", "export_json", "export_csv", "import_json",
    ]);
  });

  it("maps native command failures to the closed safe error union", async () => {
    const invoke = vi.fn<NativeInvoke>()
      .mockRejectedValueOnce({ code: "PERMISSION_DENIED", message: "Access denied" })
      .mockRejectedValueOnce({ code: "NOT_A_REAL_CODE", message: "C:\\private\\secret" });
    const port = new TauriBackupPort(invoke);

    await expect(port.createAutomaticBackup(envelope())).resolves.toEqual({
      success: false,
      errorCode: "PERMISSION_DENIED",
      message: "Access denied",
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "create_backup", expect.objectContaining({
      configuredDirectory: null,
      purpose: "automatic",
    }));
    await expect(port.chooseBackupFolder()).rejects.toMatchObject({
      name: "BackupPortError",
      code: "UNKNOWN",
      message: "Backup operation failed",
    });
  });

  it("preserves a retention warning as a successful durable backup", async () => {
    const invoke = vi.fn<NativeInvoke>().mockResolvedValue({
      path: "C:\\Backups\\snapshot.json",
      directory: "C:\\Backups",
      warning: {
        code: "RETENTION_WARNING",
        message: "The backup was saved, but retention failed",
      },
    });

    await expect(new TauriBackupPort(invoke).createAutomaticBackup(envelope()))
      .resolves.toEqual({
        success: true,
        path: "C:\\Backups\\snapshot.json",
        directory: "C:\\Backups",
        warning: {
          code: "RETENTION_WARNING",
          message: "The backup was saved, but retention failed",
        },
      });
  });

  it("maps typed import failures to BackupPortError without returning a partial value", async () => {
    const invoke = vi.fn<NativeInvoke>().mockRejectedValue({
      code: "FILE_TOO_LARGE",
      message: "The selected file exceeds the 100 MiB limit",
    });

    await expect(new TauriBackupPort(invoke).importJson()).rejects.toEqual(
      new BackupPortError("FILE_TOO_LARGE", "The selected file exceeds the 100 MiB limit"),
    );
  });

  it("parses imported JSON text without interpreting finance records", async () => {
    const invoke = vi.fn<NativeInvoke>().mockResolvedValue({
      content: "{\"app\":\"MiroraTrack\",\"schemaVersion\":99}",
    });

    await expect(new TauriBackupPort(invoke).importJson()).resolves.toEqual({
      app: "MiroraTrack",
      schemaVersion: 99,
    });
  });
});

describe("AutomaticBackupService metadata", () => {
  it("records the attempt and completed automatic backup facts", async () => {
    const put = vi.fn();
    const metadata = { get: vi.fn().mockResolvedValue(undefined), put };
    const backups = {
      createAutomaticBackup: vi.fn().mockResolvedValue({
        success: true,
        path: "C:\\Backups\\snapshot.json",
        directory: "C:\\Backups",
      }),
    };

    const result = await new AutomaticBackupService(backups, metadata, () => iso)
      .create(envelope(), "C:\\Backups");

    expect(result.success).toBe(true);
    expect(put).toHaveBeenCalledWith({
      id: "automatic",
      folderPath: "C:\\Backups",
      lastAttemptAt: iso,
      lastSuccessfulAt: iso,
      status: "success",
      schemaVersion: 5,
    });
  });

  it("preserves the previous successful time and folder when an attempt fails", async () => {
    const previous: BackupMetadata = {
      id: "automatic" as never,
      folderPath: "D:\\Safe",
      lastAttemptAt: "2026-07-28T01:00:00.000Z",
      lastSuccessfulAt: "2026-07-28T01:00:00.000Z",
      status: "success",
      schemaVersion: 5,
    };
    const put = vi.fn();
    const metadata = { get: vi.fn().mockResolvedValue(previous), put };
    const backups = {
      createAutomaticBackup: vi.fn().mockResolvedValue({
        success: false,
        errorCode: "WRITE_FAILED",
        message: "Could not write the backup",
      }),
    };

    const result = await new AutomaticBackupService(backups, metadata, () => iso)
      .create(envelope(), "E:\\Unavailable");

    expect(result.success).toBe(false);
    expect(put).toHaveBeenCalledWith({
      ...previous,
      lastAttemptAt: iso,
      status: "failed",
      errorCode: "WRITE_FAILED",
      errorMessage: "Could not write the backup",
    });
  });

  it("does not retain a stale failure message when the latest failure has none", async () => {
    const previous: BackupMetadata = {
      id: "automatic" as never,
      lastSuccessfulAt: "2026-07-28T01:00:00.000Z",
      status: "failed",
      schemaVersion: 5,
      errorCode: "WRITE_FAILED",
      errorMessage: "Old failure",
    };
    const put = vi.fn();
    const service = new AutomaticBackupService(
      {
        createAutomaticBackup: vi.fn().mockResolvedValue({
          success: false,
          errorCode: "DIRECTORY_UNAVAILABLE",
        }),
      },
      { get: vi.fn().mockResolvedValue(previous), put },
      () => iso,
    );

    await service.create(envelope());

    expect(put).toHaveBeenCalledWith(expect.not.objectContaining({
      errorMessage: "Old failure",
    }));
  });

  it("records a durable retention warning without losing successful status facts", async () => {
    const put = vi.fn();
    const service = new AutomaticBackupService(
      {
        createAutomaticBackup: vi.fn().mockResolvedValue({
          success: true,
          path: "C:\\Backups\\snapshot.json",
          directory: "C:\\Backups",
          warning: {
            code: "RETENTION_WARNING",
            message: "Old backups could not be pruned",
          },
        }),
      },
      { get: vi.fn().mockResolvedValue(undefined), put },
      () => iso,
    );
    await service.create(envelope());
    expect(put).toHaveBeenCalledWith({
      id: "automatic",
      folderPath: "C:\\Backups",
      lastAttemptAt: iso,
      lastSuccessfulAt: iso,
      status: "warning",
      schemaVersion: 5,
      warningCode: "RETENTION_WARNING",
      warningMessage: "Old backups could not be pruned",
    });
  });

  it("clears stale warning fields after a later failure", async () => {
    const previous: BackupMetadata = {
      id: "automatic" as never,
      folderPath: "D:\\Safe",
      lastSuccessfulAt: iso,
      status: "warning",
      schemaVersion: 5,
      warningCode: "RETENTION_WARNING",
      warningMessage: "Old warning",
    };
    const put = vi.fn();
    const service = new AutomaticBackupService(
      {
        createAutomaticBackup: vi.fn().mockResolvedValue({
          success: false,
          errorCode: "WRITE_FAILED",
        }),
      },
      { get: vi.fn().mockResolvedValue(previous), put },
      () => iso,
    );
    await service.create(envelope());
    expect(put).toHaveBeenCalledWith(expect.not.objectContaining({
      warningCode: expect.anything(),
      warningMessage: expect.anything(),
    }));
  });
});
