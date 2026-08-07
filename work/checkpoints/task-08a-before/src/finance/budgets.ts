import { parseDateRange, parseTimestamp } from "./ledger";
import type { DateRange } from "./ledger";
import { minorAmount } from "./types";
import type { Budget, MinorAmount, Transaction } from "./types";

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const BUDGET_MONTH_PATTERN = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/;

export function calculateBudgetUsage(
  budget: Budget,
  transactions: readonly Transaction[],
  range: DateRange,
): MinorAmount {
  if (!Number.isSafeInteger(budget.amount) || budget.amount <= 0) {
    throw new RangeError("Budget amount must be a positive safe integer");
  }
  if (!BUDGET_MONTH_PATTERN.test(budget.month)) {
    throw new RangeError("Budget month must use YYYY-MM with a valid nonzero year");
  }
  const parsedRange = parseDateRange(range);
  let usage = 0n;
  for (const transaction of transactions) {
    if (
      transaction.status !== "completed" ||
      transaction.type !== "expense" ||
      transaction.categoryId !== budget.categoryId ||
      transaction.currency !== budget.currency
    ) {
      continue;
    }
    if (!Number.isSafeInteger(transaction.amount) || transaction.amount < 0) {
      throw new RangeError("Transaction amount must be a nonnegative safe integer");
    }
    const effectiveAt = parseTimestamp(transaction.effectiveAt);
    const date = new Date(effectiveAt);
    const month = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    if (
      effectiveAt < parsedRange.start ||
      effectiveAt > parsedRange.end ||
      month !== budget.month
    ) {
      continue;
    }
    usage += BigInt(transaction.amount);
    if (usage > MAX) {
      throw new RangeError("Budget usage exceeds the safe integer range");
    }
  }
  return minorAmount(Number(usage));
}
