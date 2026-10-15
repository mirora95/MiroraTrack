import { describe, expect, it, vi } from "vitest";

import type { BackupPort, TransactionReadPort } from "./ports";
import {
  TransactionService,
  type TransactionFilters,
} from "./transactionService";
import type {
  Account,
  AccountId,
  CategoryId,
  CurrencyCode,
  Transaction,
  TransactionId,
} from "../finance/types";

const USD = "USD" as CurrencyCode;
const EUR = "EUR" as CurrencyCode;

function account(id: string, name: string): Account {
  return {
    id: id as AccountId,
    name,
    type: "checking",
    status: "active",
    currency: id === "eur" ? EUR : USD,
    color: "blue",
    icon: "landmark",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function transaction(
  id: string,
  overrides: Record<string, unknown> = {},
): Transaction {
  return {
    id: id as TransactionId,
    type: "expense",
    status: "completed",
    purpose: "standard",
    amount: 100 as Transaction["amount"],
    currency: USD,
    effectiveAt: "2026-07-15T12:00:00.000Z",
    sourceAccountId: "cash" as AccountId,
    categoryId: "food" as CategoryId,
    description: "Lunch",
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  } as Transaction;
}

function setup(records: readonly Transaction[]) {
  const reads: TransactionReadPort = {
    listTransactions: vi.fn(async () => records),
    listAccounts: vi.fn(async () => [
      account("cash", "Everyday cash"),
      account("eur", "Euro wallet"),
    ]),
  };
  const backups: Pick<BackupPort, "exportCsv"> = {
    exportCsv: vi.fn(async () => ({
      success: true as const,
      path: "C:\\Exports\\transactions.csv",
      directory: "C:\\Exports",
    })),
  };
  return {
    service: new TransactionService(reads, backups),
    reads,
    backups,
  };
}

describe("TransactionService", () => {
  it("filters search, type, status, account, category, currency and inclusive UTC dates", async () => {
    const records = [
      transaction("match", {
        effectiveAt: "2026-07-31T23:59:59.999Z",
        description: "Airport lunch",
      }),
      transaction("too-late", {
        effectiveAt: "2026-08-01T00:00:00.000Z",
        description: "Airport lunch",
      }),
      transaction("wrong-account", {
        sourceAccountId: "eur" as AccountId,
        currency: EUR,
        description: "Airport lunch",
      }),
      transaction("opening", {
        type: "income",
        purpose: "opening-balance",
        destinationAccountId: "cash" as AccountId,
        sourceAccountId: undefined,
        categoryId: "system:opening-balance" as CategoryId,
        description: undefined,
      }),
    ];
    const { service } = setup(records);

    const result = await service.list({
      search: "airport",
      type: "expense",
      status: "completed",
      accountId: "cash",
      categoryId: "food",
      currency: "USD",
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      page: 1,
      pageSize: 25,
    });

    expect(result.items.map(({ transaction: item }) => item.id)).toEqual([
      "match",
    ]);
    expect(result.total).toBe(1);
  });

  it("sorts deterministically, paginates, and summarizes every matching currency independently", async () => {
    const records = [
      transaction("b", { amount: 300 as never }),
      transaction("a", { amount: 200 as never }),
      transaction("income", {
        type: "income",
        destinationAccountId: "cash" as AccountId,
        sourceAccountId: undefined,
        categoryId: "salary" as CategoryId,
        amount: 900 as never,
        createdAt: "2026-07-16T00:00:00.000Z",
      }),
      transaction("eur-expense", {
        sourceAccountId: "eur" as AccountId,
        currency: EUR,
        amount: 50 as never,
        createdAt: "2026-07-14T00:00:00.000Z",
      }),
      transaction("planned", {
        status: "planned",
        amount: 999 as never,
        createdAt: "2026-07-17T00:00:00.000Z",
      }),
    ];
    const { service } = setup(records);

    const result = await service.list({ page: 1, pageSize: 25 });

    expect(result.items.map(({ transaction: item }) => item.id)).toEqual([
      "a", "b", "eur-expense", "income", "planned",
    ]);
    expect(result.total).toBe(5);
    expect(result.pageCount).toBe(1);
    expect(result.summaries).toEqual([
      { currency: EUR, income: 0, expenses: 50, net: -50 },
      { currency: USD, income: 900, expenses: 500, net: 400 },
    ]);
    expect(result.facets.types).toEqual({
      expense: 4,
      income: 1,
      transfer: 0,
    });
  });

  it.each(["newest", "oldest"] as const)(
    "orders offset timestamps chronologically for %s lists and CSV exports",
    async (sort) => {
      const records = [
        transaction("earliest", { effectiveAt: "2026-07-16T00:15:00+05:00" }),
        transaction("middle", { effectiveAt: "2026-07-15T20:00:00-04:00" }),
        transaction("latest", { effectiveAt: "2026-07-16T00:30:00.000Z" }),
      ];
      const { service, backups } = setup(records);
      const filters = { page: 1, pageSize: 25, sort } as const;
      const expected = sort === "newest"
        ? ["latest", "middle", "earliest"]
        : ["earliest", "middle", "latest"];

      const result = await service.list(filters);
      expect(result.items.map(({ transaction: item }) => item.id)).toEqual(expected);

      await service.exportFiltered(filters);
      const csv = vi.mocked(backups.exportCsv).mock.calls[0]![0];
      expect(csv.trimEnd().split("\r\n").slice(1).map((row) => row.split(",")[0]))
        .toEqual(expected);
      expect(records.map((item) => item.id)).toEqual(["earliest", "middle", "latest"]);
    },
  );

  it.each(["newest", "oldest"] as const)(
    "orders timestamps with optional milliseconds chronologically for %s",
    async (sort) => {
      const { service } = setup([
        transaction("earlier", { effectiveAt: "2026-07-15T12:00:00Z" }),
        transaction("later", { effectiveAt: "2026-07-15T12:00:00.100Z" }),
      ]);

      const result = await service.list({ page: 1, pageSize: 25, sort });
      expect(result.items.map(({ transaction: item }) => item.id)).toEqual(
        sort === "newest" ? ["later", "earlier"] : ["earlier", "later"],
      );
    },
  );

  it.each(["newest", "oldest"] as const)(
    "uses the id tie-breaker for equal instants with different timestamp text for %s",
    async (sort) => {
      const { service } = setup([
        transaction("c", { effectiveAt: "2026-07-15T17:00:00+05:00" }),
        transaction("b", { effectiveAt: "2026-07-15T12:00:00Z" }),
        transaction("a", { effectiveAt: "2026-07-15T12:00:00.000Z" }),
      ]);

      const result = await service.list({ page: 1, pageSize: 25, sort });
      expect(result.items.map(({ transaction: item }) => item.id)).toEqual(["a", "b", "c"]);
    },
  );

  it("keeps equal instants in id order across a page boundary", async () => {
    const { service } = setup([
      transaction("z", { effectiveAt: "2026-07-15T17:00:00+05:00" }),
      ...Array.from({ length: 24 }, (_, index) => transaction(`recent-${index}`, {
        effectiveAt: "2026-07-16T12:00:00.000Z",
      })),
      transaction("a", { effectiveAt: "2026-07-15T12:00:00.000Z" }),
    ]);

    const first = await service.list({ page: 1, pageSize: 25 });
    const second = await service.list({ page: 2, pageSize: 25 });
    expect(first.items.at(-1)?.transaction.id).toBe("a");
    expect(second.items.map(({ transaction: item }) => item.id)).toEqual(["z"]);
    expect(second.total).toBe(26);
    expect(second.pageCount).toBe(2);
  });

  it("uses safe labels for opening balances and missing accounts", async () => {
    const { service } = setup([
      transaction("opening", {
        type: "income",
        purpose: "opening-balance",
        destinationAccountId: "missing" as AccountId,
        sourceAccountId: undefined,
        categoryId: "system:opening-balance" as CategoryId,
        description: undefined,
      }),
    ]);

    const result = await service.list({ page: 1, pageSize: 25 });

    expect(result.items[0]).toMatchObject({
      categoryLabel: "Opening balance",
      destinationAccountLabel: "Unavailable account",
    });
    expect(result.facets.categories).toEqual([]);
  });

  it.each([
    [{ page: 0, pageSize: 25 }, "page"],
    [{ page: 1, pageSize: 20 }, "pageSize"],
    [{ page: 1, pageSize: 25, currency: "usd" }, "currency"],
    [{ page: 1, pageSize: 25, accountId: "   " }, "accountId"],
    [{ page: 1, pageSize: 25, categoryId: "system:opening-balance" }, "categoryId"],
    [{ page: 1, pageSize: 25, fromDate: "2026-02-30" }, "fromDate"],
    [{ page: 1, pageSize: 25, toDate: "07/31/2026" }, "toDate"],
    [{
      page: 1,
      pageSize: 25,
      fromDate: "2026-08-01",
      toDate: "2026-07-01",
    }, "dateRange"],
  ] as const)("rejects invalid query input for %s", async (filters, field) => {
    const { service, reads } = setup([]);
    await expect(service.list(filters as TransactionFilters)).rejects
      .toMatchObject({ code: "INVALID_FILTER", field });
    expect(reads.listTransactions).not.toHaveBeenCalled();
  });

  it("exports every filtered row regardless of the current page through the hardened CSV port", async () => {
    const records = Array.from({ length: 27 }, (_, index) =>
      transaction(`tx-${index}`, {
        description: index === 1 ? "=HYPERLINK(\"C:\\secret\")" : "Meal",
        ...(index === 26
          ? {
              sourceAccountId: "eur" as AccountId,
              currency: EUR,
            }
          : {}),
      }));
    const { service, backups } = setup(records);

    const result = await service.exportFiltered({
      search: "meal",
      page: 1,
      pageSize: 25,
    });

    expect(result).toMatchObject({ success: true });
    const csv = vi.mocked(backups.exportCsv).mock.calls[0]?.[0] ?? "";
    expect(csv.match(/^tx-/gm)).toHaveLength(26);
    expect(csv).not.toMatch(/^tx-1,/m);
    expect(csv).toContain(",EUR,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("matches safe account/category labels but never raw internal ids", async () => {
    const { service } = setup([
      transaction("opaque-ledger-id", {
        sourceAccountId: "cash" as AccountId,
        categoryId: "food" as CategoryId,
        description: undefined,
      }),
    ]);
    await expect(service.list({
      search: "everyday cash",
      page: 1,
      pageSize: 25,
    })).resolves.toMatchObject({ total: 1 });
    await expect(service.list({
      search: "opaque-ledger-id",
      page: 1,
      pageSize: 25,
    })).resolves.toMatchObject({ total: 0 });
    await expect(service.list({
      search: "food",
      page: 1,
      pageSize: 25,
    })).resolves.toMatchObject({ total: 1 });
  });

  it("paginates by the closed page sizes without changing totals", async () => {
    const { service } = setup(
      Array.from({ length: 26 }, (_, index) => transaction(`tx-${index.toString().padStart(2, "0")}`)),
    );
    const result = await service.list({ page: 2, pageSize: 25 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(26);
    expect(result.pageCount).toBe(2);
  });

  it("passes cancellation and safe failure outcomes through unchanged", async () => {
    const { service, backups } = setup([]);
    vi.mocked(backups.exportCsv)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        success: false,
        errorCode: "PERMISSION_DENIED",
        message: "Access denied",
      });

    await expect(service.exportFiltered({ page: 1, pageSize: 25 })).resolves.toBeNull();
    await expect(service.exportFiltered({ page: 1, pageSize: 25 })).resolves.toEqual({
      success: false,
      errorCode: "PERMISSION_DENIED",
      message: "Access denied",
    });
  });
});
