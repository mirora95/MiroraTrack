import { describe, expect, it } from "vitest";

import type {
  Account,
  AccountId,
  CategoryId,
  CurrencyCode,
  Transaction,
} from "./types";
import { minorAmount } from "./types";
import { deriveBalance, deriveBalances, summarize } from "./ledger";

const USD = "USD" as CurrencyCode;
const EUR = "EUR" as CurrencyCode;
const FOOD = "food" as CategoryId;

function account(
  id: string,
  currency: CurrencyCode = USD,
): Account {
  return {
    id: id as AccountId,
    name: id,
    type: "checking",
    status: "active",
    currency,
    color: "blue",
    icon: "landmark",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function tx(
  type: Transaction["type"],
  amount: number,
  options: {
    status?: Transaction["status"];
    currency?: CurrencyCode;
    effectiveAt?: string;
    source?: string;
    destination?: string;
  } = {},
): Transaction {
  const shared = {
    id: `${type}-${amount}-${options.effectiveAt ?? "at"}`,
    status: options.status ?? "completed",
    purpose: "standard",
    amount: amount as Transaction["amount"],
    currency: options.currency ?? USD,
    effectiveAt: options.effectiveAt ?? "2026-01-15T12:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  if (type === "income") {
    return {
      ...shared,
      type,
      destinationAccountId: (options.destination ?? "checking") as AccountId,
      categoryId: FOOD,
    } as Transaction;
  }
  if (type === "expense") {
    return {
      ...shared,
      type,
      sourceAccountId: (options.source ?? "checking") as AccountId,
      categoryId: FOOD,
    } as Transaction;
  }
  return {
    ...shared,
    type,
    sourceAccountId: (options.source ?? "checking") as AccountId,
    destinationAccountId: (options.destination ?? "savings") as AccountId,
  } as Transaction;
}

describe("deriveBalance", () => {
  it("derives an opening balance only from its completed ledger transaction", () => {
    const cash = account("cash");
    expect(deriveBalance(cash, [{
      ...tx("income", 500_00, { destination: "cash" }),
      purpose: "opening-balance",
      categoryId: "system:opening-balance" as never,
    }])).toBe(500_00);
  });
  it("applies completed income, expense, and transfer effects", () => {
    const checking = account("checking");
    expect(
      deriveBalance(checking, [
        tx("income", 500),
        { ...tx("income", 100), purpose: "opening-balance" },
        tx("expense", 125),
        tx("transfer", 200, { source: "checking", destination: "savings" }),
        tx("transfer", 50, { source: "cash", destination: "checking" }),
      ]),
    ).toBe(325);
    expect(
      deriveBalance(account("savings"), [
        tx("transfer", 200, { source: "checking", destination: "savings" }),
      ]),
    ).toBe(200);
  });

  it("ignores unrelated, planned, cancelled, and unknown-reference records", () => {
    expect(
      deriveBalance(account("checking"), [
        tx("income", 90, { destination: "other" }),
        tx("expense", 10, { status: "planned" }),
        tx("expense", 10, { status: "cancelled" }),
      ]),
    ).toBe(0);
  });

  it("validates relevant amounts, currencies, timestamps, ranges, and self-transfers", () => {
    const checking = account("checking");
    expect(() =>
      deriveBalance(checking, [tx("income", -1)], undefined),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [tx("income", Number.MAX_SAFE_INTEGER + 1)]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [tx("income", 1, { currency: EUR })]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [tx("income", 1, { effectiveAt: "2026-01-01" })]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [
        tx("income", 1, { effectiveAt: "2026-02-30T00:00:00Z" }),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [
        tx("income", 1, { effectiveAt: "2016-12-31T23:59:60Z" }),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [
        tx("income", 1, { effectiveAt: "0000-02-29T00:00:00Z" }),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [
        tx("income", 1, { effectiveAt: "0000-01-01T00:00:00Z" }),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [
        tx("transfer", 1, { source: "checking", destination: "checking" }),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(checking, [], {
        start: "2026-02-01T00:00:00Z",
        end: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(RangeError);
  });

  it("uses inclusive instant boundaries with explicit RFC3339 offsets", () => {
    expect(
      deriveBalance(
        account("checking"),
        [
          tx("income", 2, { effectiveAt: "2026-01-01T05:00:00+05:00" }),
          tx("income", 3, { effectiveAt: "2026-01-31T19:00:00-05:00" }),
          tx("income", 9, { effectiveAt: "2026-02-01T00:00:00.001Z" }),
        ],
        {
          start: "2026-01-01T00:00:00Z",
          end: "2026-02-01T00:00:00Z",
        },
      ),
    ).toBe(5);
  });

  it("throws on intermediate and final safe-integer overflow", () => {
    expect(() =>
      deriveBalance(account("checking"), [
        tx("income", Number.MAX_SAFE_INTEGER),
        tx("income", 1),
        tx("expense", 1),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      deriveBalance(account("checking"), [
        tx("expense", Number.MAX_SAFE_INTEGER),
        tx("expense", 1),
      ]),
    ).toThrow(RangeError);
  });

  it("rebuilds edits and deletes without mutating inputs", () => {
    const checking = account("checking");
    const opening = { ...tx("income", 100), purpose: "opening-balance" as const };
    const original = tx("expense", 25);
    const edited = { ...original, amount: minorAmount(40) };
    const list = Object.freeze([opening, original]);
    expect(deriveBalance(checking, list)).toBe(75);
    expect(deriveBalance(checking, [opening, edited])).toBe(60);
    expect(deriveBalance(checking, [opening])).toBe(100);
    expect(list).toEqual([opening, original]);
  });
});

describe("deriveBalances", () => {
  it("calculates a new map atomically and rejects duplicate IDs", () => {
    const accounts = [account("checking"), account("savings")];
    const result = deriveBalances(accounts, [
      tx("transfer", 20, { source: "checking", destination: "savings" }),
    ]);
    expect(result).toEqual(
      new Map([
        ["checking", -20],
        ["savings", 20],
      ]),
    );
    expect(() => deriveBalances([accounts[0], accounts[0]], [])).toThrow(
      RangeError,
    );
  });

  it("rejects currency mismatch for either known transfer participant", () => {
    expect(() =>
      deriveBalances(
        [account("checking", USD), account("savings", EUR)],
        [tx("transfer", 20, { source: "checking", destination: "savings" })],
      ),
    ).toThrow(RangeError);
  });

  it("ignores non-completed records without mutating inputs", () => {
    const accounts = Object.freeze([account("checking")]);
    const records = Object.freeze([
      tx("income", 20, { status: "planned" }),
      tx("expense", 5, { status: "cancelled" }),
    ]);
    expect(deriveBalances(accounts, records)).toEqual(
      new Map([["checking", 0]]),
    );
    expect(accounts[0].currency).toBe(USD);
    expect(records).toHaveLength(2);
  });

  it("rejects a calculated balance overflow", () => {
    expect(() =>
      deriveBalances([account("checking")], [
        tx("income", Number.MAX_SAFE_INTEGER),
        tx("income", 1),
      ]),
    ).toThrow(RangeError);
  });
});

describe("summarize", () => {
  it("excludes opening-balance records from financial summaries", () => {
    expect(summarize([{
      ...tx("income", 500_00),
      purpose: "opening-balance",
      categoryId: "system:opening-balance" as never,
    }])).toEqual({ income: 0, expenses: 0, netCashFlow: 0 });
  });
  it("counts completed income and expense, excludes transfers/statuses, and returns net", () => {
    expect(
      summarize([
        tx("income", 500),
        tx("expense", 125),
        tx("transfer", 200),
        tx("expense", 30, { status: "planned" }),
        tx("income", 30, { status: "cancelled" }),
      ]),
    ).toEqual({ income: 500, expenses: 125, netCashFlow: 375 });
  });

  it("does not let transfers establish currency but rejects mixed contributing currencies", () => {
    expect(
      summarize([
        tx("transfer", 1, { currency: EUR }),
        tx("income", 2, { currency: USD }),
      ]),
    ).toEqual({ income: 2, expenses: 0, netCashFlow: 2 });
    expect(() =>
      summarize([
        tx("income", 1, { currency: USD }),
        tx("expense", 1, { currency: EUR }),
      ]),
    ).toThrow(RangeError);
  });

  it("validates contributing timestamps and overflow", () => {
    expect(() =>
      summarize([tx("income", 1, { effectiveAt: "2026-01-01" })]),
    ).toThrow(RangeError);
    expect(() =>
      summarize([
        tx("income", Number.MAX_SAFE_INTEGER),
        tx("income", 1),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      summarize([
        tx("income", Number.MAX_SAFE_INTEGER),
        tx("expense", Number.MAX_SAFE_INTEGER),
      ]),
    ).not.toThrow();
  });

  it("includes exact range boundaries without mutating inputs", () => {
    const records = Object.freeze([
      tx("income", 2, { effectiveAt: "2026-01-01T00:00:00Z" }),
      tx("expense", 1, { effectiveAt: "2026-01-31T23:59:59.999Z" }),
    ]);
    expect(
      summarize(records, {
        start: "2026-01-01T00:00:00Z",
        end: "2026-01-31T23:59:59.999Z",
      }),
    ).toEqual({ income: 2, expenses: 1, netCashFlow: 1 });
    expect(records).toHaveLength(2);
  });

  it("rejects a negative unsafe summary fixture", () => {
    expect(() => summarize([tx("income", -1)])).toThrow(RangeError);
  });
});
