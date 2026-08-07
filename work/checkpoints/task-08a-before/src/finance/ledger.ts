import { minorAmount } from "./types";
import type {
  Account,
  AccountId,
  CurrencyCode,
  MinorAmount,
  Transaction,
} from "./types";

export interface DateRange {
  readonly start: string;
  readonly end: string;
}

const APPLICATION_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = BigInt(Number.MIN_SAFE_INTEGER);

export function parseTimestamp(value: string): number {
  const match = APPLICATION_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    throw new RangeError(
      "Timestamp must use the supported ISO timestamp format with an explicit offset",
    );
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth =
    month >= 1 && month <= 12
      ? new Date(Date.UTC(year, month, 0)).getUTCDate()
      : 0;
  if (
    year < 1 ||
    day < 1 ||
    day > daysInMonth ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    (offsetHourText !== undefined && Number(offsetHourText) > 23) ||
    (offsetMinuteText !== undefined && Number(offsetMinuteText) > 59)
  ) {
    throw new RangeError("Invalid timestamp");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError("Invalid timestamp");
  }
  return parsed;
}

export function parseDateRange(range: DateRange): {
  readonly start: number;
  readonly end: number;
} {
  const start = parseTimestamp(range.start);
  const end = parseTimestamp(range.end);
  if (start > end) {
    throw new RangeError("Date range start must not follow its end");
  }
  return { start, end };
}

function assertAmount(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Transaction amount must be a nonnegative safe integer");
  }
  return BigInt(value);
}

function checked(value: bigint): bigint {
  if (value < MIN || value > MAX) {
    throw new RangeError("Calculated amount exceeds the safe integer range");
  }
  return value;
}

function included(
  transaction: Transaction,
  parsedRange?: { readonly start: number; readonly end: number },
): boolean {
  const effectiveAt = parseTimestamp(transaction.effectiveAt);
  return (
    parsedRange === undefined ||
    (effectiveAt >= parsedRange.start && effectiveAt <= parsedRange.end)
  );
}

function effectFor(
  accountId: AccountId,
  currency: CurrencyCode,
  transaction: Transaction,
  parsedRange?: { readonly start: number; readonly end: number },
): bigint | undefined {
  if (transaction.status !== "completed") return undefined;

  let sign: bigint | undefined;
  if (
    transaction.type === "income" &&
    transaction.destinationAccountId === accountId
  ) {
    sign = 1n;
  } else if (
    transaction.type === "expense" &&
    transaction.sourceAccountId === accountId
  ) {
    sign = -1n;
  } else if (transaction.type === "transfer") {
    if (
      transaction.sourceAccountId === accountId &&
      transaction.destinationAccountId === accountId
    ) {
      throw new RangeError("A transfer cannot use the same account twice");
    }
    if (transaction.sourceAccountId === accountId) sign = -1n;
    else if (transaction.destinationAccountId === accountId) sign = 1n;
  }
  if (sign === undefined) return undefined;
  if (transaction.currency !== currency) {
    throw new RangeError("Transaction currency does not match account currency");
  }
  const amount = assertAmount(transaction.amount);
  return included(transaction, parsedRange) ? sign * amount : undefined;
}

export function deriveBalance(
  account: Account,
  transactions: readonly Transaction[],
  range?: DateRange,
): MinorAmount {
  const parsedRange = range === undefined ? undefined : parseDateRange(range);
  let balance = checked(BigInt(account.openingBalance));
  for (const transaction of transactions) {
    const effect = effectFor(
      account.id,
      account.currency,
      transaction,
      parsedRange,
    );
    if (effect !== undefined) balance = checked(balance + effect);
  }
  return minorAmount(Number(balance));
}

export function deriveBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  range?: DateRange,
): Map<AccountId, MinorAmount> {
  const parsedRange = range === undefined ? undefined : parseDateRange(range);
  const balances = new Map<AccountId, bigint>();
  const currencies = new Map<AccountId, CurrencyCode>();
  for (const account of accounts) {
    if (balances.has(account.id)) throw new RangeError("Duplicate account ID");
    balances.set(account.id, checked(BigInt(account.openingBalance)));
    currencies.set(account.id, account.currency);
  }

  for (const transaction of transactions) {
    if (transaction.status !== "completed") continue;
    const referenced =
      transaction.type === "income"
        ? [transaction.destinationAccountId]
        : transaction.type === "expense"
          ? [transaction.sourceAccountId]
          : [transaction.sourceAccountId, transaction.destinationAccountId];
    const known = referenced.filter((id) => balances.has(id));
    if (known.length === 0) continue;
    if (
      transaction.type === "transfer" &&
      transaction.sourceAccountId === transaction.destinationAccountId
    ) {
      throw new RangeError("A transfer cannot use the same account twice");
    }
    for (const id of known) {
      if (currencies.get(id) !== transaction.currency) {
        throw new RangeError("Transaction currency does not match account currency");
      }
    }
    const amount = assertAmount(transaction.amount);
    if (!included(transaction, parsedRange)) continue;
    if (transaction.type === "income") {
      const id = transaction.destinationAccountId;
      if (balances.has(id)) balances.set(id, checked(balances.get(id)! + amount));
    } else if (transaction.type === "expense") {
      const id = transaction.sourceAccountId;
      if (balances.has(id)) balances.set(id, checked(balances.get(id)! - amount));
    } else {
      const source = transaction.sourceAccountId;
      const destination = transaction.destinationAccountId;
      if (balances.has(source)) {
        balances.set(source, checked(balances.get(source)! - amount));
      }
      if (balances.has(destination)) {
        balances.set(destination, checked(balances.get(destination)! + amount));
      }
    }
  }

  return new Map(
    [...balances].map(([id, value]) => [id, minorAmount(Number(value))]),
  );
}

export interface TransactionSummary {
  readonly income: MinorAmount;
  readonly expenses: MinorAmount;
  readonly netCashFlow: MinorAmount;
}

export function summarize(
  transactions: readonly Transaction[],
  range?: DateRange,
): TransactionSummary {
  const parsedRange = range === undefined ? undefined : parseDateRange(range);
  let income = 0n;
  let expenses = 0n;
  let currency: CurrencyCode | undefined;
  for (const transaction of transactions) {
    if (
      transaction.status !== "completed" ||
      transaction.type === "transfer"
    ) {
      continue;
    }
    const amount = assertAmount(transaction.amount);
    if (!included(transaction, parsedRange)) continue;
    if (currency !== undefined && currency !== transaction.currency) {
      throw new RangeError("Summary cannot mix contributing currencies");
    }
    currency = transaction.currency;
    if (transaction.type === "income") income = checked(income + amount);
    else expenses = checked(expenses + amount);
  }
  const netCashFlow = checked(income - expenses);
  return {
    income: minorAmount(Number(income)),
    expenses: minorAmount(Number(expenses)),
    netCashFlow: minorAmount(Number(netCashFlow)),
  };
}
