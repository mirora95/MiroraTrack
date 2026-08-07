import { describe, expect, it, vi } from "vitest";

import { DataManagementService } from "./dataManagementService";

const currentSettings = {
  key: "primary" as const,
  baseCurrency: "USD" as never,
  locale: "en-US",
  dateFormat: "yyyy-MM-dd",
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24 as const,
  backupFolderPath: "D:\\Backups",
};

function envelope() {
  return {
    app: "MiroraTrack" as const,
    schemaVersion: 4 as const,
    exportedAt: "2026-07-29T10:00:00.000Z",
    data: {
      metadata: [{
        key: "app" as const, schemaVersion: 5, calculationVersion: 2,
        ledgerRevision: 1, createdAt: "2026-07-28T10:00:00.000Z",
        updatedAt: "2026-07-29T10:00:00.000Z",
      }],
      settings: [currentSettings],
      accounts: [], transactions: [], budgets: [], auditEntries: [],
      backupMetadata: [], calculationCaches: [],
    },
  };
}

function dependencies() {
  return {
    database: { snapshotAll: vi.fn().mockResolvedValue(envelope()) },
    backups: {
      exportJson: vi.fn().mockResolvedValue(null),
      exportCsv: vi.fn().mockResolvedValue(null),
      importJson: vi.fn().mockResolvedValue(envelope()),
      chooseBackupFolder: vi.fn().mockResolvedValue(null),
    },
    restore: { restore: vi.fn().mockResolvedValue({
      metadata: 1, settings: 1, accounts: 0, transactions: 0, budgets: 0,
      auditEntries: 0, backupMetadata: 0, calculationCaches: 0,
    }) },
    transactions: {
      listTransactions: vi.fn().mockResolvedValue([]),
      listAccounts: vi.fn().mockResolvedValue([]),
    },
    settings: {
      get: vi.fn().mockResolvedValue(currentSettings),
      update: vi.fn(),
    },
    clock: () => "2026-07-29T10:00:00.000Z",
  };
}

describe("DataManagementService", () => {
  it("exports a canonical current JSON snapshot", async () => {
    const deps = dependencies();
    await new DataManagementService(deps).exportJson();
    expect(deps.database.snapshotAll).toHaveBeenCalledWith(
      "2026-07-29T10:00:00.000Z",
    );
    expect(deps.backups.exportJson).toHaveBeenCalledWith(envelope());
  });

  it("maps snapshot and transaction-query failures to safe declared results", async () => {
    const deps = dependencies();
    deps.database.snapshotAll.mockRejectedValueOnce(
      new Error("C:\\private\\ledger"),
    );
    await expect(new DataManagementService(deps).exportJson()).resolves.toEqual({
      status: "failed",
      errorCode: "UNKNOWN",
      message: "The file operation failed.",
    });

    deps.transactions.listTransactions.mockRejectedValueOnce(
      new Error("indexeddb details"),
    );
    await expect(new DataManagementService(deps).exportCsv()).resolves.toEqual({
      status: "failed",
      errorCode: "UNKNOWN",
      message: "The file operation failed.",
    });
    expect(deps.backups.exportJson).not.toHaveBeenCalled();
    expect(deps.backups.exportCsv).not.toHaveBeenCalled();
  });

  it("maps CSV serialization failures without invoking the native adapter", async () => {
    const deps = dependencies();
    deps.transactions.listTransactions.mockResolvedValueOnce([{
      id: "bad",
      type: "income",
      status: "completed",
      purpose: "standard",
      amount: Number.NaN,
      currency: "USD",
      effectiveAt: "2026-07-29T10:00:00.000Z",
      destinationAccountId: "cash",
      categoryId: "salary",
      createdAt: "2026-07-29T10:00:00.000Z",
      updatedAt: "2026-07-29T10:00:00.000Z",
    }] as never);
    await expect(new DataManagementService(deps).exportCsv()).resolves.toEqual({
      status: "failed",
      errorCode: "UNKNOWN",
      message: "The file operation failed.",
    });
    expect(deps.backups.exportCsv).not.toHaveBeenCalled();
  });

  it("exports every transaction in deterministic ledger order", async () => {
    const deps = dependencies();
    deps.transactions.listTransactions.mockResolvedValue([
      {
        id: "b", type: "income", status: "completed", purpose: "standard",
        amount: 100, currency: "USD", effectiveAt: "2026-07-29T10:00:00.000Z",
        destinationAccountId: "cash", categoryId: "salary",
        createdAt: "2026-07-29T10:00:00.000Z",
        updatedAt: "2026-07-29T10:00:00.000Z",
      },
      {
        id: "a", type: "income", status: "completed", purpose: "standard",
        amount: 100, currency: "USD", effectiveAt: "2026-07-28T10:00:00.000Z",
        destinationAccountId: "cash", categoryId: "salary",
        createdAt: "2026-07-28T10:00:00.000Z",
        updatedAt: "2026-07-28T10:00:00.000Z",
      },
    ] as never);
    await new DataManagementService(deps).exportCsv();
    const csv = deps.backups.exportCsv.mock.calls[0]?.[0] as string;
    expect(csv.indexOf("b,income")).toBeLessThan(csv.indexOf("a,income"));
  });

  it("keeps folder settings unchanged when selection is cancelled", async () => {
    const deps = dependencies();
    await expect(new DataManagementService(deps).chooseBackupFolder())
      .resolves.toEqual({ status: "cancelled" });
    expect(deps.settings.update).not.toHaveBeenCalled();
  });

  it("persists a validated selected folder and hides native failure details", async () => {
    const deps = dependencies();
    deps.backups.chooseBackupFolder.mockResolvedValueOnce("E:\\Finance");
    const service = new DataManagementService(deps);
    await expect(service.chooseBackupFolder()).resolves.toEqual({
      status: "success",
      folderPath: "E:\\Finance",
    });
    expect(deps.settings.update).toHaveBeenCalledWith({
      ...currentSettings,
      backupFolderPath: "E:\\Finance",
    });

    deps.backups.chooseBackupFolder.mockRejectedValueOnce({
      code: "PERMISSION_DENIED",
      message: "C:\\private\\secret",
    });
    await expect(service.chooseBackupFolder()).resolves.toEqual({
      status: "failed",
      errorCode: "PERMISSION_DENIED",
      message: "MiroraTrack does not have permission to use that folder.",
    });
  });

  it("previews privately then requires exact replacement confirmation", async () => {
    const deps = dependencies();
    const service = new DataManagementService(deps);
    const preview = await service.selectImport();
    expect(preview).toMatchObject({
      exportedAt: envelope().exportedAt,
      counts: { settings: 1, transactions: 0 },
    });
    await expect(service.restore(preview!.candidateId, "replace my data"))
      .rejects.toMatchObject({
      code: "RESTORE_CONFIRMATION_REQUIRED",
    });
    expect(deps.restore.restore).not.toHaveBeenCalled();
  });

  it("passes the configured folder to safety backup and invalidates candidate", async () => {
    const deps = dependencies();
    const service = new DataManagementService(deps);
    const preview = await service.selectImport();
    await expect(service.restore(preview!.candidateId, "REPLACE MY DATA"))
      .resolves.toMatchObject({
      reloadRequired: true,
      counts: { settings: 1 },
    });
    expect(deps.restore.restore).toHaveBeenCalledWith(
      envelope(),
      "D:\\Backups",
    );
    await expect(service.restore(preview!.candidateId, "REPLACE MY DATA"))
      .rejects.toMatchObject({
      code: "RESTORE_CANDIDATE_MISSING",
    });
  });
});
