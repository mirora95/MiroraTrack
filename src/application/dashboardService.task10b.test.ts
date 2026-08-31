import { describe, expect, it, vi } from "vitest";

import {
  DashboardService,
  DashboardSnapshotUnstableError,
  type DashboardPayload,
} from "./dashboardService";
import type { DashboardReadPort } from "./ports";
import type {
  Account,
  AppMetadata,
  Budget,
  CalculationCache,
  CurrencyCode,
  Settings,
  Transaction,
} from "../finance/types";

const USD = "USD" as CurrencyCode;
const EUR = "EUR" as CurrencyCode;
const metadata: AppMetadata = {
  key: "app",
  schemaVersion: 4,
  calculationVersion: 2,
  ledgerRevision: 8,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};
const settings: Settings = {
  key: "primary",
  baseCurrency: USD,
  locale: "en-US",
  dateFormat: "yyyy-MM-dd",
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
};

function account(
  id: string,
  currency = USD,
  overrides: Partial<Account> = {},
): Account {
  return {
    id: id as Account["id"],
    name: id,
    type: "checking",
    status: "active",
    currency,
    color: "blue",
    icon: "landmark",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function transaction(
  id: string,
  type: "income" | "expense" | "transfer",
  amount: number,
  effectiveAt: string,
  overrides: Record<string, unknown> = {},
): Transaction {
  const shared = {
    id: id as Transaction["id"],
    type,
    status: "completed" as const,
    purpose: "standard" as const,
    amount: amount as Transaction["amount"],
    currency: USD,
    effectiveAt,
    createdAt: effectiveAt,
    updatedAt: effectiveAt,
  };
  if (type === "income") {
    return {
      ...shared,
      type,
      destinationAccountId: "cash" as Account["id"],
      categoryId: "salary" as Extract<Transaction, { type: "income" }>["categoryId"],
      ...overrides,
    } as Transaction;
  }
  if (type === "expense") {
    return {
      ...shared,
      type,
      sourceAccountId: "cash" as Account["id"],
      categoryId: "food" as Extract<Transaction, { type: "expense" }>["categoryId"],
      ...overrides,
    } as Transaction;
  }
  return {
    ...shared,
    type,
    sourceAccountId: "cash" as Account["id"],
    destinationAccountId: "savings" as Account["id"],
    ...overrides,
  } as Transaction;
}

function budget(id: string, overrides: Partial<Budget> = {}): Budget {
  return {
    id: id as Budget["id"],
    name: "Food",
    categoryId: "food" as Budget["categoryId"],
    currency: USD,
    amount: 100 as Budget["amount"],
    month: "2026-07",
    rollover: false,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function port(overrides: Partial<DashboardReadPort> = {}): DashboardReadPort {
  return {
    getSettings: vi.fn(async () => settings),
    listAccounts: vi.fn(async () => []),
    listTransactions: vi.fn(async () => []),
    listBudgets: vi.fn(async () => []),
    getMetadata: vi.fn(async () => metadata),
    getCalculationCache: vi.fn(async () => undefined),
    putCalculationCache: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("DashboardService Task 10B projections", () => {
  it("canonicalizes equivalent direct range instants to one payload and cache key", async () => {
    const firstReads = port();
    const offsetRange = {
      start: "2026-07-01T05:00:00.000+05:00",
      end: "2026-08-01T04:59:59.999+05:00",
    };
    const first = await new DashboardService(firstReads).load({
      currency: USD,
      range: offsetRange,
    });
    const stored = (firstReads.putCalculationCache as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as CalculationCache;

    expect(first.range).toEqual({
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-31T23:59:59.999Z",
    });
    expect(stored.key).toBe(
      "dashboard:v2:USD:2026-07-01T00:00:00.000Z:2026-07-31T23:59:59.999Z:5",
    );

    const secondReads = port({
      getCalculationCache: vi.fn(async () => stored),
    });
    await expect(new DashboardService(secondReads).load({
      currency: USD,
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.999Z",
      },
    })).resolves.toBe(stored.value);
    expect(secondReads.listTransactions).not.toHaveBeenCalled();
    expect(secondReads.putCalculationCache).not.toHaveBeenCalled();
  });

  it.each([
    ["this-month", "2026-07-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z"],
    ["this-and-next-month", "2026-07-01T00:00:00.000Z", "2026-08-31T23:59:59.999Z"],
    ["last-month", "2026-06-01T00:00:00.000Z", "2026-06-30T23:59:59.999Z"],
    ["last-3-months", "2026-05-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z"],
    ["year-to-date", "2026-01-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z"],
  ] as const)("resolves the %s UTC range", async (range, start, end) => {
    const result = await new DashboardService(
      port(),
      () => "2026-07-20T18:30:00.000Z",
    ).load({ range });
    expect(result.range).toEqual({ start, end });
    expect(result.currency).toBe(USD);
  });

  it("rejects custom ranges longer than 366 inclusive UTC days", async () => {
    const subject = new DashboardService(port());
    await expect(subject.load({
      range: {
        kind: "custom",
        start: "2025-01-01",
        end: "2026-01-02",
      },
    })).rejects.toThrow("366");
  });

  it("isolates currencies and returns stable category drill-down projections", async () => {
    const transactions = [
      transaction("opening", "income", 1_000, "2026-01-01T00:00:00.000Z", {
        purpose: "opening-balance",
        categoryId: "system:opening-balance",
      }),
      transaction("food-b", "expense", 80, "2026-07-03T00:00:00.000Z"),
      transaction("food-a", "expense", 40, "2026-07-02T00:00:00.000Z"),
      transaction("housing", "expense", 60, "2026-07-04T00:00:00.000Z", {
        categoryId: "housing",
      }),
      transaction("planned", "expense", 900, "2026-07-04T00:00:00.000Z", {
        status: "planned",
      }),
      transaction("transfer", "transfer", 20, "2026-07-05T00:00:00.000Z"),
      transaction("eur", "expense", 50, "2026-07-06T00:00:00.000Z", {
        currency: EUR,
      }),
    ];
    const reads = port({
      listAccounts: vi.fn(async () => [
        account("cash"),
        account("old", USD, { status: "archived" }),
        account("eur", EUR),
      ]),
      listTransactions: vi.fn(async () => transactions),
      listBudgets: vi.fn(async () => [
        budget("food"),
        budget("archived", { status: "archived" }),
      ]),
    });
    const result = await new DashboardService(reads).load({
      range: {
        kind: "custom",
        start: "2026-07-01",
        end: "2026-07-31",
      },
    });

    expect(result.availableCurrencies).toEqual([EUR, USD]);
    expect(result.accountBalances.map((row) => row.accountId))
      .toEqual(["cash", "old"]);
    expect(result.recentTransactions.map((item) => item.id))
      .not.toContain("opening");
    expect(result.categoryBreakdown).toEqual([
      {
        categoryId: "housing",
        label: "Housing",
        amount: 60,
        percentOfExpenses: 33.33,
        transactionIds: ["housing"],
      },
      {
        categoryId: "food",
        label: "Food",
        amount: 120,
        percentOfExpenses: 66.66,
        transactionIds: ["food-a", "food-b"],
      },
    ]);
    expect(result.cashFlow.flatMap((row) => row.transactionIds))
      .toEqual(["food-a", "food-b", "housing"]);
    expect(result.budgetUsage).toEqual([
      expect.objectContaining({
        budgetId: "food",
        categoryId: "food",
        categoryLabel: "Food",
        status: "over-budget",
        transactionIds: ["food-a", "food-b"],
      }),
    ]);
  });

  it("keys caches by every normalized query field and calculation version", async () => {
    const reads = port();
    await new DashboardService(reads).load({
      currency: USD,
      range: {
        kind: "custom",
        start: "2026-07-01",
        end: "2026-07-31",
      },
      recentLimit: 7,
    });
    expect(reads.getCalculationCache).toHaveBeenCalledWith(
      "dashboard:v2:USD:2026-07-01T00:00:00.000Z:2026-07-31T23:59:59.999Z:7",
    );
  });

  it("retries changed source revisions and only returns the stable rebuild", async () => {
    const changed = { ...metadata, ledgerRevision: 9 };
    const getMetadata = vi.fn()
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce(changed)
      .mockResolvedValue(changed);
    const listTransactions = vi.fn()
      .mockResolvedValueOnce([
        transaction("stale", "income", 1, "2026-07-02T00:00:00.000Z"),
      ])
      .mockResolvedValue([
        transaction("stable", "income", 2, "2026-07-02T00:00:00.000Z"),
      ]);
    const reads = port({ getMetadata, listTransactions });

    const result = await new DashboardService(reads).load({
      currency: USD,
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.999Z",
      },
    });

    expect(result.income).toBe(2);
    expect(listTransactions).toHaveBeenCalledTimes(2);
    expect(reads.putCalculationCache).toHaveBeenCalledTimes(1);
  });

  it("fails with a retryable error after three unstable snapshots", async () => {
    let revision = 0;
    const reads = port({
      getMetadata: vi.fn(async () => ({
        ...metadata,
        ledgerRevision: revision++,
      })),
    });
    await expect(new DashboardService(reads).load({
      range: "this-month",
    })).rejects.toBeInstanceOf(DashboardSnapshotUnstableError);
    expect(reads.putCalculationCache).not.toHaveBeenCalled();
  });

  it("rejects corrupt new nested cache fields and rebuilds", async () => {
    const corrupt = {
      currency: USD,
      range: {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-31T23:59:59.999Z",
      },
      availableCurrencies: [USD],
      netWorth: 0 as DashboardPayload["netWorth"],
      income: 0 as DashboardPayload["income"],
      expenses: 0 as DashboardPayload["expenses"],
      netCashFlow: 0 as DashboardPayload["netCashFlow"],
      savingsRatePercent: null,
      accountBalances: [],
      cashFlow: [],
      budgetUsage: [],
      categoryBreakdown: [{
        categoryId: "food" as DashboardPayload["categoryBreakdown"][number]["categoryId"],
        label: "Food",
        amount: 1 as DashboardPayload["categoryBreakdown"][number]["amount"],
        percentOfExpenses: 100,
        transactionIds: ["missing" as Transaction["id"]],
      }],
      recentTransactions: [],
    } satisfies DashboardPayload;
    const reads = port({
      getCalculationCache: vi.fn(async () => ({
        key: "dashboard:v2:USD:2026-07-01T00:00:00.000Z:2026-07-31T23:59:59.999Z:5",
        calculationVersion: 2,
        sourceRevision: 8,
        value: corrupt,
        updatedAt: "2026-07-20T00:00:00.000Z",
      } as CalculationCache)),
    });

    await new DashboardService(reads).load({
      currency: USD,
      range: {
        kind: "custom",
        start: "2026-07-01",
        end: "2026-07-31",
      },
    });
    expect(reads.listTransactions).toHaveBeenCalled();
    expect(reads.putCalculationCache).toHaveBeenCalled();
  });

  it("fails closed instead of projecting duplicate active budget scopes", async () => {
    const reads = port({
      listBudgets: vi.fn(async () => [
        budget("first"),
        budget("second"),
      ]),
    });
    await expect(new DashboardService(reads).load({
      currency: USD,
      range: {
        kind: "custom",
        start: "2026-07-01",
        end: "2026-07-31",
      },
    })).rejects.toThrow("Duplicate active budget scope");
    expect(reads.putCalculationCache).not.toHaveBeenCalled();
  });

  it("keeps legacy expense categories in a deterministic trailing breakdown", async () => {
    const reads = port({
      listAccounts: vi.fn(async () => [account("cash")]),
      listTransactions: vi.fn(async () => [
        transaction("known", "expense", 20, "2026-07-01T00:00:00.000Z"),
        transaction("legacy-z", "expense", 30, "2026-07-02T00:00:00.000Z", {
          categoryId: "legacy-z",
        }),
        transaction("legacy-a", "expense", 50, "2026-07-03T00:00:00.000Z", {
          categoryId: "legacy-a",
        }),
      ]),
    });
    const subject = new DashboardService(reads);
    const query = {
      currency: USD,
      range: {
        kind: "custom" as const,
        start: "2026-07-01",
        end: "2026-07-31",
      },
    };

    const first = await subject.load(query);
    expect(first.categoryBreakdown.map((row) => [
      row.categoryId,
      row.label,
    ])).toEqual([
      ["food", "Food"],
      ["legacy-a", "Other"],
      ["legacy-z", "Other"],
    ]);
    const cached = (reads.putCalculationCache as ReturnType<typeof vi.fn>)
      .mock.calls[0]![0] as CalculationCache;
    const cacheReads = port({
      getCalculationCache: vi.fn(async () => cached),
    });
    await expect(new DashboardService(cacheReads).load(query))
      .resolves.toBe(cached.value);
    expect(cacheReads.listTransactions).not.toHaveBeenCalled();
  });

  it("accepts a fully valid current nested dashboard cache as a true hit", async () => {
    const cached = validCurrentCache();
    const reads = port({
      getCalculationCache: vi.fn(async () => cached),
    });
    await expect(new DashboardService(reads).load({
      currency: USD,
      range: cached.value.range,
    })).resolves.toBe(cached.value);
    expect(reads.listAccounts).not.toHaveBeenCalled();
    expect(reads.listTransactions).not.toHaveBeenCalled();
    expect(reads.putCalculationCache).not.toHaveBeenCalled();
  });

  it.each([
    ["a boxed timestamp", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        effectiveAt: new String("2026-07-02T00:00:00.000Z"),
      }],
    })],
    ["a boxed account type", (payload: DashboardPayload) => ({
      ...payload,
      accountBalances: [{
        ...payload.accountBalances[0]!,
        type: new String("checking"),
      }],
    })],
    ["a boxed account status", (payload: DashboardPayload) => ({
      ...payload,
      accountBalances: [{
        ...payload.accountBalances[0]!,
        status: new String("active"),
      }],
    })],
    ["a boxed transaction type", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        type: new String("expense"),
      }],
    })],
    ["a boxed transaction status", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        status: new String("completed"),
      }],
    })],
    ["a boxed transaction account id", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        sourceAccountId: new String("cash"),
      }],
    })],
    ["a boxed transaction category id", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        categoryId: new String("food"),
      }],
    })],
    ["a boxed cash-flow date", (payload: DashboardPayload) => ({
      ...payload,
      cashFlow: [{
        ...payload.cashFlow[0]!,
        date: new String("2026-07-02"),
      }],
    })],
    ["a boxed budget month", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [{
        ...payload.budgetUsage[0]!,
        month: new String("2026-07"),
      }],
    })],
    ["a boxed budget status", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [{
        ...payload.budgetUsage[0]!,
        status: new String("on-track"),
      }],
    })],
    ["a boxed budget category label", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [{
        ...payload.budgetUsage[0]!,
        categoryLabel: new String("Food"),
      }],
    })],
    ["a noncanonical offset timestamp", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        effectiveAt: "2026-07-02T05:00:00.000+05:00",
      }],
    })],
    ["a zero transaction amount", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        amount: 0,
      }],
    })],
    ["an income category on expense", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        categoryId: "salary",
      }],
    })],
    ["an unknown source account", (payload: DashboardPayload) => ({
      ...payload,
      recentTransactions: [{
        ...payload.recentTransactions[0]!,
        sourceAccountId: "missing-account",
      }],
    })],
    ["a mismatched budget category label", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [{
        ...payload.budgetUsage[0]!,
        categoryLabel: "Dining",
      }],
    })],
    ["a mismatched budget name", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [{
        ...payload.budgetUsage[0]!,
        name: "Dining",
      }],
    })],
    ["a repeated cash-flow drill-down id", (payload: DashboardPayload) => ({
      ...payload,
      cashFlow: [
        {
          ...payload.cashFlow[0]!,
          expenses: 5 as DashboardPayload["expenses"],
          netCashFlow: -5 as DashboardPayload["netCashFlow"],
        },
        {
          date: "2026-07-03",
          income: 0 as DashboardPayload["income"],
          expenses: 5 as DashboardPayload["expenses"],
          netCashFlow: -5 as DashboardPayload["netCashFlow"],
          transactionIds: [payload.recentTransactions[0]!.id],
        },
      ],
    })],
    ["a repeated category drill-down id", (payload: DashboardPayload) => ({
      ...payload,
      categoryBreakdown: [
        {
          categoryId: "housing" as Budget["categoryId"],
          label: "Housing",
          amount: 5 as DashboardPayload["expenses"],
          percentOfExpenses: 50,
          transactionIds: [payload.recentTransactions[0]!.id],
        },
        {
          ...payload.categoryBreakdown[0]!,
          amount: 5 as DashboardPayload["expenses"],
          percentOfExpenses: 50,
        },
      ],
    })],
    ["a repeated budget drill-down id", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [
        payload.budgetUsage[0]!,
        {
          ...payload.budgetUsage[0]!,
          budgetId: "housing-budget" as Budget["id"],
          name: "Housing",
          categoryId: "housing" as Budget["categoryId"],
          categoryLabel: "Housing",
          budgeted: 20 as Budget["amount"],
          spent: 0 as DashboardPayload["expenses"],
          remaining: 20 as Budget["amount"],
          percentUsed: 0,
          status: "on-track" as const,
        },
      ],
    })],
    ["canonically valid budget rows in reverse order", (payload: DashboardPayload) => ({
      ...payload,
      budgetUsage: [...payload.budgetUsage].reverse(),
    })],
  ])("rebuilds a cache containing %s", async (_label, corrupt) => {
    const cached = validCurrentCache();
    const reads = port({
      getCalculationCache: vi.fn(async () => ({
        ...cached,
        value: corrupt(cached.value),
      })),
    });
    await new DashboardService(reads).load({
      currency: USD,
      range: cached.value.range,
    });
    expect(reads.listTransactions).toHaveBeenCalled();
    expect(reads.putCalculationCache).toHaveBeenCalled();
  });
});

function validCurrentCache(): CalculationCache & { value: DashboardPayload } {
  const recent = transaction(
    "food-expense",
    "expense",
    10,
    "2026-07-02T00:00:00.000Z",
  );
  const value: DashboardPayload = {
    currency: USD,
    availableCurrencies: [USD],
    range: {
      start: "2026-07-01T00:00:00.000Z",
      end: "2026-07-31T23:59:59.999Z",
    },
    netWorth: -10 as DashboardPayload["netWorth"],
    income: 0 as DashboardPayload["income"],
    expenses: 10 as DashboardPayload["expenses"],
    netCashFlow: -10 as DashboardPayload["netCashFlow"],
    savingsRatePercent: null,
    accountBalances: [{
      accountId: "cash" as Account["id"],
      name: "Cash",
      type: "checking",
      status: "active",
      balance: -10 as DashboardPayload["netWorth"],
    }],
    cashFlow: [{
      date: "2026-07-02",
      income: 0 as DashboardPayload["income"],
      expenses: 10 as DashboardPayload["expenses"],
      netCashFlow: -10 as DashboardPayload["netCashFlow"],
      transactionIds: [recent.id],
    }],
    budgetUsage: [{
      budgetId: "food-budget" as Budget["id"],
      name: "Food",
      categoryId: "food" as Budget["categoryId"],
      categoryLabel: "Food",
      month: "2026-07",
      budgeted: 20 as Budget["amount"],
      spent: 10 as DashboardPayload["expenses"],
      remaining: 10 as Budget["amount"],
      percentUsed: 50,
      status: "on-track",
      transactionIds: [recent.id],
    }, {
      budgetId: "housing-budget" as Budget["id"],
      name: "Housing",
      categoryId: "housing" as Budget["categoryId"],
      categoryLabel: "Housing",
      month: "2026-07",
      budgeted: 20 as Budget["amount"],
      spent: 0 as DashboardPayload["expenses"],
      remaining: 20 as Budget["amount"],
      percentUsed: 0,
      status: "on-track",
      transactionIds: [],
    }],
    categoryBreakdown: [{
      categoryId: "food" as Budget["categoryId"],
      label: "Food",
      amount: 10 as DashboardPayload["expenses"],
      percentOfExpenses: 100,
      transactionIds: [recent.id],
    }],
    recentTransactions: [recent],
  };
  return {
    key: "dashboard:v2:USD:2026-07-01T00:00:00.000Z:2026-07-31T23:59:59.999Z:5" as CalculationCache["key"],
    calculationVersion: 2,
    sourceRevision: 8,
    value,
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}
