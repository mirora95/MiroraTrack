import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import {
  DexieAccountUnitOfWork,
  type AccountUnitOfWorkStage,
} from "../../src/database/accountUnitOfWork";
import { DexieAccountReadRepository } from "../../src/database/accountReadRepository";
import {
  APP_METADATA_KEY,
  MiroraTrackDatabase,
} from "../../src/database/db";
import type {
  Account,
  AccountId,
  AuditEntry,
  Settings,
  Transaction,
} from "../../src/finance/types";

const initial = "2026-07-29T08:00:00.000Z";
const commit = "2026-07-29T09:00:00.000Z";
const names = new Set<string>();
const databases = new Set<MiroraTrackDatabase>();

function database(): MiroraTrackDatabase {
  const name = `account-uow-${crypto.randomUUID()}`;
  names.add(name);
  const db = new MiroraTrackDatabase(name, () => initial);
  databases.add(db);
  return db;
}

const account: Account = {
  id: "cash" as AccountId, name: "Cash", type: "cash", status: "active",
  currency: "USD" as never, color: "green", icon: "banknote",
  createdAt: initial, updatedAt: initial,
};
const settings: Settings = {
  key: "primary", baseCurrency: "USD" as never, locale: "en-US",
  dateFormat: "yyyy-MM-dd", defaultAccountId: account.id,
  automaticBackupsEnabled: true,
};
const opening: Transaction = {
  id: "opening:cash" as never, type: "income", status: "completed",
  purpose: "opening-balance", amount: 100 as never, currency: "USD" as never,
  effectiveAt: initial, destinationAccountId: account.id,
  categoryId: "system:opening-balance" as never,
  createdAt: initial, updatedAt: initial,
};
const accountAudit: AuditEntry = {
  id: "audit:account" as never, timestamp: initial, action: "account.created",
  entityType: "account", entityId: account.id, description: "Account created",
};
const transactionAudit: AuditEntry = {
  id: "audit:opening" as never, timestamp: initial,
  action: "transaction.created", entityType: "transaction",
  entityId: opening.id, description: "Opening balance created",
};

async function snapshot(db: MiroraTrackDatabase) {
  return {
    settings: await db.settings.toArray(),
    accounts: await db.accounts.toArray(),
    transactions: await db.transactions.toArray(),
    audits: await db.auditEntries.toArray(),
    metadata: await db.metadata.toArray(),
    caches: await db.calculationCaches.toArray(),
  };
}

afterEach(async () => {
  for (const db of databases) db.close();
  databases.clear();
  for (const name of names) await Dexie.delete(name);
  names.clear();
});

describe("DexieAccountUnitOfWork", () => {
  it("exposes initialization and account read models without leaking tables", async () => {
    const db = database();
    await db.open();
    await db.settings.add(settings);
    await db.accounts.add(account);
    await db.transactions.add(opening);
    const reads = new DexieAccountReadRepository(db);
    expect(await reads.getSettings()).toEqual(settings);
    expect(await reads.listAccounts()).toEqual([account]);
    expect(await reads.listTransactions()).toEqual([opening]);
  });
  it("initializes all records, advances revision, and clears caches atomically", async () => {
    const db = database();
    await db.open();
    await db.calculationCaches.add({
      key: "dashboard" as never, calculationVersion: 1, sourceRevision: 0,
      value: {}, updatedAt: initial,
    });
    await new DexieAccountUnitOfWork(db, { clock: () => commit }).initialize({
      settings, account, openingTransaction: opening,
      accountAudit, transactionAudit,
    });
    expect(await db.settings.toArray()).toEqual([settings]);
    expect(await db.accounts.toArray()).toEqual([account]);
    expect(await db.transactions.toArray()).toEqual([opening]);
    expect(await db.auditEntries.toArray()).toEqual([
      accountAudit, transactionAudit,
    ]);
    expect(await db.metadata.get(APP_METADATA_KEY)).toMatchObject({
      ledgerRevision: 1, updatedAt: commit,
    });
    expect(await db.calculationCaches.count()).toBe(0);
  });

  it.each([
    "afterAccount", "afterTransaction", "afterAudit", "afterMetadata",
    "afterCacheClear", "beforeCommit",
  ] as const)("rolls initialization back at %s", async (stage) => {
    const db = database();
    await db.open();
    const before = await snapshot(db);
    const uow = new DexieAccountUnitOfWork(db, {
      clock: () => commit,
      onStage: (current) => {
        if (current === stage) throw new Error(`fail:${stage}`);
      },
    });
    await expect(uow.initialize({
      settings, account, openingTransaction: opening,
      accountAudit, transactionAudit,
    })).rejects.toThrow(`fail:${stage}`);
    expect(await snapshot(db)).toEqual(before);
  });

  it("creates a later account with its opening transaction atomically", async () => {
    const db = database();
    await db.open();
    await db.settings.add(settings);
    const uow = new DexieAccountUnitOfWork(db, { clock: () => commit });
    await uow.createAccount({
      account, openingTransaction: opening, accountAudit, transactionAudit,
    });
    expect(await db.accounts.get(account.id)).toEqual(account);
    expect(await db.transactions.get(opening.id)).toEqual(opening);
  });

  it.each([
    "afterAccount", "afterTransaction", "afterAudit", "afterMetadata",
    "afterCacheClear", "beforeCommit",
  ] as const)("rolls later account creation back at %s", async (stage) => {
    const db = database();
    await db.open();
    await db.settings.add(settings);
    const before = await snapshot(db);
    const uow = new DexieAccountUnitOfWork(db, {
      onStage: (current) => {
        if (current === stage) throw new Error(`fail:${stage}`);
      },
    });
    await expect(uow.createAccount({
      account, openingTransaction: opening, accountAudit, transactionAudit,
    })).rejects.toThrow(`fail:${stage}`);
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects currency changes for referenced accounts without partial writes", async () => {
    const db = database();
    await db.open();
    await db.accounts.add(account);
    await db.transactions.add(opening);
    const before = await snapshot(db);
    const changed = { ...account, currency: "EUR" as never, updatedAt: commit };
    await expect(new DexieAccountUnitOfWork(db).updateAccount(
      changed,
      { ...accountAudit, id: "audit:update" as never, action: "account.updated" },
    )).rejects.toThrow("currency");
    expect(await snapshot(db)).toEqual(before);
  });

  it("allows a currency change when no transaction references the account", async () => {
    const db = database();
    await db.open();
    await db.accounts.add(account);
    const changed = { ...account, currency: "EUR" as never, updatedAt: commit };
    await new DexieAccountUnitOfWork(db).updateAccount(
      changed,
      { ...accountAudit, id: "audit:update" as never, action: "account.updated" },
    );
    expect((await db.accounts.get(account.id))?.currency).toBe("EUR");
  });

  it("preserves transaction-current archived status during a stale account edit", async () => {
    const db = database();
    await db.open();
    await db.settings.add(settings);
    await db.accounts.add(account);
    const uow = new DexieAccountUnitOfWork(db, { clock: () => commit });
    await uow.setAccountStatus(
      account.id, "archived", undefined,
      { ...accountAudit, id: "audit:archive" as never,
        action: "account.archived" },
    );
    await uow.updateAccount(
      { ...account, name: "Renamed", updatedAt: commit },
      { ...accountAudit, id: "audit:update" as never,
        action: "account.updated" },
    );
    expect(await db.accounts.get(account.id)).toMatchObject({
      name: "Renamed", status: "archived",
    });
    expect((await db.auditEntries.toArray()).map(({ action }) => action))
      .toEqual(["account.archived", "account.updated"]);
  });

  it.each([
    ["transfer", { ...opening, type: "transfer", sourceAccountId: account.id,
      destinationAccountId: "other" as AccountId, categoryId: undefined }],
    ["wrong category", { ...opening, categoryId: "salary" }],
    ["second account reference", { ...opening, sourceAccountId: "other" as AccountId }],
    ["wrong direction", { ...opening, type: "expense", sourceAccountId: "other" as AccountId,
      destinationAccountId: undefined }],
    ["zero amount", { ...opening, amount: 0 }],
  ])("rejects malformed opening records: %s", async (_name, malformed) => {
    const db = database();
    await db.open();
    await db.settings.add(settings);
    const before = await snapshot(db);
    await expect(new DexieAccountUnitOfWork(db).createAccount({
      account,
      openingTransaction: malformed as unknown as Transaction,
      accountAudit,
      transactionAudit,
    })).rejects.toThrow("Opening");
    expect(await snapshot(db)).toEqual(before);
  });

  it("archives a default account and reassigns or clears it in the same commit", async () => {
    const db = database();
    await db.open();
    const second = { ...account, id: "second" as AccountId, name: "Second" };
    await db.accounts.bulkAdd([account, second]);
    await db.settings.add(settings);
    const uow = new DexieAccountUnitOfWork(db, { clock: () => commit });
    await uow.setAccountStatus(
      account.id, "archived", second.id,
      { ...accountAudit, id: "audit:archive" as never, action: "account.archived" },
    );
    expect((await db.settings.get("primary"))?.defaultAccountId).toBe(second.id);
    expect((await db.accounts.get(account.id))?.status).toBe("archived");

    await uow.setAccountStatus(
      second.id, "archived", undefined,
      { ...accountAudit, id: "audit:last" as never, entityId: second.id,
        action: "account.archived" },
    );
    expect((await db.settings.get("primary"))?.defaultAccountId).toBeUndefined();
  });
});
