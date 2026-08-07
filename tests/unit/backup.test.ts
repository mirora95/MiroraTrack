import { describe, expect, it } from "vitest";
import {
  BackupValidationError,
  migrateBackupEnvelope,
  parseBackupEnvelope,
  type BackupEnvelopeV1,
  type BackupEnvelopeV2,
  type BackupEnvelopeV3,
} from "../../src/backup/schema";
import { serializeBackupEnvelope } from "../../src/backup/serialize";

const iso = "2026-07-28T10:20:30.000Z";
function validEnvelope(): BackupEnvelopeV1 {
  return { app: "MiroraTrack", schemaVersion: 1, exportedAt: iso, data: {
    metadata: [{ key: "app", schemaVersion: 2, calculationVersion: 1, ledgerRevision: 0, createdAt: iso, updatedAt: iso }],
    settings: [{ key: "primary", baseCurrency: "USD", locale: "en-US", dateFormat: "yyyy-MM-dd", defaultAccountId: "checking", automaticBackupsEnabled: true }],
    accounts: [{ id: "checking", name: "Checking", type: "checking", status: "active", currency: "USD", openingBalance: 1000, createdAt: iso, updatedAt: iso }],
    transactions: [{ id: "income-1", type: "income", status: "completed", amount: 250, currency: "USD", effectiveAt: iso, destinationAccountId: "checking", categoryId: "salary", createdAt: iso, updatedAt: iso }],
    budgets: [{ id: "budget-1", name: "Food", categoryId: "food", currency: "USD", amount: 5000, month: "2026-07", rollover: false, createdAt: iso, updatedAt: iso }],
    auditEntries: [{ id: "audit-1", timestamp: iso, action: "transaction.deleted", entityType: "transaction", entityId: "already-deleted", description: "Deleted transaction" }],
    backupMetadata: [{ id: "automatic", status: "idle", schemaVersion: 2 }],
    calculationCaches: [{ key: "dashboard", calculationVersion: 1, sourceRevision: 0, value: { total: 1250, labels: ["a", null] }, updatedAt: iso }],
  } };
}

function validV2Envelope(): BackupEnvelopeV2 {
  const current = migrateBackupEnvelope(validEnvelope());
  const settings = current.data.settings.map(
    ({ automaticBackupIntervalHours: _, ...entry }) => entry,
  );
  return {
    ...current,
    schemaVersion: 2,
    data: {
      ...current.data,
      settings,
      metadata: current.data.metadata.map((entry) => ({
        ...entry,
        schemaVersion: 3 as const,
        calculationVersion: 1,
        ledgerRevision: entry.ledgerRevision - 1,
      })),
      budgets: current.data.budgets.map(({ status: _, ...budget }) => budget),
      auditEntries: current.data.auditEntries.filter(
        ({ entityType }) => entityType !== "budget",
      ),
      backupMetadata: current.data.backupMetadata.map((entry) => ({
        ...entry,
        schemaVersion: 3 as const,
      })),
    },
  };
}

describe("backup envelope", () => {
  it("parses a complete strict version 1 envelope", () => expect(parseBackupEnvelope(validEnvelope())).toEqual(validEnvelope()));
  it.each([
    ["unknown root property", (v: any) => { v.attachments = []; }],
    ["unknown collection", (v: any) => { v.data.attachments = []; }],
    ["invalid timestamp", (v: any) => { v.exportedAt = "2026-02-30T00:00:00Z"; }],
    ["duplicate id", (v: any) => { v.data.accounts.push({ ...v.data.accounts[0] }); }],
    ["missing account", (v: any) => { v.data.transactions[0].destinationAccountId = "missing"; }],
    ["unsafe amount", (v: any) => { v.data.accounts[0].openingBalance = Number.MAX_SAFE_INTEGER + 1; }],
    ["zero transaction", (v: any) => { v.data.transactions[0].amount = 0; }],
    ["negative budget", (v: any) => { v.data.budgets[0].amount = -1; }],
    ["non-JSON cache", (v: any) => { v.data.calculationCaches[0].value = undefined; }],
  ])("rejects %s", (_name, mutate) => {
    const value: any = structuredClone(validEnvelope()); mutate(value);
    expect(() => parseBackupEnvelope(value)).toThrow(BackupValidationError);
  });
  it("reports discriminator errors with stable codes", () => {
    expectCode({ ...validEnvelope(), app: "Other" }, "BACKUP_APP_UNSUPPORTED");
    expectCode({ ...validEnvelope(), schemaVersion: 5 }, "BACKUP_VERSION_NEWER");
    expectCode({ ...validEnvelope(), schemaVersion: 0 }, "BACKUP_VERSION_OLDER");
  });
  it("migrates v1 opening balances and budgets to the current version", () => {
    const migrated = migrateBackupEnvelope(validEnvelope());
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.data.accounts[0]).toEqual({
      id: "checking", name: "Checking", type: "checking", status: "active",
      currency: "USD", color: "blue", icon: "landmark",
      createdAt: iso, updatedAt: iso,
    });
    expect(migrated.data.transactions).toEqual([
      expect.objectContaining({ id: "income-1", purpose: "standard" }),
      expect.objectContaining({
        id: "opening-balance:checking", type: "income",
        purpose: "opening-balance", amount: 1000,
        destinationAccountId: "checking",
      }),
    ]);
    expect(migrated.data.metadata[0]).toMatchObject({
      schemaVersion: 5, calculationVersion: 2, ledgerRevision: 2,
    });
    expect(migrated.data.budgets[0]).toMatchObject({ status: "active" });
    expect(migrated.data.settings[0]).toMatchObject({
      automaticBackupIntervalHours: 24,
    });
    expect(migrated.data.calculationCaches).toEqual([]);
  });
  it("rejects a v1 migration when a generated ledger id collides", () => {
    const legacy = structuredClone(validEnvelope());
    legacy.data.transactions[0]!.id = "opening-balance:checking";
    expect(() => migrateBackupEnvelope(parseBackupEnvelope(legacy)))
      .toThrow(BackupValidationError);
  });
  it("round-trips a strict current envelope", () => {
    const current = migrateBackupEnvelope(validEnvelope());
    expect(parseBackupEnvelope(current)).toEqual(current);
  });
  it("rejects a current envelope with a stale calculation version", () => {
    const current = structuredClone(migrateBackupEnvelope(validEnvelope()));
    current.data.metadata[0] = {
      ...current.data.metadata[0]!,
      calculationVersion: 1,
    };
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
  });
  it("migrates a version 2 envelope to active budgets and current metadata", () => {
    const legacy = validV2Envelope();
    expect(parseBackupEnvelope(legacy)).toEqual(legacy);
    const migrated = migrateBackupEnvelope(legacy);
    expect(migrated).toMatchObject({
      schemaVersion: 4,
      data: {
        metadata: [{
          schemaVersion: 5,
          calculationVersion: 2,
          ledgerRevision: legacy.data.metadata[0]!.ledgerRevision + 1,
        }],
        budgets: [{ status: "active" }],
        calculationCaches: [],
      },
    });
  });
  it("migrates a strict v3 backup to v4 settings and v5 database metadata", () => {
    const current = migrateBackupEnvelope(validEnvelope());
    const legacy: BackupEnvelopeV3 = {
      ...current,
      schemaVersion: 3,
      data: {
        ...current.data,
        metadata: current.data.metadata.map((entry) => ({
          ...entry,
          schemaVersion: 4 as const,
        })),
        settings: current.data.settings.map(
          ({ automaticBackupIntervalHours: _, ...entry }) => entry,
        ),
        backupMetadata: current.data.backupMetadata.map((entry) => ({
          id: entry.id,
          status: "idle" as const,
          schemaVersion: 4 as const,
        })),
      },
    };
    const migrated = migrateBackupEnvelope(parseBackupEnvelope(legacy));
    expect(migrated).toMatchObject({
      schemaVersion: 4,
      data: {
        metadata: [{ schemaVersion: 5 }],
        settings: [{ automaticBackupIntervalHours: 24 }],
        calculationCaches: [],
      },
    });
  });
  it("rejects mismatched audit action and entity combinations in current backups", () => {
    const current = structuredClone(migrateBackupEnvelope(validEnvelope()));
    current.data.auditEntries[0] = {
      ...current.data.auditEntries[0]!,
      action: "account.updated",
      entityType: "transaction",
    } as never;
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
  });
  it("enforces warning and failure metadata field invariants", () => {
    const current = structuredClone(migrateBackupEnvelope(validEnvelope()));
    current.data.backupMetadata = [{
      id: "automatic" as never,
      status: "warning",
      schemaVersion: 5,
    }];
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
    current.data.backupMetadata = [{
      id: "automatic" as never,
      status: "success",
      schemaVersion: 5,
      warningCode: "RETENTION_WARNING",
    }];
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
    current.data.backupMetadata = [{
      id: "automatic" as never,
      status: "failed",
      schemaVersion: 5,
    }];
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
  });
  it.each([
    ["unsupported base currency", { baseCurrency: "ZZZ" }],
    ["empty backup folder", { backupFolderPath: " " }],
    ["control character in backup folder", {
      backupFolderPath: "D:\\Safe\u0001Hidden",
    }],
    ["oversized backup folder", { backupFolderPath: "x".repeat(1025) }],
  ])("rejects current settings with %s", (_name, changes) => {
    const current = structuredClone(migrateBackupEnvelope(validEnvelope()));
    Object.assign(current.data.settings[0]!, changes);
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
  });
  it("serializes canonically", () => {
    const e = validEnvelope();
    const reordered = { data: Object.fromEntries(Object.entries(e.data).reverse()), exportedAt: e.exportedAt, schemaVersion: 1, app: "MiroraTrack" };
    expect(serializeBackupEnvelope(reordered)).toBe(serializeBackupEnvelope(e));
    expect(serializeBackupEnvelope(e)).toMatch(/^\{"app":"MiroraTrack","schemaVersion":4,"exportedAt":/);
  });
  it("rejects duplicate active budget scopes but permits archived history", () => {
    const current = structuredClone(migrateBackupEnvelope(validEnvelope()));
    current.data.budgets.push({
      ...current.data.budgets[0]!,
      id: "budget-2" as never,
    });
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
    current.data.budgets[1] = {
      ...current.data.budgets[1]!,
      status: "archived",
    };
    expect(parseBackupEnvelope(current)).toEqual(current);
  });
  it.each([
    ["income category", { categoryId: "salary" }],
    ["unknown category", { categoryId: "unknown" }],
    ["unsupported currency", { currency: "ZZZ" }],
    ["rollover enabled", { rollover: true }],
    ["zero year", { month: "0000-01" }],
  ])("rejects a current budget with %s", (_name, changes) => {
    const current = structuredClone(migrateBackupEnvelope(validEnvelope()));
    Object.assign(current.data.budgets[0]!, changes);
    expect(() => parseBackupEnvelope(current)).toThrow(BackupValidationError);
  });
});
function expectCode(value: unknown, code: string): void {
  try { parseBackupEnvelope(value); throw new Error("Expected failure"); }
  catch (error) { expect(error).toBeInstanceOf(BackupValidationError); expect((error as BackupValidationError).code).toBe(code); }
}
