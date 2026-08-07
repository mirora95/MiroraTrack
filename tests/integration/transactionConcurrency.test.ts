import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { FinanceService, type TransactionDraft } from "../../src/application/financeService";
import type { FinanceReadPort } from "../../src/application/ports";
import {
  APP_METADATA_KEY,
  MiroraTrackDatabase,
} from "../../src/database/db";
import { DexieFinanceUnitOfWork } from "../../src/database/unitOfWork";
import {
  DexieActivityReadRepository,
  DexieTransactionReadRepository,
} from "../../src/database/transactionReadRepository";
import type {
  Account,
  AccountId,
  AuditEntryId,
  Transaction,
  TransactionId,
} from "../../src/finance/types";
import type { FinanceUnitOfWork } from "../../src/application/ports";

const databases = new Set<MiroraTrackDatabase>();
const names = new Set<string>();
const now = "2026-07-29T10:00:00.000Z";

function createDatabase(): MiroraTrackDatabase {
  const name = `transaction-concurrency-${crypto.randomUUID()}`;
  names.add(name);
  const db = new MiroraTrackDatabase(name, () => now);
  databases.add(db);
  return db;
}

const account: Account = {
  id: "cash" as AccountId,
  name: "Cash",
  type: "cash",
  status: "active",
  currency: "USD" as never,
  color: "green",
  icon: "banknote",
  createdAt: now,
  updatedAt: now,
};

const original: Transaction = {
  id: "tx" as TransactionId,
  type: "expense",
  status: "completed",
  purpose: "standard",
  amount: 100 as never,
  currency: "USD" as never,
  effectiveAt: "2026-07-29T00:00:00.000Z",
  sourceAccountId: account.id,
  categoryId: "food" as never,
  description: "Original",
  createdAt: now,
  updatedAt: now,
};

const edit: TransactionDraft = {
  type: "expense",
  status: "completed",
  amount: "2.00",
  date: "2026-07-29",
  sourceAccountId: "cash",
  categoryId: "food",
};

afterEach(async () => {
  for (const db of databases) db.close();
  databases.clear();
  for (const name of names) await Dexie.delete(name);
  names.clear();
});

describe("transaction concurrency", () => {
  it("allows only one of two service edits that read the same original record", async () => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account);
    await db.transactions.add(original);
    const reads: FinanceReadPort = {
      getAccount: (id) => db.accounts.get(id),
      getTransaction: async () => original,
    };
    let sequence = 0;
    const service = new FinanceService({
      reads,
      uow: new DexieFinanceUnitOfWork(db),
      transactionId: () => "unused" as TransactionId,
      auditId: () => `audit-${++sequence}` as AuditEntryId,
      clock: () => `2026-07-29T10:00:0${sequence}.000Z`,
    });

    const results = await Promise.allSettled([
      service.edit("tx", edit),
      service.edit("tx", { ...edit, amount: "3.00" }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: {
        code: "CONCURRENT_MODIFICATION",
        field: "transactionId",
      },
    });
    expect(await db.auditEntries.count()).toBe(1);
    expect((await db.metadata.get(APP_METADATA_KEY))?.ledgerRevision).toBe(1);
    expect([200, 300]).toContain((await db.transactions.get("tx"))?.amount);
  });

  it.each([
    {
      name: "edit wins before stale delete",
      winner: "edit",
      expectedAction: "transaction.updated",
      expectedTransaction: true,
    },
    {
      name: "delete wins before stale edit",
      winner: "delete",
      expectedAction: "transaction.deleted",
      expectedTransaction: false,
    },
  ] as const)(
    "$name with one audit, revision increment, cache clear, and no loser state",
    async ({ winner, expectedAction, expectedTransaction }) => {
      const db = createDatabase();
      await db.open();
      await db.accounts.add(account);
      await db.transactions.add(original);
      await db.calculationCaches.add({
        key: "dashboard" as never,
        calculationVersion: 1,
        sourceRevision: 0,
        value: { stale: true },
        updatedAt: now,
      });
      const reads: FinanceReadPort = {
        getAccount: (id) => db.accounts.get(id),
        getTransaction: async () => original,
      };
      const concrete = new DexieFinanceUnitOfWork(db);
      let releaseLoser!: () => void;
      const winnerCommitted = new Promise<void>((resolve) => {
        releaseLoser = resolve;
      });
      const delayedLoser: FinanceUnitOfWork = {
        createTransaction: (...args) => concrete.createTransaction(...args),
        replaceTransaction: async (...args) => {
          await winnerCommitted;
          return concrete.replaceTransaction(...args);
        },
        deleteTransaction: async (...args) => {
          await winnerCommitted;
          return concrete.deleteTransaction(...args);
        },
      };
      let auditSequence = 0;
      const service = (uow: FinanceUnitOfWork) => new FinanceService({
        reads,
        uow,
        auditId: () => `race-audit-${++auditSequence}` as AuditEntryId,
        clock: () => `2026-07-29T10:01:0${auditSequence}.000Z`,
      });
      const winnerService = service(concrete);
      const loserService = service(delayedLoser);

      const winning = winner === "edit"
        ? winnerService.edit("tx", edit)
        : winnerService.delete("tx");
      const losing = winner === "edit"
        ? loserService.delete("tx")
        : loserService.edit("tx", edit);
      await winning;
      releaseLoser();

      await expect(losing).rejects.toMatchObject({
        code: "CONCURRENT_MODIFICATION",
        field: "transactionId",
      });
      const audits = await db.auditEntries.toArray();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.action).toBe(expectedAction);
      expect((await db.metadata.get(APP_METADATA_KEY))?.ledgerRevision).toBe(1);
      expect(await db.calculationCaches.count()).toBe(0);
      expect(Boolean(await db.transactions.get("tx"))).toBe(expectedTransaction);
    },
  );

  it("exposes ledger, account, and audit records through read-only adapters", async () => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account);
    await db.transactions.add(original);
    await db.auditEntries.add({
      id: "audit" as AuditEntryId,
      timestamp: now,
      action: "transaction.created",
      entityType: "transaction",
      entityId: original.id,
      description: "Transaction created",
    });

    const transactions = new DexieTransactionReadRepository(db);
    const activity = new DexieActivityReadRepository(db);

    await expect(transactions.listAccounts()).resolves.toEqual([account]);
    await expect(transactions.listTransactions()).resolves.toEqual([original]);
    await expect(activity.listAuditEntries()).resolves.toHaveLength(1);
  });
});
