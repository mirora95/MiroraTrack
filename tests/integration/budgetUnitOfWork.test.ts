import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  MiroraTrackDatabase,
} from "../../src/database/db";
import {
  DexieBudgetUnitOfWork,
  type BudgetUnitOfWorkStage,
} from "../../src/database/budgetUnitOfWork";
import { DexieBudgetReadRepository } from "../../src/database/budgetReadRepository";
import type {
  Account,
  AuditEntry,
  Budget,
  BudgetId,
  CalculationCache,
  Settings,
  Transaction,
} from "../../src/finance/types";

const initialTime = "2026-07-29T08:00:00.000Z";
const commitTime = "2026-07-29T09:00:00.000Z";
const databases = new Set<MiroraTrackDatabase>();
const names = new Set<string>();

function database(): MiroraTrackDatabase {
  const name = `budget-uow-${crypto.randomUUID()}`;
  names.add(name);
  const db = new MiroraTrackDatabase(name, () => initialTime);
  databases.add(db);
  return db;
}

function budget(
  id = "budget-1",
  changes: Partial<Budget> = {},
): Budget {
  return {
    id: id as BudgetId,
    name: "Food",
    categoryId: "food" as Budget["categoryId"],
    currency: "USD" as Budget["currency"],
    amount: 50000 as Budget["amount"],
    month: "2026-07",
    rollover: false,
    status: "active",
    createdAt: initialTime,
    updatedAt: initialTime,
    ...changes,
  };
}

function audit(
  action:
    | "budget.created"
    | "budget.updated"
    | "budget.archived"
    | "budget.reactivated"
    | "budget.deleted",
  id = "budget-1",
): AuditEntry {
  const descriptions = {
    "budget.created": "Budget created",
    "budget.updated": "Budget updated",
    "budget.archived": "Budget archived",
    "budget.reactivated": "Budget reactivated",
    "budget.deleted": "Budget deleted",
  } as const;
  return {
    id: `audit-${action}-${crypto.randomUUID()}` as AuditEntry["id"],
    timestamp: commitTime,
    action,
    entityType: "budget",
    entityId: id as BudgetId,
    description: descriptions[action],
  };
}

async function snapshot(db: MiroraTrackDatabase) {
  return {
    budgets: await db.budgets.toArray(),
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

describe("DexieBudgetUnitOfWork", () => {
  it("exposes budget reads through the application port", async () => {
    const db = database();
    await db.open();
    const settings = {
      key: "primary",
      baseCurrency: "USD",
      locale: "en-US",
      dateFormat: "yyyy-MM-dd",
      automaticBackupsEnabled: true,
    } as Settings;
    const account = {
      id: "cash",
      name: "Cash",
      type: "cash",
      status: "active",
      currency: "USD",
      color: "green",
      icon: "banknote",
      createdAt: initialTime,
      updatedAt: initialTime,
    } as Account;
    const transaction = {
      id: "expense",
      type: "expense",
      status: "completed",
      purpose: "standard",
      amount: 100,
      currency: "USD",
      sourceAccountId: account.id,
      categoryId: "food",
      effectiveAt: initialTime,
      createdAt: initialTime,
      updatedAt: initialTime,
    } as Transaction;
    await db.settings.add(settings);
    await db.accounts.add(account);
    await db.transactions.add(transaction);
    await db.budgets.bulkAdd([budget("second"), budget("first")]);
    const reads = new DexieBudgetReadRepository(db);
    expect(await reads.getBudget("first" as BudgetId)).toMatchObject({
      id: "first",
    });
    expect((await reads.listBudgets()).map(({ id }) => id)).toEqual([
      "first",
      "second",
    ]);
    expect(await reads.getSettings()).toEqual(settings);
    expect(await reads.listAccounts()).toEqual([account]);
    expect(await reads.listTransactions()).toEqual([transaction]);
  });

  it("creates an active budget atomically and invalidates derived state", async () => {
    const db = database();
    await db.open();
    await db.calculationCaches.add({
      key: "dashboard" as CalculationCache["key"],
      calculationVersion: CALCULATION_VERSION,
      sourceRevision: 0,
      value: {},
      updatedAt: initialTime,
    });

    await new DexieBudgetUnitOfWork(db, { clock: () => commitTime })
      .createBudget(budget(), audit("budget.created"));

    expect(await db.budgets.toArray()).toEqual([budget()]);
    expect(await db.auditEntries.toArray()).toEqual([
      expect.objectContaining({ action: "budget.created", entityId: "budget-1" }),
    ]);
    expect(await db.metadata.get(APP_METADATA_KEY)).toMatchObject({
      ledgerRevision: 1,
      updatedAt: commitTime,
    });
    expect(await db.calculationCaches.count()).toBe(0);
  });

  it("supports replace, archive, reactivate, and archived-only delete with full expected-record CAS", async () => {
    const db = database();
    await db.open();
    const original = budget();
    await db.budgets.add(original);
    const uow = new DexieBudgetUnitOfWork(db, { clock: () => commitTime });
    const replacement = budget("budget-1", {
      name: "Dining",
      amount: 60000 as Budget["amount"],
      updatedAt: commitTime,
    });
    await uow.replaceBudget(original, replacement, audit("budget.updated"));
    const archived = { ...replacement, status: "archived" as const };
    await uow.setBudgetStatus(
      replacement,
      archived,
      audit("budget.archived"),
    );
    const reactivated = { ...archived, status: "active" as const };
    await uow.setBudgetStatus(
      archived,
      reactivated,
      audit("budget.reactivated"),
    );
    const archivedAgain = { ...reactivated, status: "archived" as const };
    await uow.setBudgetStatus(
      reactivated,
      archivedAgain,
      audit("budget.archived"),
    );
    await uow.deleteBudget(archivedAgain, audit("budget.deleted"));
    expect(await db.budgets.count()).toBe(0);
  });

  it("rejects duplicate active scope including concurrent creates and reactivation", async () => {
    const db = database();
    await db.open();
    const first = budget("first");
    const second = budget("second");
    const uow = new DexieBudgetUnitOfWork(db);

    const results = await Promise.allSettled([
      uow.createBudget(first, audit("budget.created", "first")),
      uow.createBudget(second, audit("budget.created", "second")),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect((await db.budgets.toArray()).filter(
      ({ status }) => status === "active",
    )).toHaveLength(1);

    const archived = budget("archived", { status: "archived" });
    await db.budgets.add(archived);
    await expect(uow.setBudgetStatus(
      archived,
      { ...archived, status: "active" },
      audit("budget.reactivated", "archived"),
    )).rejects.toMatchObject({ code: "BUDGET_SCOPE_CONFLICT" });
  });

  it.each([
    ["income category", { categoryId: "salary" }],
    ["unknown category", { categoryId: "unregistered" }],
    ["invalid currency", { currency: "ZZZ" }],
    ["zero amount", { amount: 0 }],
    ["bad month", { month: "0000-01" }],
    ["rollover", { rollover: true }],
  ])("rejects %s without partial state", async (_label, changes) => {
    const db = database();
    await db.open();
    const before = await snapshot(db);
    await expect(new DexieBudgetUnitOfWork(db).createBudget(
      budget("bad", changes as Partial<Budget>),
      audit("budget.created", "bad"),
    )).rejects.toBeTruthy();
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects stale replace/status/delete, active delete, and malformed audit records", async () => {
    const db = database();
    await db.open();
    const original = budget();
    await db.budgets.add({ ...original, name: "Changed elsewhere" });
    const uow = new DexieBudgetUnitOfWork(db);
    await expect(uow.replaceBudget(
      original,
      { ...original, name: "Next" },
      audit("budget.updated"),
    )).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    await expect(uow.setBudgetStatus(
      original,
      { ...original, status: "archived" },
      audit("budget.archived"),
    )).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    await expect(uow.deleteBudget(
      { ...original, name: "Changed elsewhere" },
      audit("budget.deleted"),
    )).rejects.toMatchObject({ code: "BUDGET_MUST_BE_ARCHIVED" });
    await expect(uow.createBudget(
      budget("other"),
      { ...audit("budget.updated", "other"), entityType: "budget" } as AuditEntry,
    )).rejects.toThrow("action");
  });

  it.each([
    ["entity type", { entityType: "account" }],
    ["entity id", { entityId: "other" }],
    ["audit id", { id: "budget-1" }],
    ["description", { description: "Budget created at C:\\private" }],
    ["timestamp", { timestamp: "not-a-time" }],
  ])("rejects an invalid audit %s without partial state", async (_label, change) => {
    const db = database();
    await db.open();
    const before = await snapshot(db);
    await expect(new DexieBudgetUnitOfWork(db).createBudget(
      budget(),
      { ...audit("budget.created"), ...change } as AuditEntry,
    )).rejects.toBeTruthy();
    expect(await snapshot(db)).toEqual(before);
  });

  it("rejects stale deletion of an archived budget", async () => {
    const db = database();
    await db.open();
    const expected = budget("budget-1", { status: "archived" });
    await db.budgets.add({ ...expected, name: "Changed elsewhere" });
    const before = await snapshot(db);
    await expect(new DexieBudgetUnitOfWork(db).deleteBudget(
      expected,
      audit("budget.deleted"),
    )).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    expect(await snapshot(db)).toEqual(before);
  });

  it.each([
    "afterBudgetMutation",
    "afterAudit",
    "afterMetadata",
    "afterCacheClear",
    "beforeCommit",
  ] as const)("rolls every store back when interrupted at %s", async (stage) => {
    const db = database();
    await db.open();
    const before = await snapshot(db);
    const seen: BudgetUnitOfWorkStage[] = [];
    await expect(new DexieBudgetUnitOfWork(db, {
      onStage: (current) => {
        seen.push(current);
        if (current === stage) throw new Error(`interrupt:${stage}`);
      },
    }).createBudget(budget(), audit("budget.created"))).rejects.toThrow(
      `interrupt:${stage}`,
    );
    expect(seen).toContain(stage);
    expect(await snapshot(db)).toEqual(before);
  });
});
