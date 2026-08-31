import { describe, expect, it, vi } from "vitest";

import {
  BudgetService,
  type BudgetServiceDependencies,
} from "./budgetService";
import type { BudgetReadPort, BudgetUnitOfWork } from "./ports";
import type {
  Account,
  AuditEntryId,
  Budget,
  BudgetId,
  CurrencyCode,
  Settings,
  Transaction,
} from "../finance/types";

const USD = "USD" as CurrencyCode;
const EUR = "EUR" as CurrencyCode;
const now = "2026-07-20T12:00:00.000Z";
const settings: Settings = {
  key: "primary",
  baseCurrency: USD,
  locale: "en-US",
  dateFormat: "yyyy-MM-dd",
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
};

function budget(
  id: string,
  overrides: Partial<Budget> = {},
): Budget {
  return {
    id: id as BudgetId,
    name: "Food",
    categoryId: "food" as Budget["categoryId"],
    currency: USD,
    amount: 50_000 as Budget["amount"],
    month: "2026-07",
    rollover: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function expense(
  id: string,
  amount: number,
  overrides: Partial<Extract<Transaction, { type: "expense" }>> = {},
): Transaction {
  return {
    id: id as Transaction["id"],
    type: "expense",
    status: "completed",
    purpose: "standard",
    amount: amount as Transaction["amount"],
    currency: USD,
    sourceAccountId: "cash" as Account["id"],
    categoryId: "food" as Budget["categoryId"],
    effectiveAt: "2026-07-10T00:00:00.000Z",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function reads(
  overrides: Partial<BudgetReadPort> = {},
): BudgetReadPort {
  return {
    getSettings: vi.fn(async () => settings),
    getBudget: vi.fn(async () => undefined),
    listBudgets: vi.fn(async () => []),
    listTransactions: vi.fn(async () => []),
    listAccounts: vi.fn(async () => []),
    ...overrides,
  };
}

function uow(): BudgetUnitOfWork {
  return {
    createBudget: vi.fn(async () => undefined),
    replaceBudget: vi.fn(async () => undefined),
    setBudgetStatus: vi.fn(async () => undefined),
    deleteBudget: vi.fn(async () => undefined),
  };
}

function service(
  overrides: Partial<BudgetServiceDependencies> = {},
): { service: BudgetService; writes: BudgetUnitOfWork } {
  const writes = uow();
  return {
    writes,
    service: new BudgetService({
      reads: reads(),
      uow: writes,
      budgetId: () => "budget-new" as BudgetId,
      auditId: () => "audit-new" as AuditEntryId,
      clock: () => now,
      ...overrides,
    }),
  };
}

describe("BudgetService commands", () => {
  it("discovers custom categories from budgets and transactions", async () => {
    const { service: subject } = service({
      reads: reads({
        listBudgets: vi.fn(async () => [budget("pet-budget", {
          categoryId: "custom:expense:pet care" as Budget["categoryId"],
        })]),
        listTransactions: vi.fn(async () => [expense("side-job", 100, {
          categoryId: "custom:expense:pet care" as Budget["categoryId"],
        }), expense("medical", 200, {
          categoryId: "custom:expense:medical" as Budget["categoryId"],
        })]),
      }),
    });

    await expect(subject.listCategoryIds()).resolves.toEqual([
      "custom:expense:medical",
      "custom:expense:pet care",
    ]);
  });

  it("creates a catalog-derived monthly budget in exact minor units", async () => {
    const { service: subject, writes } = service();

    const created = await subject.create({
      categoryId: "food",
      currency: "USD",
      amount: "500.25",
      month: "2026-07",
    });

    expect(created).toEqual(budget("budget-new", {
      amount: 50_025 as Budget["amount"],
    }));
    expect(writes.createBudget).toHaveBeenCalledWith(
      created,
      expect.objectContaining({
        id: "audit-new",
        action: "budget.created",
        entityType: "budget",
        entityId: "budget-new",
        description: "Budget created",
      }),
    );
  });

  it.each([
    [{ categoryId: "salary", currency: "USD", amount: "10", month: "2026-07" }, "INVALID_CATEGORY"],
    [{ categoryId: "food", currency: "ZZZ", amount: "10", month: "2026-07" }, "INVALID_CURRENCY"],
    [{ categoryId: "food", currency: "USD", amount: "0", month: "2026-07" }, "INVALID_AMOUNT"],
    [{ categoryId: "food", currency: "USD", amount: "0.001", month: "2026-07" }, "INVALID_AMOUNT"],
    [{ categoryId: "food", currency: "USD", amount: "10", month: "2026-13" }, "INVALID_DATE"],
  ])("rejects invalid draft %#", async (draft, code) => {
    const { service: subject, writes } = service();
    await expect(subject.create(draft)).rejects.toMatchObject({ code });
    expect(writes.createBudget).not.toHaveBeenCalled();
  });

  it("uses the complete previously read budget for replace and lifecycle commands", async () => {
    const current = budget("budget");
    const source = reads({ getBudget: vi.fn(async () => current) });
    const { service: subject, writes } = service({ reads: source });

    await subject.update("budget", {
      categoryId: "utilities",
      currency: "EUR",
      amount: "20",
      month: "2026-08",
    });
    await subject.archive("budget");
    await subject.delete("budget");

    expect(writes.replaceBudget).toHaveBeenCalledWith(
      current,
      expect.objectContaining({
        id: current.id,
        name: "Utilities",
        categoryId: "utilities",
        currency: EUR,
        amount: 2_000,
        month: "2026-08",
        status: "active",
        createdAt: current.createdAt,
      }),
      expect.objectContaining({ action: "budget.updated" }),
    );
    expect(writes.setBudgetStatus).toHaveBeenCalledWith(
      current,
      expect.objectContaining({ status: "archived" }),
      expect.objectContaining({ action: "budget.archived" }),
    );
    expect(writes.deleteBudget).toHaveBeenCalledWith(
      current,
      expect.objectContaining({ action: "budget.deleted" }),
    );
  });

  it("reactivates archived budgets and rejects missing records", async () => {
    const archived = budget("budget", { status: "archived" });
    const source = reads({ getBudget: vi.fn(async () => archived) });
    const { service: subject, writes } = service({ reads: source });

    await subject.reactivate("budget");
    expect(writes.setBudgetStatus).toHaveBeenCalledWith(
      archived,
      expect.objectContaining({ status: "active" }),
      expect.objectContaining({ action: "budget.reactivated" }),
    );

    await expect(service().service.archive("missing"))
      .rejects.toMatchObject({ code: "BUDGET_NOT_FOUND" });
  });

  it("does not generate a known budget id or an audit id equal to the entity id", async () => {
    const source = reads({
      getBudget: vi.fn(async (id) =>
        id === ("collision" as BudgetId) ? budget("collision") : undefined),
    });
    const ids = ["collision", "fresh"];
    const audits = ["fresh", "audit"];
    const writes = uow();
    const subject = new BudgetService({
      reads: source,
      uow: writes,
      budgetId: () => ids.shift() as BudgetId,
      auditId: () => audits.shift() as AuditEntryId,
      clock: () => now,
    });

    await expect(subject.create({
      categoryId: "food", currency: "USD", amount: "1", month: "2026-07",
    })).resolves.toMatchObject({ id: "fresh" });
    expect(writes.createBudget).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fresh" }),
      expect.objectContaining({ id: "audit" }),
    );
  });
});

describe("BudgetService projections", () => {
  it("lists the base currency by default and counts only matching completed standard expenses", async () => {
    const active = budget("active");
    const archived = budget("archived", { status: "archived" });
    const transactions: Transaction[] = [
      expense("used", 40_000),
      expense("planned", 9_000, { status: "planned" }),
      expense("cancelled", 8_000, { status: "cancelled" }),
      expense("opening", 7_000, { purpose: "opening-balance" }),
      expense("other-month", 6_000, { effectiveAt: "2026-08-01T00:00:00.000Z" }),
      expense("other-category", 5_000, { categoryId: "utilities" as Budget["categoryId"] }),
      expense("other-currency", 4_000, { currency: EUR }),
    ];
    const subject = service({
      reads: reads({
        listBudgets: vi.fn(async () => [archived, active]),
        listTransactions: vi.fn(async () => transactions),
      }),
    }).service;

    const result = await subject.list({ month: "2026-07" });

    expect(result).toMatchObject({
      currency: USD,
      month: "2026-07",
      totals: {
        budgeted: 50_000,
        spent: 40_000,
        remaining: 10_000,
      },
      rows: [{
        budget: active,
        categoryLabel: "Food",
        budgeted: 50_000,
        spent: 40_000,
        remaining: 10_000,
        percentUsed: 80,
        status: "warning",
        transactionIds: ["used"],
      }],
    });
  });

  it("includes archived rows on request and reports over-budget totals", async () => {
    const archived = budget("archived", {
      amount: 100 as Budget["amount"],
      status: "archived",
    });
    const subject = service({
      reads: reads({
        listBudgets: vi.fn(async () => [archived]),
        listTransactions: vi.fn(async () => [expense("expense", 150)]),
      }),
    }).service;

    const result = await subject.list({
      month: "2026-07",
      currency: EUR,
      includeArchived: true,
    });
    expect(result.rows).toEqual([]);

    const usd = await subject.list({
      month: "2026-07",
      currency: USD,
      includeArchived: true,
    });
    expect(usd.rows[0]).toMatchObject({
      status: "over-budget",
      remaining: -50,
      percentUsed: 150,
    });
    expect(usd.totals).toEqual({
      budgeted: 100,
      spent: 150,
      remaining: -50,
    });
  });

  it("assigns expenses to budget months by their UTC instant", async () => {
    const subject = service({
      reads: reads({
        listBudgets: vi.fn(async () => [budget("food")]),
        listTransactions: vi.fn(async () => [
          expense("crosses-month", 125, {
            effectiveAt: "2026-06-30T23:30:00.000-02:00",
          }),
        ]),
      }),
    }).service;

    const result = await subject.list({ month: "2026-07" });
    expect(result.rows[0]).toMatchObject({
      spent: 125,
      transactionIds: ["crosses-month"],
    });
  });

  it("fails closed on duplicate active stored scopes", async () => {
    const subject = service({
      reads: reads({
        listBudgets: vi.fn(async () => [
          budget("first"),
          budget("second"),
        ]),
      }),
    }).service;

    await expect(subject.list({ month: "2026-07" }))
      .rejects.toThrow("Duplicate active budget scope");
  });

  it("returns stable unique available currencies from settings and stored data", async () => {
    const subject = service({
      reads: reads({
        listAccounts: vi.fn(async () => [
          { currency: EUR } as Account,
          { currency: USD } as Account,
        ]),
        listBudgets: vi.fn(async () => [
          budget("usd"),
          budget("eur", { currency: EUR }),
        ]),
        listTransactions: vi.fn(async () => [
          expense("eur", 1, { currency: EUR }),
        ]),
      }),
    }).service;

    await expect(subject.availableCurrencies()).resolves.toEqual([EUR, USD]);
  });

  it("fails closed when aggregate arithmetic exceeds safe minor units", async () => {
    const subject = service({
      reads: reads({
        listBudgets: vi.fn(async () => [
          budget("a", { amount: Number.MAX_SAFE_INTEGER as Budget["amount"] }),
          budget("b", {
            categoryId: "utilities" as Budget["categoryId"],
            name: "Utilities",
            amount: 1 as Budget["amount"],
          }),
        ]),
      }),
    }).service;
    await expect(subject.list({ month: "2026-07" }))
      .rejects.toThrow("safe integer");
  });
});
