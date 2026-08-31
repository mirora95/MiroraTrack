import type { DashboardReadPort } from "./ports";
import {
  categoryFor,
  categoryLabel,
  TRANSACTION_CATEGORIES,
} from "./transactionCategories";
import { deriveBalances, parseDateRange, parseTimestamp, summarize } from "../finance/ledger";
import type { DateRange } from "../finance/ledger";
import { currencyCode, isSupportedCurrency } from "../finance/money";
import type {
  AccountId,
  AccountType,
  AppMetadata,
  Budget,
  BudgetId,
  CacheKey,
  CalculationCache,
  CategoryId,
  CurrencyCode,
  MinorAmount,
  Settings,
  Transaction,
  TransactionId,
} from "../finance/types";

export type DashboardRangePreset =
  | "this-month"
  | "this-and-next-month"
  | "last-month"
  | "last-3-months"
  | "year-to-date";

export interface DashboardCustomRange {
  readonly kind: "custom";
  readonly start: string;
  readonly end: string;
}

export interface DashboardQuery {
  readonly currency?: CurrencyCode;
  readonly range: DateRange | DashboardRangePreset | DashboardCustomRange;
  readonly recentLimit?: number;
}

interface NormalizedDashboardQuery {
  readonly currency: CurrencyCode;
  readonly range: DateRange;
  readonly recentLimit: number;
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
  readonly transactionIds: readonly TransactionId[];
}

export type DashboardBudgetStatus =
  | "on-track"
  | "warning"
  | "over-budget";

export interface DashboardBudgetUsage {
  readonly budgetId: BudgetId;
  readonly name: string;
  readonly categoryId: CategoryId;
  readonly categoryLabel: string;
  readonly month: string;
  readonly budgeted: MinorAmount;
  readonly spent: MinorAmount;
  readonly remaining: MinorAmount;
  readonly percentUsed: number;
  readonly status: DashboardBudgetStatus;
  readonly transactionIds: readonly TransactionId[];
}

export interface DashboardCategoryBreakdown {
  readonly categoryId: CategoryId;
  readonly label: string;
  readonly amount: MinorAmount;
  readonly percentOfExpenses: number;
  readonly transactionIds: readonly TransactionId[];
}

export interface DashboardPayload {
  readonly currency: CurrencyCode;
  readonly availableCurrencies: readonly CurrencyCode[];
  readonly range: DateRange;
  readonly netWorth: MinorAmount;
  readonly income: MinorAmount;
  readonly expenses: MinorAmount;
  readonly netCashFlow: MinorAmount;
  readonly savingsRatePercent: number | null;
  readonly accountBalances: readonly DashboardAccountBalance[];
  readonly cashFlow: readonly DashboardCashFlow[];
  readonly budgetUsage: readonly DashboardBudgetUsage[];
  readonly categoryBreakdown: readonly DashboardCategoryBreakdown[];
  readonly recentTransactions: readonly Transaction[];
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = BigInt(Number.MIN_SAFE_INTEGER);
const DAY = 86_400_000;
const MAX_ATTEMPTS = 3;
const ACCOUNT_TYPES = new Set([
  "cash", "checking", "savings", "credit", "investment", "other",
]);
const TRANSACTION_STATUSES = new Set(["completed", "planned", "cancelled"]);
const BUDGET_STATUSES = new Set(["on-track", "warning", "over-budget"]);

export class DashboardSnapshotUnstableError extends Error {
  readonly code = "DASHBOARD_SNAPSHOT_UNSTABLE";
  readonly retryable = true;

  constructor() {
    super("Dashboard data changed repeatedly; retry the request");
    this.name = "DashboardSnapshotUnstableError";
  }
}

export class DashboardService {
  private readonly reads: DashboardReadPort;
  private readonly clock: () => string;

  constructor(
    reads: DashboardReadPort,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.reads = reads;
    this.clock = clock;
  }

  async load(input: DashboardQuery): Promise<DashboardPayload> {
    validateStaticInput(input);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const [before, settings] = await Promise.all([
        this.reads.getMetadata(),
        this.reads.getSettings(),
      ]);
      assertMetadata(before);
      assertSettings(settings);
      const query = normalizeQuery(input, settings, this.clock());
      const key = cacheKey(query, before.calculationVersion);
      const cache = await this.reads.getCalculationCache(key);
      const afterCacheRead = await this.reads.getMetadata();
      if (!sameMetadata(before, afterCacheRead)) continue;
      if (
        cache?.key === key &&
        cache.calculationVersion === before.calculationVersion &&
        cache.sourceRevision === before.ledgerRevision &&
        isDashboardPayload(cache.value, query)
      ) {
        return cache.value;
      }

      const [accounts, transactions, budgets] = await Promise.all([
        this.reads.listAccounts(),
        this.reads.listTransactions(),
        this.reads.listBudgets(),
      ]);
      const afterSources = await this.reads.getMetadata();
      if (!sameMetadata(before, afterSources)) continue;

      const payload = buildPayload(query, settings, accounts, transactions, budgets);
      const rebuilt: CalculationCache = {
        key,
        calculationVersion: before.calculationVersion,
        sourceRevision: before.ledgerRevision,
        value: payload,
        updatedAt: this.clock(),
      };
      await this.reads.putCalculationCache(rebuilt);
      const afterWrite = await this.reads.getMetadata();
      if (!sameMetadata(before, afterWrite)) continue;
      return payload;
    }
    throw new DashboardSnapshotUnstableError();
  }
}

function validateStaticInput(query: DashboardQuery): void {
  validateRecentLimit(query.recentLimit);
  if (query.currency !== undefined) {
    currencyCode(query.currency);
    if (!isSupportedCurrency(query.currency)) {
      throw new RangeError("Currency is not supported");
    }
  }
  if (typeof query.range === "string") {
    if (![
      "this-month",
      "this-and-next-month",
      "last-month",
      "last-3-months",
      "year-to-date",
    ].includes(query.range)) {
      throw new RangeError("Invalid dashboard range preset");
    }
    return;
  }
  const range = "kind" in query.range
    ? {
        start: utcDateBoundary(query.range.start, false),
        end: utcDateBoundary(query.range.end, true),
      }
    : query.range;
  const parsed = parseDateRange(range);
  if (parsed.end - parsed.start >= 366 * DAY) {
    throw new RangeError("Dashboard ranges may include at most 366 UTC days");
  }
}

function buildPayload(
  query: NormalizedDashboardQuery,
  settings: Settings,
  allAccounts: Awaited<ReturnType<DashboardReadPort["listAccounts"]>>,
  allTransactions: Awaited<ReturnType<DashboardReadPort["listTransactions"]>>,
  allBudgets: Awaited<ReturnType<DashboardReadPort["listBudgets"]>>,
): DashboardPayload {
  assertUniqueBudgetScopes(allBudgets);
  const parsed = parseDateRange(query.range);
  const accounts = allAccounts.filter((item) => item.currency === query.currency);
  const currencyTransactions = allTransactions.filter(
    (item) => item.currency === query.currency,
  );
  const inRange = currencyTransactions.filter((item) => {
    const effectiveAt = parseTimestamp(item.effectiveAt);
    return effectiveAt >= parsed.start && effectiveAt <= parsed.end;
  });
  const balances = deriveBalances(accounts, currencyTransactions);
  const accountBalances = accounts.map((item) => ({
    accountId: item.id,
    name: item.name,
    type: item.type,
    status: item.status,
    balance: balances.get(item.id)!,
  }));
  const netWorth = checked(accountBalances.reduce(
    (sum, row) => sum + BigInt(row.balance),
    0n,
  ));
  const summary = summarize(inRange);
  const completedExpenses = flowTransactions(inRange)
    .filter((item): item is Extract<Transaction, { type: "expense" }> =>
      item.type === "expense");

  return {
    currency: query.currency,
    availableCurrencies: availableCurrencies(
      settings,
      allAccounts,
      allTransactions,
      allBudgets,
    ),
    range: query.range,
    netWorth,
    ...summary,
    savingsRatePercent: summary.income === 0
      ? null
      : percentage(summary.netCashFlow, summary.income),
    accountBalances,
    cashFlow: cashFlow(inRange),
    budgetUsage: budgetUsage(
      allBudgets,
      currencyTransactions,
      query,
      parsed,
    ),
    categoryBreakdown: categoryBreakdown(
      completedExpenses,
      summary.expenses,
    ),
    recentTransactions: [...inRange]
      .filter((item) => item.purpose !== "opening-balance")
      .sort(compareRecent)
      .slice(0, query.recentLimit),
  };
}

function normalizeQuery(
  query: DashboardQuery,
  settings: Settings,
  now: string,
): NormalizedDashboardQuery {
  const currency = query.currency ?? settings.baseCurrency;
  currencyCode(currency);
  if (!isSupportedCurrency(currency)) {
    throw new RangeError("Currency is not supported");
  }
  const recentLimit = query.recentLimit ?? 5;
  const range = normalizeRange(query.range, now);
  const parsed = parseDateRange(range);
  if (parsed.end - parsed.start >= 366 * DAY) {
    throw new RangeError("Dashboard ranges may include at most 366 UTC days");
  }
  return { currency, range, recentLimit };
}

function normalizeRange(
  input: DashboardQuery["range"],
  nowText: string,
): DateRange {
  if (typeof input === "string") {
    const now = new Date(parseTimestamp(nowText));
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    if (input === "this-month") return utcMonthRange(year, month);
    if (input === "this-and-next-month") {
      return {
        start: utcMonthRange(year, month).start,
        end: utcMonthRange(year, month + 1).end,
      };
    }
    if (input === "last-month") return utcMonthRange(year, month - 1);
    if (input === "last-3-months") {
      return {
        start: utcMonthRange(year, month - 2).start,
        end: utcMonthRange(year, month).end,
      };
    }
    if (input === "year-to-date") {
      return {
        start: `${String(year).padStart(4, "0")}-01-01T00:00:00.000Z`,
        end: utcMonthRange(year, month).end,
      };
    }
    throw new RangeError("Invalid dashboard range preset");
  }
  if ("kind" in input) {
    if (input.kind !== "custom") {
      throw new RangeError("Invalid dashboard custom range");
    }
    return {
      start: utcDateBoundary(input.start, false),
      end: utcDateBoundary(input.end, true),
    };
  }
  const parsed = parseDateRange(input);
  return {
    start: new Date(parsed.start).toISOString(),
    end: new Date(parsed.end).toISOString(),
  };
}

function utcDateBoundary(value: string, end: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Custom range dates must use YYYY-MM-DD");
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(time).toISOString().slice(0, 10) !== value) {
    throw new RangeError("Invalid custom range date");
  }
  return `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
}

function utcMonthRange(year: number, month: number): DateRange {
  const start = new Date(Date.UTC(year, month, 1));
  const next = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  return {
    start: `${start.toISOString().slice(0, 10)}T00:00:00.000Z`,
    end: new Date(next - 1).toISOString(),
  };
}

function validateRecentLimit(value: number | undefined): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || value < 1 || value > 50)
  ) {
    throw new RangeError("recentLimit must be an integer from 1 to 50");
  }
}

function cacheKey(
  query: NormalizedDashboardQuery,
  calculationVersion: number,
): CacheKey {
  return `dashboard:v${calculationVersion}:${query.currency}:${query.range.start}:${query.range.end}:${query.recentLimit}` as CacheKey;
}

function assertMetadata(
  metadata: AppMetadata | undefined,
): asserts metadata is AppMetadata {
  if (
    !metadata ||
    !Number.isSafeInteger(metadata.calculationVersion) ||
    metadata.calculationVersion < 1 ||
    !Number.isSafeInteger(metadata.ledgerRevision) ||
    metadata.ledgerRevision < 0
  ) {
    throw new Error("Application metadata is missing or invalid");
  }
}

function assertSettings(
  settings: Settings | undefined,
): asserts settings is Settings {
  if (!settings) throw new Error("Application settings are missing");
}

function sameMetadata(
  left: AppMetadata,
  right: AppMetadata | undefined,
): boolean {
  return right !== undefined &&
    left.calculationVersion === right.calculationVersion &&
    left.ledgerRevision === right.ledgerRevision;
}

function checked(value: bigint): MinorAmount {
  if (value < MIN || value > MAX) {
    throw new RangeError("Calculated amount exceeds the safe integer range");
  }
  return Number(value) as MinorAmount;
}

function percentage(numerator: MinorAmount, denominator: MinorAmount): number {
  if (denominator === 0) return 0;
  const value =
    Number(BigInt(numerator) * 10_000n / BigInt(denominator)) / 100;
  if (!Number.isFinite(value)) {
    throw new RangeError("Calculated percentage is not finite");
  }
  return value;
}

function flowTransactions(
  transactions: readonly Transaction[],
): readonly Exclude<Transaction, { type: "transfer" }>[] {
  return transactions.filter(
    (item): item is Exclude<Transaction, { type: "transfer" }> =>
      item.status === "completed" &&
      item.purpose === "standard" &&
      item.type !== "transfer",
  );
}

function cashFlow(
  transactions: readonly Transaction[],
): DashboardCashFlow[] {
  const days = new Map<string, {
    income: bigint;
    expenses: bigint;
    transactions: Transaction[];
  }>();
  for (const item of flowTransactions(transactions)) {
    const date = new Date(parseTimestamp(item.effectiveAt))
      .toISOString().slice(0, 10);
    const row = days.get(date) ?? {
      income: 0n,
      expenses: 0n,
      transactions: [],
    };
    if (item.type === "income") row.income += BigInt(item.amount);
    else row.expenses += BigInt(item.amount);
    row.transactions.push(item);
    days.set(date, row);
  }
  return [...days]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({
      date,
      income: checked(row.income),
      expenses: checked(row.expenses),
      netCashFlow: checked(row.income - row.expenses),
      transactionIds: row.transactions
        .sort(compareChronological)
        .map((item) => item.id),
    }));
}

function budgetUsage(
  budgets: readonly Budget[],
  transactions: readonly Transaction[],
  query: NormalizedDashboardQuery,
  parsed: ReturnType<typeof parseDateRange>,
): DashboardBudgetUsage[] {
  return budgets
    .filter((budget) =>
      budget.status === "active" &&
      budget.currency === query.currency &&
      budgetIntersects(budget.month, parsed))
    .sort((left, right) => {
      const leftLabel =
        categoryFor(left.categoryId, "expense")?.label ?? left.name;
      const rightLabel =
        categoryFor(right.categoryId, "expense")?.label ?? right.name;
      return left.month.localeCompare(right.month) ||
        leftLabel.localeCompare(rightLabel) ||
        (left.id as string).localeCompare(right.id as string);
    })
    .map((budget) => {
      const matching = matchingBudgetExpenses(budget, transactions, query.range);
      const spent = checked(matching.reduce(
        (sum, item) => sum + BigInt(item.amount),
        0n,
      ));
      const remaining = checked(BigInt(budget.amount) - BigInt(spent));
      const percentUsed = percentage(spent, budget.amount);
      const categoryLabel =
        categoryFor(budget.categoryId, "expense")?.label ?? budget.name;
      return {
        budgetId: budget.id,
        name: budget.name,
        categoryId: budget.categoryId,
        categoryLabel,
        month: budget.month,
        budgeted: budget.amount,
        spent,
        remaining,
        percentUsed,
        status: spent > budget.amount
          ? "over-budget"
          : percentUsed >= 80
            ? "warning"
            : "on-track",
        transactionIds: matching.map((item) => item.id),
      };
    });
}

function matchingBudgetExpenses(
  budget: Budget,
  transactions: readonly Transaction[],
  range: DateRange,
): Extract<Transaction, { type: "expense" }>[] {
  const parsed = parseDateRange(range);
  return transactions
    .filter((item): item is Extract<Transaction, { type: "expense" }> => {
      if (
        item.status !== "completed" ||
        item.purpose !== "standard" ||
        item.type !== "expense" ||
        item.currency !== budget.currency ||
        item.categoryId !== budget.categoryId
      ) return false;
      const effectiveAt = parseTimestamp(item.effectiveAt);
      const month = new Date(effectiveAt).toISOString().slice(0, 7);
      return month === budget.month &&
        effectiveAt >= parsed.start &&
        effectiveAt <= parsed.end;
    })
    .sort(compareChronological);
}

function categoryBreakdown(
  transactions: readonly Extract<Transaction, { type: "expense" }>[],
  totalExpenses: MinorAmount,
): DashboardCategoryBreakdown[] {
  const byCategory = new Map<CategoryId, {
    amount: bigint;
    transactions: Extract<Transaction, { type: "expense" }>[];
  }>();
  for (const item of transactions) {
    const row = byCategory.get(item.categoryId) ?? {
      amount: 0n,
      transactions: [],
    };
    row.amount += BigInt(item.amount);
    checked(row.amount);
    row.transactions.push(item);
    byCategory.set(item.categoryId, row);
  }
  return [...byCategory.entries()]
    .filter(([, row]) => row.amount !== 0n)
    .sort(([left], [right]) => compareCategoryIds(left, right))
    .map(([categoryId, row]) => {
      const amount = checked(row.amount);
      return {
        categoryId,
        label: categoryLabel(categoryId),
        amount,
        percentOfExpenses: percentage(amount, totalExpenses),
        transactionIds: row.transactions
          .sort(compareChronological)
          .map((item) => item.id),
      };
    });
}

function availableCurrencies(
  settings: Settings,
  accounts: Awaited<ReturnType<DashboardReadPort["listAccounts"]>>,
  transactions: Awaited<ReturnType<DashboardReadPort["listTransactions"]>>,
  budgets: Awaited<ReturnType<DashboardReadPort["listBudgets"]>>,
): CurrencyCode[] {
  const values = new Set<string>([
    settings.baseCurrency,
    ...accounts.map((item) => item.currency),
    ...transactions.map((item) => item.currency),
    ...budgets.map((item) => item.currency),
  ]);
  return [...values]
    .map((value) => currencyCode(value))
    .filter(isSupportedCurrency)
    .sort((left, right) => left.localeCompare(right));
}

function compareChronological(left: Transaction, right: Transaction): number {
  return parseTimestamp(left.effectiveAt) - parseTimestamp(right.effectiveAt) ||
    (left.id as string).localeCompare(right.id as string);
}

function compareRecent(left: Transaction, right: Transaction): number {
  return parseTimestamp(right.effectiveAt) - parseTimestamp(left.effectiveAt) ||
    parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt) ||
    (left.id as string).localeCompare(right.id as string);
}

function budgetIntersects(
  month: string,
  parsed: ReturnType<typeof parseDateRange>,
): boolean {
  const [yearText, monthText] = month.split("-");
  const start = Date.UTC(Number(yearText), Number(monthText) - 1, 1);
  const end = Date.UTC(Number(yearText), Number(monthText), 1) - 1;
  return start <= parsed.end && end >= parsed.start;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length &&
    keys.every((key) => actual.includes(key));
}

function safeAmount(value: unknown): value is MinorAmount {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
}

function validTransaction(value: unknown): value is Transaction {
  if (
    !isObject(value) ||
    typeof value.type !== "string" ||
    !["income", "expense", "transfer"].includes(value.type)
  ) {
    return false;
  }
  const common = [
    "id", "type", "status", "purpose", "amount", "currency",
    "effectiveAt", "createdAt", "updatedAt",
  ];
  const optional = typeof value.description === "string" ? ["description"] : [];
  const specific = value.type === "transfer"
    ? ["sourceAccountId", "destinationAccountId"]
    : value.type === "income"
      ? ["destinationAccountId", "categoryId"]
      : ["sourceAccountId", "categoryId"];
  if (!exactKeys(value, [...common, ...optional, ...specific])) return false;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.status !== "string" ||
    !TRANSACTION_STATUSES.has(value.status) ||
    typeof value.purpose !== "string" ||
    value.purpose !== "standard" ||
    !safeAmount(value.amount) ||
    value.amount <= 0 ||
    typeof value.currency !== "string" ||
    !isSupportedCurrency(value.currency) ||
    typeof value.effectiveAt !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    specific.some((key) =>
      typeof value[key] !== "string" || (value[key] as string).length === 0) ||
    (value.description !== undefined &&
      (typeof value.description !== "string" ||
        value.description.length > 240 ||
        value.description.includes("\u0000")))
  ) return false;
  try {
    if (
      !isCanonicalTimestamp(value.effectiveAt) ||
      !isCanonicalTimestamp(value.createdAt) ||
      !isCanonicalTimestamp(value.updatedAt)
    ) return false;
    if (value.type === "income") {
      return typeof value.categoryId === "string" &&
        validTransactionCategory(value.categoryId, "income");
    }
    if (value.type === "expense") {
      return typeof value.categoryId === "string" &&
        validTransactionCategory(value.categoryId, "expense");
    }
    return value.sourceAccountId !== value.destinationAccountId;
  } catch {
    return false;
  }
}

function validTransactionCategory(
  value: string,
  type: "income" | "expense",
): boolean {
  if (
    value.length === 0 ||
    value.length > 64 ||
    value.startsWith("system:")
  ) return false;
  if (categoryFor(value, type)) return true;
  const opposite = type === "income" ? "expense" : "income";
  return categoryFor(value, opposite) === undefined;
}

export function isDashboardPayload(
  value: unknown,
  query: NormalizedDashboardQuery,
): value is DashboardPayload {
  if (!isObject(value) || !exactKeys(value, [
    "currency", "availableCurrencies", "range", "netWorth", "income",
    "expenses", "netCashFlow", "savingsRatePercent", "accountBalances",
    "cashFlow", "budgetUsage", "categoryBreakdown", "recentTransactions",
  ])) return false;
  if (
    value.currency !== query.currency ||
    !isObject(value.range) ||
    !exactKeys(value.range, ["start", "end"]) ||
    value.range.start !== query.range.start ||
    value.range.end !== query.range.end ||
    !validAvailableCurrencies(value.availableCurrencies, query.currency) ||
    !safeAmount(value.netWorth) ||
    !safeAmount(value.income) ||
    !safeAmount(value.expenses) ||
    !safeAmount(value.netCashFlow) ||
    !(value.savingsRatePercent === null || finite(value.savingsRatePercent)) ||
    !Array.isArray(value.accountBalances) ||
    !Array.isArray(value.cashFlow) ||
    !Array.isArray(value.budgetUsage) ||
    !Array.isArray(value.categoryBreakdown) ||
    !Array.isArray(value.recentTransactions) ||
    value.recentTransactions.length > query.recentLimit
  ) return false;

  if (!value.accountBalances.every((row) =>
    isObject(row) &&
    exactKeys(row, ["accountId", "name", "type", "status", "balance"]) &&
    typeof row.accountId === "string" &&
    row.accountId.length > 0 &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.type === "string" &&
    ACCOUNT_TYPES.has(row.type) &&
    typeof row.status === "string" &&
    ["active", "archived"].includes(row.status) &&
    safeAmount(row.balance))) return false;

  if (!value.cashFlow.every((row) =>
    isObject(row) &&
    exactKeys(row, [
      "date", "income", "expenses", "netCashFlow", "transactionIds",
    ]) &&
    typeof row.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    safeAmount(row.income) &&
    row.income >= 0 &&
    safeAmount(row.expenses) &&
    row.expenses >= 0 &&
    safeAmount(row.netCashFlow) &&
    BigInt(row.income) - BigInt(row.expenses) === BigInt(row.netCashFlow) &&
    stringArray(row.transactionIds) &&
    row.transactionIds.length > 0 &&
    (row.income > 0 || row.expenses > 0))) return false;

  if (!value.budgetUsage.every((row) =>
    isObject(row) &&
    exactKeys(row, [
      "budgetId", "name", "categoryId", "categoryLabel", "month",
      "budgeted", "spent", "remaining", "percentUsed", "status",
      "transactionIds",
    ]) &&
    typeof row.budgetId === "string" &&
    row.budgetId.length > 0 &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.categoryId === "string" &&
    typeof row.categoryLabel === "string" &&
    categoryFor(row.categoryId, "expense")?.label === row.categoryLabel &&
    row.name === row.categoryLabel &&
    typeof row.month === "string" &&
    /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(row.month) &&
    safeAmount(row.budgeted) &&
    row.budgeted > 0 &&
    safeAmount(row.spent) &&
    row.spent >= 0 &&
    safeAmount(row.remaining) &&
    BigInt(row.budgeted) - BigInt(row.spent) === BigInt(row.remaining) &&
    finite(row.percentUsed) &&
    typeof row.status === "string" &&
    BUDGET_STATUSES.has(row.status) &&
    stringArray(row.transactionIds))) return false;

  if (!value.categoryBreakdown.every((row) =>
    isObject(row) &&
    exactKeys(row, [
      "categoryId", "label", "amount", "percentOfExpenses", "transactionIds",
    ]) &&
    typeof row.categoryId === "string" &&
    categoryLabel(row.categoryId) === row.label &&
    safeAmount(row.amount) &&
    row.amount > 0 &&
    finite(row.percentOfExpenses) &&
    row.percentOfExpenses >= 0 &&
    stringArray(row.transactionIds))) return false;

  if (!value.recentTransactions.every((item) =>
    validTransaction(item) &&
    item.currency === query.currency &&
    item.purpose !== "opening-balance")) return false;

  const payload = value as unknown as DashboardPayload;
  try {
    const parsed = parseDateRange(query.range);
    const accountIds = payload.accountBalances.map((row) => row.accountId);
    const budgetIds = payload.budgetUsage.map((row) => row.budgetId);
    const recentIds = payload.recentTransactions.map((row) => row.id);
    const categoryIds =
      payload.categoryBreakdown.map((row) => row.categoryId);
    const cashDates = payload.cashFlow.map((row) => row.date);
    const flowIncome = payload.cashFlow.reduce(
      (sum, row) => sum + BigInt(row.income),
      0n,
    );
    const flowExpenses = payload.cashFlow.reduce(
      (sum, row) => sum + BigInt(row.expenses),
      0n,
    );
    const categoryExpenses = payload.categoryBreakdown.reduce(
      (sum, row) => sum + BigInt(row.amount),
      0n,
    );
    const expectedSavings = payload.income === 0
      ? null
      : percentage(payload.netCashFlow, payload.income);
    if (
      new Set(accountIds).size !== accountIds.length ||
      new Set(budgetIds).size !== budgetIds.length ||
      new Set(recentIds).size !== recentIds.length ||
      new Set(categoryIds).size !== categoryIds.length ||
      new Set(cashDates).size !== cashDates.length ||
      !isCanonicalBudgetOrder(payload.budgetUsage) ||
      !hasDisjointDrilldownIds(payload.cashFlow) ||
      !hasDisjointDrilldownIds(payload.budgetUsage) ||
      !hasDisjointDrilldownIds(payload.categoryBreakdown) ||
      payload.accountBalances.reduce(
        (sum, row) => sum + BigInt(row.balance),
        0n,
      ) !== BigInt(payload.netWorth) ||
      payload.income < 0 ||
      payload.expenses < 0 ||
      BigInt(payload.income) - BigInt(payload.expenses) !==
        BigInt(payload.netCashFlow) ||
      flowIncome !== BigInt(payload.income) ||
      flowExpenses !== BigInt(payload.expenses) ||
      categoryExpenses !== BigInt(payload.expenses) ||
      payload.savingsRatePercent !== expectedSavings ||
      payload.cashFlow.some((row, index) => {
        const bounds = dayBounds(row.date);
        return !bounds ||
          bounds.start > parsed.end ||
          bounds.end < parsed.start ||
          (index > 0 && payload.cashFlow[index - 1]!.date >= row.date);
      }) ||
      payload.budgetUsage.some((row) =>
        !budgetIntersects(row.month, parsed) ||
        row.percentUsed !== percentage(row.spent, row.budgeted) ||
        row.status !== (
          row.spent > row.budgeted
            ? "over-budget"
            : row.percentUsed >= 80
              ? "warning"
              : "on-track"
        )) ||
      payload.categoryBreakdown.some((row, index) => {
        const previous = index === 0
          ? undefined
          : payload.categoryBreakdown[index - 1]!.categoryId;
        return (previous !== undefined &&
          compareCategoryIds(previous, row.categoryId) >= 0) ||
          row.percentOfExpenses !== percentage(row.amount, payload.expenses);
      })
    ) return false;
    return payload.recentTransactions.every((item, index) => {
      const timestamp = parseTimestamp(item.effectiveAt);
      const referencedAccounts = item.type === "income"
        ? [item.destinationAccountId]
        : item.type === "expense"
          ? [item.sourceAccountId]
          : [item.sourceAccountId, item.destinationAccountId];
      return referencedAccounts.every((id) => accountIds.includes(id)) &&
        timestamp >= parsed.start &&
        timestamp <= parsed.end &&
        (index === 0 ||
          compareRecent(payload.recentTransactions[index - 1]!, item) <= 0);
    });
  } catch {
    return false;
  }
}

function validAvailableCurrencies(
  value: unknown,
  selected: CurrencyCode,
): value is CurrencyCode[] {
  if (
    !Array.isArray(value) ||
    !value.includes(selected) ||
    new Set(value).size !== value.length ||
    value.some((item) =>
      typeof item !== "string" || !isSupportedCurrency(item))
  ) return false;
  const currencies = value as string[];
  return currencies.every((item, index) =>
    index === 0 || currencies[index - 1]!.localeCompare(item) < 0);
}

function isCanonicalTimestamp(value: string): boolean {
  try {
    const parsed = parseTimestamp(value);
    return new Date(parsed).toISOString() === value;
  } catch {
    return false;
  }
}

function hasDisjointDrilldownIds(
  rows: readonly { readonly transactionIds: readonly TransactionId[] }[],
): boolean {
  const seen = new Set<TransactionId>();
  for (const row of rows) {
    for (const id of row.transactionIds) {
      if (seen.has(id)) return false;
      seen.add(id);
    }
  }
  return true;
}

function isCanonicalBudgetOrder(
  rows: readonly DashboardBudgetUsage[],
): boolean {
  return rows.every((row, index) => {
    if (index === 0) return true;
    const previous = rows[index - 1]!;
    const comparison = previous.month.localeCompare(row.month) ||
      previous.categoryLabel.localeCompare(row.categoryLabel) ||
      (previous.budgetId as string).localeCompare(row.budgetId as string);
    return comparison < 0;
  });
}

function compareCategoryIds(left: CategoryId, right: CategoryId): number {
  const expenseCatalog = TRANSACTION_CATEGORIES.filter(
    (item) => item.type === "expense",
  );
  const leftIndex = expenseCatalog.findIndex((item) => item.id === left);
  const rightIndex = expenseCatalog.findIndex((item) => item.id === right);
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return (left as string).localeCompare(right as string);
}

function dayBounds(
  value: string,
): { readonly start: number; readonly end: number } | undefined {
  try {
    const start = Date.parse(`${value}T00:00:00.000Z`);
    if (new Date(start).toISOString().slice(0, 10) !== value) return undefined;
    return { start, end: start + DAY - 1 };
  } catch {
    return undefined;
  }
}

function assertUniqueBudgetScopes(budgets: readonly Budget[]): void {
  const ids = new Set<BudgetId>();
  const activeScopes = new Set<string>();
  for (const budget of budgets) {
    if (ids.has(budget.id)) throw new Error("Duplicate budget ID");
    ids.add(budget.id);
    if (budget.status !== "active") continue;
    const scope =
      `${budget.month}\u0000${budget.categoryId}\u0000${budget.currency}`;
    if (activeScopes.has(scope)) {
      throw new Error("Duplicate active budget scope");
    }
    activeScopes.add(scope);
  }
}
