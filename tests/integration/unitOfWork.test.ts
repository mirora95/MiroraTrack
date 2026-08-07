import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
  MiroraTrackDatabase,
} from "../../src/database/db";
import {
  DexieFinanceUnitOfWork,
  type UnitOfWorkStage,
} from "../../src/database/unitOfWork";
import type {
  Account,
  AccountId,
  AuditEntry,
  CacheKey,
  CalculationCache,
  Transaction,
  TransactionId,
} from "../../src/finance/types";

const initialTime = "2026-07-28T10:00:00.000Z";
const commitTime = "2026-07-28T11:00:00.000Z";
const connections = new Set<MiroraTrackDatabase>();
const names = new Set<string>();

function createDatabase(): MiroraTrackDatabase {
  const name = `unit-of-work-${crypto.randomUUID()}`;
  names.add(name);
  const db = new MiroraTrackDatabase(name, () => initialTime);
  connections.add(db);
  return db;
}

function transaction(id = "tx-1", updatedAt = initialTime): Transaction {
  return {
    id: id as TransactionId,
    type: "income",
    status: "completed",
    amount: 250,
    currency: "USD" as Transaction["currency"],
    destinationAccountId: "cash" as never,
    categoryId: "salary" as never,
    effectiveAt: initialTime,
    createdAt: initialTime,
    updatedAt,
  };
}

function account(
  status: Account["status"] = "active",
  currency = "USD",
): Account {
  return {
    id: "cash" as AccountId, name: "Cash", type: "cash", status,
    currency: currency as never, color: "green", icon: "banknote",
    createdAt: initialTime, updatedAt: initialTime,
  };
}

function audit(
  action: AuditEntry["action"],
  entityId = "tx-1",
  id = `audit-${action}`,
): AuditEntry {
  const descriptions = {
    "transaction.created": "Transaction created",
    "transaction.updated": "Transaction updated",
    "transaction.deleted": "Transaction deleted",
  } as const;
  return {
    id: id as AuditEntry["id"],
    timestamp: initialTime,
    action,
    entityType: "transaction",
    entityId: entityId as TransactionId,
    description: descriptions[action as keyof typeof descriptions],
  };
}

function cache(): CalculationCache {
  return {
    key: "dashboard" as CacheKey,
    calculationVersion: CALCULATION_VERSION,
    sourceRevision: 0,
    value: { total: 10 },
    updatedAt: initialTime,
  };
}

async function seedLedger(db: MiroraTrackDatabase): Promise<void> {
  await db.transactions.add(transaction());
  await db.calculationCaches.add(cache());
}

async function snapshot(db: MiroraTrackDatabase) {
  return {
    transactions: await db.transactions.toArray(),
    auditEntries: await db.auditEntries.toArray(),
    metadata: await db.metadata.toArray(),
    calculationCaches: await db.calculationCaches.toArray(),
  };
}

afterEach(async () => {
  for (const db of connections) db.close();
  connections.clear();
  for (const name of names) await Dexie.delete(name);
  names.clear();
});

describe("DexieFinanceUnitOfWork commits", () => {
  it.each([
    {
      operation: "create",
      expectedAction: "transaction.created" as const,
      arrange: async (db: MiroraTrackDatabase) =>
        db.calculationCaches.add(cache()),
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(transaction(), audit("transaction.created")),
      expected: transaction(),
    },
    {
      operation: "replace",
      expectedAction: "transaction.updated" as const,
      arrange: seedLedger,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.replaceTransaction(
          transaction(),
          transaction("tx-1", "unchanged-by-uow"),
          audit("transaction.updated"),
        ),
      expected: transaction("tx-1", "unchanged-by-uow"),
    },
    {
      operation: "delete",
      expectedAction: "transaction.deleted" as const,
      arrange: seedLedger,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.deleteTransaction(
          transaction(),
          audit("transaction.deleted"),
        ),
      expected: undefined,
    },
  ])(
    "$operation atomically mutates the ledger, audits, revises metadata, and clears cache",
    async ({ arrange, execute, expected, expectedAction }) => {
      const db = createDatabase();
      await db.open();
      await db.accounts.add(account());
      await arrange(db);
      const before = await db.metadata.get(APP_METADATA_KEY);
      const uow = new DexieFinanceUnitOfWork(db, { clock: () => commitTime });

      await execute(uow);

      expect(await db.transactions.get("tx-1")).toEqual(expected);
      expect(await db.auditEntries.toArray()).toEqual([
        audit(expectedAction),
      ]);
      expect(await db.metadata.get(APP_METADATA_KEY)).toEqual({
        ...before,
        ledgerRevision: 1,
        updatedAt: commitTime,
      });
      expect(await db.calculationCaches.toArray()).toEqual([]);
    },
  );

  it("preserves the caller's audit timestamp and resolves after committed state is visible", async () => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    const entry = {
      ...audit("transaction.created"),
      timestamp: "2001-02-03T04:05:06.000Z",
    };

    await new DexieFinanceUnitOfWork(db, {
      clock: () => commitTime,
    }).createTransaction(transaction(), entry);

    expect(await db.auditEntries.get(entry.id)).toEqual(entry);
    expect((await db.metadata.get(APP_METADATA_KEY))?.ledgerRevision).toBe(1);
  });
});

describe("DexieFinanceUnitOfWork rolls back", () => {
  it.each([
    ["create", "afterLedgerMutation"],
    ["create", "beforeCommit"],
    ["replace", "afterLedgerMutation"],
    ["replace", "beforeCommit"],
    ["delete", "afterLedgerMutation"],
    ["delete", "beforeCommit"],
  ] as const)(
    "%s when the synchronous %s hook throws",
    async (operation, failingStage) => {
      const db = createDatabase();
      await db.open();
      await db.accounts.add(account());
      if (operation === "create") await db.calculationCaches.add(cache());
      else await seedLedger(db);
      const before = await snapshot(db);
      const seen: UnitOfWorkStage[] = [];
      const uow = new DexieFinanceUnitOfWork(db, {
        clock: () => commitTime,
        onStage: (stage) => {
          seen.push(stage);
          if (stage === failingStage) throw new Error(`fail:${stage}`);
        },
      });

      const result =
        operation === "create"
          ? uow.createTransaction(transaction(), audit("transaction.created"))
          : operation === "replace"
            ? uow.replaceTransaction(
                transaction(),
                transaction(),
                audit("transaction.updated"),
              )
            : uow.deleteTransaction(
                transaction(),
                audit("transaction.deleted"),
              );

      await expect(result).rejects.toThrow(`fail:${failingStage}`);
      expect(await snapshot(db)).toEqual(before);
      expect(seen).toContain(failingStage);
    },
  );

  it.each([
    {
      name: "a duplicate transaction create",
      arrange: seedLedger,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(
          transaction(),
          audit("transaction.created", "tx-1", "audit-duplicate"),
        ),
    },
    {
      name: "a missing transaction replace",
      arrange: async () => undefined,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.replaceTransaction(
          transaction("missing"),
          transaction("missing"),
          audit("transaction.updated", "missing"),
        ),
    },
    {
      name: "a missing transaction delete",
      arrange: async () => undefined,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.deleteTransaction(
          transaction("missing"),
          audit("transaction.deleted", "missing"),
        ),
    },
    {
      name: "a replacement identity mismatch",
      arrange: seedLedger,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.replaceTransaction(
          transaction(),
          transaction("tx-2"),
          audit("transaction.updated"),
        ),
    },
    {
      name: "an audit action mismatch",
      arrange: async () => undefined,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(transaction(), audit("transaction.deleted")),
    },
    {
      name: "an audit entity type mismatch",
      arrange: async () => undefined,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(transaction(), {
          ...audit("transaction.created"),
          entityType: "account" as never,
        }),
    },
    {
      name: "an audit entity id mismatch",
      arrange: async () => undefined,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(
          transaction(),
          audit("transaction.created", "tx-2"),
        ),
    },
    {
      name: "an audit id that is not independent",
      arrange: async () => undefined,
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(
          transaction(),
          audit("transaction.created", "tx-1", "tx-1"),
        ),
    },
    {
      name: "an audit id collision",
      arrange: async (db: MiroraTrackDatabase) => {
        await db.auditEntries.add(
          audit("transaction.deleted", "old", "audit-collision"),
        );
      },
      execute: (uow: DexieFinanceUnitOfWork) =>
        uow.createTransaction(
          transaction(),
          audit("transaction.created", "tx-1", "audit-collision"),
        ),
    },
  ])("leaves all four stores unchanged for $name", async ({ arrange, execute }) => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    await arrange(db);
    const before = await snapshot(db);

    await expect(
      execute(new DexieFinanceUnitOfWork(db, { clock: () => commitTime })),
    ).rejects.toThrow();

    expect(await snapshot(db)).toEqual(before);
  });

  it.each([
    ["missing", undefined],
    ["wrong schema", { schemaVersion: DATABASE_VERSION + 1 }],
    ["wrong calculation", { calculationVersion: CALCULATION_VERSION + 1 }],
    ["negative revision", { ledgerRevision: -1 }],
    ["noninteger revision", { ledgerRevision: 1.5 }],
    ["unsafe revision", { ledgerRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ["overflowing revision", { ledgerRevision: Number.MAX_SAFE_INTEGER }],
  ])("leaves all four stores unchanged for %s metadata", async (_name, change) => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    if (change === undefined) {
      await db.metadata.delete(APP_METADATA_KEY);
    } else {
      const current = await db.metadata.get(APP_METADATA_KEY);
      await db.metadata.put({ ...current, ...change } as never);
    }
    const before = await snapshot(db);

    await expect(
      new DexieFinanceUnitOfWork(db, {
        clock: () => commitTime,
      }).createTransaction(transaction(), audit("transaction.created")),
    ).rejects.toThrow();

    expect(await snapshot(db)).toEqual(before);
  });

  it.each([
    ["missing", undefined],
    ["archived", account("archived")],
    ["currency mismatch", account("active", "EUR")],
  ])("rejects a transaction when its referenced account is %s", async (_name, value) => {
    const db = createDatabase();
    await db.open();
    if (value) await db.accounts.add(value);
    const before = await snapshot(db);
    await expect(new DexieFinanceUnitOfWork(db).createTransaction(
      transaction(), audit("transaction.created"),
    )).rejects.toThrow("account");
    expect(await snapshot(db)).toEqual(before);
  });

  it("revalidates account state inside the write transaction after a stale service read", async () => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    const stale = await db.accounts.get("cash");
    expect(stale?.status).toBe("active");
    await db.accounts.update("cash", { status: "archived" });
    const before = await snapshot(db);
    await expect(new DexieFinanceUnitOfWork(db).createTransaction(
      transaction(), audit("transaction.created"),
    )).rejects.toThrow("archived");
    expect(await snapshot(db)).toEqual(before);
  });

  it.each(["replace", "delete"] as const)(
    "rejects direct %s of an opening-balance transaction",
    async (operation) => {
      const db = createDatabase();
      await db.open();
      await db.accounts.add(account());
      const opening = {
        ...transaction(),
        purpose: "opening-balance",
        categoryId: "system:opening-balance" as never,
      };
      await db.transactions.add(opening);
      const before = await snapshot(db);
      const uow = new DexieFinanceUnitOfWork(db);

      const result = operation === "replace"
        ? uow.replaceTransaction(
            opening,
            { ...opening, amount: 300 as never },
            audit("transaction.updated"),
          )
        : uow.deleteTransaction(opening, audit("transaction.deleted"));

      await expect(result).rejects.toMatchObject({
        code: "OPENING_BALANCE_PROTECTED",
      });
      expect(await snapshot(db)).toEqual(before);
    },
  );

  it("rejects when the transaction becomes an opening balance before replacement", async () => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    const expected = transaction();
    await db.transactions.add({
      ...expected,
      purpose: "opening-balance",
      categoryId: "system:opening-balance" as never,
    });
    const before = await snapshot(db);

    await expect(new DexieFinanceUnitOfWork(db).replaceTransaction(
      expected,
      { ...expected, amount: 300 as never },
      audit("transaction.updated"),
    )).rejects.toMatchObject({ code: "OPENING_BALANCE_PROTECTED" });

    expect(await snapshot(db)).toEqual(before);
  });

  it.each(["replace", "delete"] as const)(
    "rejects a stale expected record during %s without partial state",
    async (operation) => {
      const db = createDatabase();
      await db.open();
      await db.accounts.add(account());
      await seedLedger(db);
      const expected = transaction();
      await db.transactions.put({
        ...expected,
        description: "Changed elsewhere",
        updatedAt: "2026-07-28T10:30:00.000Z",
      });
      const before = await snapshot(db);
      const uow = new DexieFinanceUnitOfWork(db);

      const result = operation === "replace"
        ? uow.replaceTransaction(
            expected,
            { ...expected, amount: 300 as never },
            audit("transaction.updated"),
          )
        : uow.deleteTransaction(expected, audit("transaction.deleted"));

      await expect(result).rejects.toMatchObject({
        code: "CONCURRENT_MODIFICATION",
        field: "transactionId",
      });
      expect(await snapshot(db)).toEqual(before);
    },
  );

  it.each([
    "C:\\Users\\person\\private\\backup.json",
    "\\\\server\\share\\finance.json",
    "Transaction created\nC:\\secret",
  ])("rejects non-fixed audit descriptions without persisting %s", async (description) => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    const before = await snapshot(db);

    await expect(new DexieFinanceUnitOfWork(db).createTransaction(
      transaction(),
      { ...audit("transaction.created"), description },
    )).rejects.toThrow("description");

    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects a path-like audit timestamp without writing any state", async () => {
    const db = createDatabase();
    await db.open();
    await db.accounts.add(account());
    const before = await snapshot(db);

    await expect(new DexieFinanceUnitOfWork(db).createTransaction(
      transaction(),
      {
        ...audit("transaction.created"),
        timestamp: "C:\\Users\\person\\private.json",
      },
    )).rejects.toThrow("timestamp");

    expect(await snapshot(db)).toEqual(before);
  });
});
