import type { DashboardReadPort } from "./ports";
import { calculateBudgetUsage } from "../finance/budgets";
import { deriveBalances, parseDateRange, parseTimestamp, summarize } from "../finance/ledger";
import type { DateRange } from "../finance/ledger";
import { currencyCode } from "../finance/money";
import type {
  AccountId,
  AccountType,
  BudgetId,
  CacheKey,
  CalculationCache,
  CurrencyCode,
  MinorAmount,
  Transaction,
} from "../finance/types";

export interface DashboardQuery {
  readonly currency: CurrencyCode;
  readonly range: DateRange;
  readonly recentLimit?: number;
}
export interface DashboardAccountBalance {
  readonly accountId: AccountId;
  readonly name: string;
  readonly type: AccountType;
  readonly status: "active" | "archived";
  readonly balance: MinorAmount;
}
export interface DashboardCashFlow {
  readonly date: string;
  readonly income: MinorAmount;
  readonly expenses: MinorAmount;
  readonly netCashFlow: MinorAmount;
}

export interface DashboardBudgetUsage {
  readonly budgetId: BudgetId;
  readonly name: string;
  readonly month: string;
  readonly budgeted: MinorAmount;
  readonly spent: MinorAmount;
  readonly remaining: MinorAmount;
  readonly percentUsed: number;
}

export interface DashboardPayload {
  readonly currency: CurrencyCode;
  readonly range: DateRange;
  readonly netWorth: MinorAmount;
  readonly income: MinorAmount;
  readonly expenses: MinorAmount;
  readonly netCashFlow: MinorAmount;
  readonly savingsRatePercent: number | null;
  readonly accountBalances: readonly DashboardAccountBalance[];
  readonly cashFlow: readonly DashboardCashFlow[];
  readonly budgetUsage: readonly DashboardBudgetUsage[];
  readonly recentTransactions: readonly Transaction[];
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = BigInt(Number.MIN_SAFE_INTEGER);
const ACCOUNT_TYPES = new Set(["cash", "checking", "savings", "credit", "investment", "other"]);
const STATUSES = new Set(["completed", "planned", "cancelled"]);

function checked(value: bigint): MinorAmount {
  if (value < MIN || value > MAX) {
    throw new RangeError("Calculated amount exceeds the safe integer range");
  }
  return Number(value) as MinorAmount;
}

function parseQuery(query: DashboardQuery): Required<DashboardQuery> {
  currencyCode(query.currency);
  parseDateRange(query.range);
  const recentLimit = query.recentLimit ?? 5;
  if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
    throw new RangeError("recentLimit must be an integer from 1 to 50");
  }
  return { ...query, recentLimit };
}

function cacheKey(query: Required<DashboardQuery>): CacheKey {
  return `dashboard:${query.currency}:${query.range.start}:${query.range.end}:${query.recentLimit}` as CacheKey;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function safeAmount(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function finite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function utcDayBounds(value: string): { start: number; end: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(start).toISOString().slice(0, 10) !== value) return undefined;
  return { start, end: start + 86_400_000 - 1 };
}

function validTransaction(value: unknown): value is Transaction {
  if (!isObject(value) || !["income", "expense", "transfer"].includes(String(value.type))) return false;
  const common = ["id", "type", "status", "amount", "currency", "effectiveAt", "createdAt", "updatedAt"];
  const optional = typeof value.description === "string" ? ["description"] : [];
  const specific = value.type === "transfer"
    ? ["sourceAccountId", "destinationAccountId"]
    : value.type === "income"
      ? ["destinationAccountId", "categoryId"]
      : ["sourceAccountId", "categoryId"];
  if (!exactKeys(value, [...common, ...optional, ...specific])) return false;
  if (!(typeof value.id === "string" && STATUSES.has(String(value.status)) &&
    safeAmount(value.amount) && (value.amount as number) >= 0 &&
    typeof value.currency === "string" && typeof value.effectiveAt === "string" &&
    typeof value.createdAt === "string" && typeof value.updatedAt === "string" &&
    specific.every((key) => typeof value[key] === "string"))) return false;
  try {
    currencyCode(value.currency);
    parseTimestamp(value.effectiveAt);
    parseTimestamp(value.createdAt);
    parseTimestamp(value.updatedAt);
    return true;
  } catch {
    return false;
  }
}

export function isDashboardPayload(
  value: unknown,
  query: Required<DashboardQuery>,
): value is DashboardPayload {
  if (!isObject(value) || !exactKeys(value, [
    "currency", "range", "netWorth", "income", "expenses", "netCashFlow",
    "savingsRatePercent", "accountBalances", "cashFlow", "budgetUsage",
    "recentTransactions",
  ])) return false;
  if (value.currency !== query.currency || !isObject(value.range) ||
    !exactKeys(value.range, ["start", "end"]) ||
    value.range.start !== query.range.start || value.range.end !== query.range.end ||
    !safeAmount(value.netWorth) || !safeAmount(value.income) ||
    !safeAmount(value.expenses) || !safeAmount(value.netCashFlow) ||
    !(value.savingsRatePercent === null || finite(value.savingsRatePercent)) ||
    !Array.isArray(value.accountBalances) || !Array.isArray(value.cashFlow) ||
    !Array.isArray(value.budgetUsage) || !Array.isArray(value.recentTransactions) ||
    value.recentTransactions.length > query.recentLimit) return false;
  if (!(value.accountBalances.every((row) => isObject(row) &&
      exactKeys(row, ["accountId", "name", "type", "status", "balance"]) &&
      typeof row.accountId === "string" && typeof row.name === "string" &&
      ACCOUNT_TYPES.has(String(row.type)) && ["active", "archived"].includes(String(row.status)) &&
      safeAmount(row.balance)) &&
    value.cashFlow.every((row) => isObject(row) &&
      exactKeys(row, ["date", "income", "expenses", "netCashFlow"]) &&
      typeof row.date === "string" && safeAmount(row.income) &&
      safeAmount(row.expenses) && safeAmount(row.netCashFlow)) &&
    value.budgetUsage.every((row) => isObject(row) &&
      exactKeys(row, ["budgetId", "name", "month", "budgeted", "spent", "remaining", "percentUsed"]) &&
      typeof row.budgetId === "string" && typeof row.name === "string" &&
      typeof row.month === "string" && safeAmount(row.budgeted) &&
      safeAmount(row.spent) && safeAmount(row.remaining) && finite(row.percentUsed)) &&
      value.recentTransactions.every((item) =>
      validTransaction(item) && item.currency === query.currency))) return false;
  const payload = value as unknown as DashboardPayload;
  try {
    const parsed = parseDateRange(query.range);
    const accountIds = payload.accountBalances.map((row) => row.accountId);
    const cashDates = payload.cashFlow.map((row) => row.date);
    const budgetIds = payload.budgetUsage.map((row) => row.budgetId);
    const recentIds = payload.recentTransactions.map((row) => row.id);
    const cashIncome = payload.cashFlow.reduce((sum, row) => sum + BigInt(row.income), 0n);
    const cashExpenses = payload.cashFlow.reduce((sum, row) => sum + BigInt(row.expenses), 0n);
    const expectedSavingsRate = payload.income === 0 ? null :
      Number(BigInt(payload.netCashFlow) * 10_000n / BigInt(payload.income)) / 100;
    const invalidBudgetRow = payload.budgetUsage.some((row) =>
      row.budgetId.length === 0 || row.name.length === 0 ||
      !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(row.month) ||
      !budgetIntersects(row.month, parsed) ||
      row.budgeted <= 0 || row.spent < 0 ||
      BigInt(row.budgeted) - BigInt(row.spent) !== BigInt(row.remaining) ||
      row.percentUsed !== Number(BigInt(row.spent) * 10_000n / BigInt(row.budgeted)) / 100);
    if (new Set(accountIds).size !== accountIds.length ||
      new Set(cashDates).size !== cashDates.length ||
      new Set(budgetIds).size !== budgetIds.length ||
      new Set(recentIds).size !== recentIds.length ||
      payload.accountBalances.some((row) => row.accountId.length === 0 || row.name.length === 0) ||
      payload.cashFlow.some((row, index) => {
        const day = utcDayBounds(row.date);
        return day === undefined || day.start > parsed.end || day.end < parsed.start ||
          (index > 0 && payload.cashFlow[index - 1]!.date >= row.date) ||
          row.income < 0 || row.expenses < 0 ||
          BigInt(row.income) - BigInt(row.expenses) !== BigInt(row.netCashFlow);
      }) ||
      invalidBudgetRow ||
      payload.accountBalances.reduce((sum, row) => sum + BigInt(row.balance), 0n) !== BigInt(payload.netWorth) ||
      payload.income < 0 || payload.expenses < 0 ||
      BigInt(payload.income) - BigInt(payload.expenses) !== BigInt(payload.netCashFlow) ||
      cashIncome !== BigInt(payload.income) || cashExpenses !== BigInt(payload.expenses) ||
      payload.savingsRatePercent !== expectedSavingsRate) return false;
    return payload.recentTransactions.every((item, index) => {
        const timestamp = parseTimestamp(item.effectiveAt);
        return item.id.length > 0 && timestamp >= parsed.start && timestamp <= parsed.end &&
          (index === 0 || compareRecent(payload.recentTransactions[index - 1]!, item) <= 0);
      });
  } catch {
    return false;
  }
}

function cashFlow(transactions: readonly Transaction[]): DashboardCashFlow[] {
  const days = new Map<string, { income: bigint; expenses: bigint }>();
  for (const item of transactions) {
    if (item.status !== "completed" || item.type === "transfer") continue;
    const date = new Date(parseTimestamp(item.effectiveAt)).toISOString().slice(0, 10);
    const row = days.get(date) ?? { income: 0n, expenses: 0n };
    if (item.type === "income") row.income += BigInt(item.amount);
    else row.expenses += BigInt(item.amount);
    days.set(date, row);
  }
  return [...days].sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({
      date,
      income: checked(row.income),
      expenses: checked(row.expenses),
      netCashFlow: checked(row.income - row.expenses),
    }));
}

function compareRecent(left: Transaction, right: Transaction): number {
  return parseTimestamp(right.effectiveAt) - parseTimestamp(left.effectiveAt) ||
    parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt) ||
    left.id.localeCompare(right.id);
}

function budgetIntersects(month: string, parsed: ReturnType<typeof parseDateRange>): boolean {
  const [yearText, monthText] = month.split("-");
  const start = Date.UTC(Number(yearText), Number(monthText) - 1, 1);
  const end = Date.UTC(Number(yearText), Number(monthText), 1) - 1;
  return start <= parsed.end && end >= parsed.start;
}

export class DashboardService {
  private readonly reads: DashboardReadPort;
  private readonly clock: () => string;

  constructor(reads: DashboardReadPort, clock: () => string = () => new Date().toISOString()) {
    this.reads = reads;
    this.clock = clock;
  }

  async load(input: DashboardQuery): Promise<DashboardPayload> {
    const query = parseQuery(input);
    const key = cacheKey(query);
    const [metadata, cache] = await Promise.all([
      this.reads.getMetadata(),
      this.reads.getCalculationCache(key),
    ]);
    if (metadata === undefined) throw new Error("Application metadata is missing");
    if (cache?.calculationVersion === metadata.calculationVersion &&
      cache.sourceRevision === metadata.ledgerRevision &&
      cache.key === key &&
      isDashboardPayload(cache.value, query)) return cache.value;

    const [allAccounts, allTransactions, allBudgets] = await Promise.all([
      this.reads.listAccounts(),
      this.reads.listTransactions(),
      this.reads.listBudgets(),
    ]);
    const parsed = parseDateRange(query.range);
    const accounts = allAccounts.filter((item) => item.currency === query.currency);
    const currencyTransactions = allTransactions.filter((item) => item.currency === query.currency);
    const inRange = currencyTransactions.filter((item) => {
      const effectiveAt = parseTimestamp(item.effectiveAt);
      return effectiveAt >= parsed.start && effectiveAt <= parsed.end;
    });
    const balances = deriveBalances(accounts, currencyTransactions);
    const accountBalances = accounts.map((item) => ({
      accountId: item.id, name: item.name, type: item.type, status: item.status,
      balance: balances.get(item.id)!,
    }));
    const netWorth = checked(accountBalances.reduce((sum, row) => sum + BigInt(row.balance), 0n));
    const summary = summarize(inRange);
    const budgetUsage = allBudgets
      .filter((budget) => budget.currency === query.currency &&
        budgetIntersects(budget.month, parsed))
      .map((budget) => {
        const spent = calculateBudgetUsage(budget, currencyTransactions, query.range);
        const remaining = checked(BigInt(budget.amount) - BigInt(spent));
        const percentUsed = Number(BigInt(spent) * 10_000n / BigInt(budget.amount)) / 100;
        if (!Number.isFinite(percentUsed)) throw new RangeError("Budget percentage is not finite");
        return { budgetId: budget.id, name: budget.name, month: budget.month,
          budgeted: budget.amount, spent, remaining, percentUsed };
      });
    const payload: DashboardPayload = {
      currency: query.currency,
      range: query.range,
      netWorth,
      ...summary,
      savingsRatePercent: summary.income === 0 ? null :
        Number(BigInt(summary.netCashFlow) * 10_000n / BigInt(summary.income)) / 100,
      accountBalances,
      cashFlow: cashFlow(inRange),
      budgetUsage,
      recentTransactions: [...inRange].sort(compareRecent).slice(0, query.recentLimit),
    };
    const rebuilt: CalculationCache = {
      key, calculationVersion: metadata.calculationVersion,
      sourceRevision: metadata.ledgerRevision, value: payload, updatedAt: this.clock(),
    };
    await this.reads.putCalculationCache(rebuilt);
    return payload;
  }
}
