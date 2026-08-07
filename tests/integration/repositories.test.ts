import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { MiroraTrackDatabase } from "../../src/database/db";
import { DexieDashboardReadRepository } from "../../src/database/dashboardReadRepository";
import { createRepositories } from "../../src/database/repositories";
import type {
  Account,
  AccountId,
  AppMetadata,
  AuditEntry,
  BackupMetadata,
  Budget,
  CalculationCache,
  Settings,
  Transaction,
} from "../../src/finance/types";

const connections = new Set<MiroraTrackDatabase>();
const names = new Set<string>();
const now = "2026-07-28T10:00:00.000Z";

function database(): MiroraTrackDatabase {
  const name = `repositories-${crypto.randomUUID()}`;
  names.add(name);
  const db = new MiroraTrackDatabase(name, () => now);
  connections.add(db);
  return db;
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await Dexie.delete(name);
  names.clear();
});

describe("createRepositories", () => {
  it("round-trips all eight stores through the structural repository API", async () => {
    const db = database();
    await db.open();
    const repositories = createRepositories(db);
    await repositories.metadata.delete("app");
    const account = {
      id: "cash" as AccountId,
      name: "Cash",
      type: "cash",
      status: "active",
      currency: "USD",
      color: "green",
      icon: "banknote",
      createdAt: now,
      updatedAt: now,
    } as Account;
    const transaction = {
      id: "tx-1",
      type: "income",
      status: "completed",
      purpose: "standard",
      amount: 250,
      currency: "USD",
      destinationAccountId: account.id,
      categoryId: "salary",
      effectiveAt: now,
      createdAt: now,
      updatedAt: now,
    } as Transaction;
    const records = {
      metadata: {
        key: "app",
        schemaVersion: 3,
        calculationVersion: 1,
        ledgerRevision: 0,
        createdAt: now,
        updatedAt: now,
      } as AppMetadata,
      settings: {
        key: "primary",
        baseCurrency: "USD",
        locale: "en-US",
        dateFormat: "yyyy-MM-dd",
        automaticBackupsEnabled: true,
      } as Settings,
      accounts: account,
      transactions: transaction,
      budgets: {
        id: "budget-1",
        name: "Food",
        categoryId: "food",
        currency: "USD",
        amount: 500,
        month: "2026-07",
        rollover: false,
        createdAt: now,
        updatedAt: now,
      } as Budget,
      auditEntries: {
        id: "audit-1",
        timestamp: now,
        action: "transaction.created",
        entityType: "transaction",
        entityId: transaction.id,
        description: "created",
      } as AuditEntry,
      backupMetadata: {
        id: "automatic",
        status: "idle",
        schemaVersion: 3,
      } as BackupMetadata,
      calculationCaches: {
        key: "dashboard",
        calculationVersion: 1,
        sourceRevision: 0,
        value: { total: 100 },
        updatedAt: now,
      } as CalculationCache,
    };

    for (const key of Object.keys(records) as (keyof typeof records)[]) {
      const repository = repositories[key];
      const record = records[key] as never;
      const id = ("id" in record ? record.id : record.key) as never;
      await repository.add(record);
      expect(await repository.get(id)).toEqual(record);
      expect(await repository.list()).toEqual([record]);
      await repository.put({ ...record } as never);
      await repository.delete(id);
      expect(await repository.get(id)).toBeUndefined();
    }
  });

  it("exposes a narrow dashboard snapshot and cache repository", async () => {
    const db = database();
    await db.open();
    const reads = new DexieDashboardReadRepository(db);
    const settings = {
      key: "primary",
      baseCurrency: "USD",
      locale: "en-US",
      dateFormat: "yyyy-MM-dd",
      automaticBackupsEnabled: true,
    } as Settings;
    const cache = {
      key: "dashboard:v2:USD:range:5",
      calculationVersion: 2,
      sourceRevision: 0,
      value: {},
      updatedAt: now,
    } as CalculationCache;
    await db.settings.add(settings);
    await reads.putCalculationCache(cache);

    expect(await reads.getSettings()).toEqual(settings);
    expect(await reads.getMetadata()).toMatchObject({
      key: "app",
      calculationVersion: 2,
      ledgerRevision: 0,
    });
    expect(await reads.listAccounts()).toEqual([]);
    expect(await reads.listTransactions()).toEqual([]);
    expect(await reads.listBudgets()).toEqual([]);
    expect(await reads.getCalculationCache(cache.key)).toEqual(cache);
  });
});
