import type {
  BackupPort,
  BackupResult,
  TransactionReadPort,
} from "./ports";
import { categoryLabel } from "./transactionCategories";
import { ValidationError } from "./validation";
import { serializeTransactionsCsv } from "../export/csv";
import { minorAmount } from "../finance/types";
import type {
  Account,
  CurrencyCode,
  MinorAmount,
  Transaction,
} from "../finance/types";

export type TransactionSort =
  | "newest"
  | "oldest"
  | "amount-high"
  | "amount-low";

export interface TransactionFilters {
  readonly search?: string;
  readonly type?: Transaction["type"];
  readonly status?: Transaction["status"];
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly currency?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly sort?: TransactionSort;
  readonly page: number;
  readonly pageSize: 25 | 50 | 100;
}

export interface TransactionListItem {
  readonly transaction: Transaction;
  readonly sourceAccountLabel?: string;
  readonly destinationAccountLabel?: string;
  readonly categoryLabel?: string;
}

export interface CurrencySummary {
  readonly currency: CurrencyCode;
  readonly income: MinorAmount;
  readonly expenses: MinorAmount;
  readonly net: MinorAmount;
}

export interface TransactionFacets {
  readonly types: Record<Transaction["type"], number>;
  readonly statuses: Record<Transaction["status"], number>;
  readonly currencies: readonly {
    readonly value: CurrencyCode;
    readonly count: number;
  }[];
  readonly accounts: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
  readonly categories: readonly {
    readonly value: string;
    readonly label: string;
    readonly count: number;
  }[];
}

export interface TransactionPage {
  readonly items: readonly TransactionListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly summaries: readonly CurrencySummary[];
  readonly facets: TransactionFacets;
}

export class TransactionService {
  private readonly reads: TransactionReadPort;
  private readonly backups: Pick<BackupPort, "exportCsv">;

  constructor(
    reads: TransactionReadPort,
    backups: Pick<BackupPort, "exportCsv">,
  ) {
    this.reads = reads;
    this.backups = backups;
  }

  async list(filters: TransactionFilters): Promise<TransactionPage> {
    const validated = validateFilters(filters);
    const { rows, accounts } = await this.filtered(validated);
    const offset = (validated.page - 1) * validated.pageSize;
    return {
      items: rows
        .slice(offset, offset + validated.pageSize)
        .map((transaction) => project(transaction, accounts)),
      total: rows.length,
      page: validated.page,
      pageCount: Math.ceil(rows.length / validated.pageSize),
      summaries: summarize(rows),
      facets: facets(rows, accounts),
    };
  }

  async exportFiltered(
    filters: TransactionFilters,
  ): Promise<BackupResult | null> {
    const validated = validateFilters(filters);
    const { rows } = await this.filtered(validated);
    return this.backups.exportCsv(serializeTransactionsCsv(rows));
  }

  private async filtered(filters: ValidatedFilters): Promise<{
    readonly rows: Transaction[];
    readonly accounts: ReadonlyMap<string, Account>;
  }> {
    const [records, accountRecords] = await Promise.all([
      this.reads.listTransactions(),
      this.reads.listAccounts(),
    ]);
    const accounts = new Map(
      accountRecords.map((account) => [account.id as string, account]),
    );
    const rows = records
      .filter((record) => matches(record, filters, accounts))
      .slice()
      .sort(sorter(filters.sort));
    return { rows, accounts };
  }
}

type ValidatedFilters = TransactionFilters & {
  readonly search: string;
  readonly sort: TransactionSort;
  readonly fromEpoch?: number;
  readonly toExclusiveEpoch?: number;
};

function validateFilters(filters: TransactionFilters): ValidatedFilters {
  if (!Number.isSafeInteger(filters.page) || filters.page < 1) {
    throw new ValidationError("INVALID_FILTER", "page");
  }
  if (![25, 50, 100].includes(filters.pageSize)) {
    throw new ValidationError("INVALID_FILTER", "pageSize");
  }
  if (
    filters.type !== undefined &&
    !["income", "expense", "transfer"].includes(filters.type)
  ) {
    throw new ValidationError("INVALID_FILTER", "type");
  }
  if (
    filters.status !== undefined &&
    !["completed", "planned", "cancelled"].includes(filters.status)
  ) {
    throw new ValidationError("INVALID_FILTER", "status");
  }
  if (
    filters.sort !== undefined &&
    !["newest", "oldest", "amount-high", "amount-low"].includes(filters.sort)
  ) {
    throw new ValidationError("INVALID_FILTER", "sort");
  }
  if (
    filters.currency !== undefined &&
    !/^[A-Z]{3}$/.test(filters.currency)
  ) {
    throw new ValidationError("INVALID_FILTER", "currency");
  }
  if (
    filters.accountId !== undefined &&
    (filters.accountId.trim().length === 0 ||
      filters.accountId.includes("\u0000") ||
      filters.accountId.length > 128)
  ) {
    throw new ValidationError("INVALID_FILTER", "accountId");
  }
  if (
    filters.categoryId !== undefined &&
    (filters.categoryId.trim().length === 0 ||
      filters.categoryId.startsWith("system:") ||
      filters.categoryId.includes("\u0000") ||
      filters.categoryId.length > 64)
  ) {
    throw new ValidationError("INVALID_FILTER", "categoryId");
  }
  const search = (filters.search ?? "").trim().toLocaleLowerCase("en-US");
  if (search.includes("\u0000") || search.length > 100) {
    throw new ValidationError("INVALID_FILTER", "search");
  }
  const fromEpoch = filters.fromDate === undefined
    ? undefined
    : dateEpoch(filters.fromDate, "fromDate");
  const toEpoch = filters.toDate === undefined
    ? undefined
    : dateEpoch(filters.toDate, "toDate");
  if (fromEpoch !== undefined && toEpoch !== undefined && fromEpoch > toEpoch) {
    throw new ValidationError("INVALID_FILTER", "dateRange");
  }
  return {
    ...filters,
    search,
    sort: filters.sort ?? "newest",
    ...(fromEpoch === undefined ? {} : { fromEpoch }),
    ...(toEpoch === undefined ? {} : { toExclusiveEpoch: toEpoch + 86_400_000 }),
  };
}

function dateEpoch(value: string, field: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("INVALID_FILTER", field);
  }
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(epoch) ||
    new Date(epoch).toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError("INVALID_FILTER", field);
  }
  return epoch;
}

function matches(
  record: Transaction,
  filters: ValidatedFilters,
  accounts: ReadonlyMap<string, Account>,
): boolean {
  if (filters.type !== undefined && record.type !== filters.type) return false;
  if (filters.status !== undefined && record.status !== filters.status) return false;
  if (filters.currency !== undefined && record.currency !== filters.currency) return false;
  if (
    filters.categoryId !== undefined &&
    (!("categoryId" in record) || record.categoryId !== filters.categoryId)
  ) return false;
  if (
    filters.accountId !== undefined &&
    !accountIds(record).includes(filters.accountId)
  ) return false;
  const epoch = Date.parse(record.effectiveAt);
  if (filters.fromEpoch !== undefined && epoch < filters.fromEpoch) return false;
  if (
    filters.toExclusiveEpoch !== undefined &&
    epoch >= filters.toExclusiveEpoch
  ) return false;
  if (filters.search.length === 0) return true;
  const searchable = [
    record.description ?? "",
    record.purpose === "opening-balance"
      ? "Opening balance"
      : "categoryId" in record
        ? categoryLabel(record.categoryId)
        : "Transfer",
    ...accountIds(record).map((id) => accounts.get(id)?.name ?? ""),
  ].join("\n").toLocaleLowerCase("en-US");
  return searchable.includes(filters.search);
}

function accountIds(record: Transaction): string[] {
  return record.type === "income"
    ? [record.destinationAccountId]
    : record.type === "expense"
      ? [record.sourceAccountId]
      : [record.sourceAccountId, record.destinationAccountId];
}

function sorter(sort: TransactionSort) {
  return (left: Transaction, right: Transaction): number => {
    const amountOrder = left.amount - right.amount;
    const dateOrder = left.effectiveAt.localeCompare(right.effectiveAt);
    const primary = sort === "newest"
      ? -dateOrder
      : sort === "oldest"
        ? dateOrder
        : sort === "amount-high"
          ? -amountOrder
          : amountOrder;
    return primary || left.id.localeCompare(right.id);
  };
}

function project(
  transaction: Transaction,
  accounts: ReadonlyMap<string, Account>,
): TransactionListItem {
  const accountLabel = (id: string) =>
    accounts.get(id)?.name ?? "Unavailable account";
  const category = transaction.purpose === "opening-balance"
    ? "Opening balance"
    : "categoryId" in transaction
      ? categoryLabel(transaction.categoryId)
      : undefined;
  return {
    transaction,
    ...(transaction.type === "income"
      ? { destinationAccountLabel: accountLabel(transaction.destinationAccountId) }
      : transaction.type === "expense"
        ? { sourceAccountLabel: accountLabel(transaction.sourceAccountId) }
        : {
            sourceAccountLabel: accountLabel(transaction.sourceAccountId),
            destinationAccountLabel: accountLabel(transaction.destinationAccountId),
          }),
    ...(category === undefined ? {} : { categoryLabel: category }),
  };
}

function summarize(records: readonly Transaction[]): CurrencySummary[] {
  const totals = new Map<string, { income: bigint; expenses: bigint }>();
  for (const record of records) {
    if (
      record.status !== "completed" ||
      record.purpose !== "standard" ||
      record.type === "transfer"
    ) continue;
    const current = totals.get(record.currency) ?? { income: 0n, expenses: 0n };
    if (record.type === "income") current.income += BigInt(record.amount);
    else current.expenses += BigInt(record.amount);
    totals.set(record.currency, current);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, total]) => ({
      currency: currency as CurrencyCode,
      income: safeMinor(total.income),
      expenses: safeMinor(total.expenses),
      net: safeMinor(total.income - total.expenses),
    }));
}

function safeMinor(value: bigint): MinorAmount {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) throw new RangeError("Transaction summary exceeds the safe integer range");
  return minorAmount(Number(value));
}

function facets(
  records: readonly Transaction[],
  accounts: ReadonlyMap<string, Account>,
): TransactionFacets {
  const types = { income: 0, expense: 0, transfer: 0 };
  const statuses = { completed: 0, planned: 0, cancelled: 0 };
  const currencies = new Map<string, number>();
  const accountCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const record of records) {
    types[record.type] += 1;
    statuses[record.status] += 1;
    currencies.set(record.currency, (currencies.get(record.currency) ?? 0) + 1);
    for (const id of accountIds(record)) {
      accountCounts.set(id, (accountCounts.get(id) ?? 0) + 1);
    }
    if (
      record.purpose === "standard" &&
      "categoryId" in record &&
      !record.categoryId.startsWith("system:")
    ) {
      const id = record.categoryId as string;
      categoryCounts.set(id, (categoryCounts.get(id) ?? 0) + 1);
    }
  }
  const counted = (
    counts: ReadonlyMap<string, number>,
    label: (value: string) => string,
  ) => [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((left, right) =>
      left.label.localeCompare(right.label) || left.value.localeCompare(right.value));
  return {
    types,
    statuses,
    currencies: [...currencies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({
        value: value as CurrencyCode,
        count,
      })),
    accounts: counted(
      accountCounts,
      (id) => accounts.get(id)?.name ?? "Unavailable account",
    ),
    categories: counted(
      categoryCounts,
      (id) => id === "system:opening-balance"
        ? "Opening balance"
        : categoryLabel(id),
    ),
  };
}
