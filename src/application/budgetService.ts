import type { BudgetReadPort, BudgetUnitOfWork } from "./ports";
import { categoryFor } from "./transactionCategories";
import { ValidationError, requiredId } from "./validation";
import {
  currencyFractionDigits,
  isSupportedCurrency,
  parseMajor,
} from "../finance/money";
import { parseTimestamp } from "../finance/ledger";
import type {
  AuditEntry,
  AuditEntryId,
  Budget,
  BudgetId,
  BudgetMonth,
  CurrencyCode,
  MinorAmount,
  Transaction,
} from "../finance/types";

export interface BudgetDraft {
  readonly categoryId: string;
  readonly currency: string;
  readonly amount: string;
  readonly month: string;
}

export interface BudgetListQuery {
  readonly month: string;
  readonly currency?: CurrencyCode;
  readonly includeArchived?: boolean;
}

export type BudgetHealth = "on-track" | "warning" | "over-budget";

export interface BudgetListRow {
  readonly budget: Budget;
  readonly categoryLabel: string;
  readonly budgeted: MinorAmount;
  readonly spent: MinorAmount;
  readonly remaining: MinorAmount;
  readonly percentUsed: number;
  readonly status: BudgetHealth;
  readonly transactionIds: readonly Transaction["id"][];
}

export interface BudgetTotals {
  readonly budgeted: MinorAmount;
  readonly spent: MinorAmount;
  readonly remaining: MinorAmount;
}

export interface BudgetListResult {
  readonly month: BudgetMonth;
  readonly currency: CurrencyCode;
  readonly rows: readonly BudgetListRow[];
  readonly totals: BudgetTotals;
}

export interface BudgetServiceDependencies {
  readonly reads: BudgetReadPort;
  readonly uow: BudgetUnitOfWork;
  readonly budgetId?: () => BudgetId;
  readonly auditId?: () => AuditEntryId;
  readonly clock?: () => string;
}

const MAX_ID_ATTEMPTS = 10;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = BigInt(Number.MIN_SAFE_INTEGER);

export class BudgetService {
  private readonly dependencies: BudgetServiceDependencies;

  constructor(dependencies: BudgetServiceDependencies) {
    this.dependencies = dependencies;
  }

  async create(draft: BudgetDraft): Promise<Budget> {
    const core = validateDraft(draft);
    const id = await this.freshBudgetId();
    const now = this.now();
    const next: Budget = {
      ...core,
      id,
      rollover: false,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.uow.createBudget(
      next,
      this.audit(id, now, "budget.created", "Budget created"),
    );
    return next;
  }

  async update(idValue: string, draft: BudgetDraft): Promise<Budget> {
    const expected = await this.requireBudget(idValue);
    const now = this.now();
    const next: Budget = {
      ...validateDraft(draft),
      id: expected.id,
      rollover: false,
      status: expected.status,
      createdAt: expected.createdAt,
      updatedAt: now,
    };
    await this.dependencies.uow.replaceBudget(
      expected,
      next,
      this.audit(expected.id, now, "budget.updated", "Budget updated"),
    );
    return next;
  }

  archive(id: string): Promise<void> {
    return this.setStatus(id, "archived");
  }

  reactivate(id: string): Promise<void> {
    return this.setStatus(id, "active");
  }

  async delete(idValue: string): Promise<void> {
    const expected = await this.requireBudget(idValue);
    const now = this.now();
    await this.dependencies.uow.deleteBudget(
      expected,
      this.audit(expected.id, now, "budget.deleted", "Budget deleted"),
    );
  }

  async list(query: BudgetListQuery): Promise<BudgetListResult> {
    const month = validateMonth(query.month);
    if (
      query.includeArchived !== undefined &&
      typeof query.includeArchived !== "boolean"
    ) {
      throw new ValidationError("INVALID_FILTER", "includeArchived");
    }
    const [settings, budgets, transactions] = await Promise.all([
      this.dependencies.reads.getSettings(),
      this.dependencies.reads.listBudgets(),
      this.dependencies.reads.listTransactions(),
    ]);
    if (!settings) throw new Error("Application settings are missing");
    assertUniqueActiveScopes(budgets);
    const currency = query.currency ?? settings.baseCurrency;
    validateCurrency(currency);
    const includeArchived = query.includeArchived ?? false;
    const rows = budgets
      .filter((item) =>
        item.month === month &&
        item.currency === currency &&
        (includeArchived || item.status === "active"))
      .sort(compareBudgets)
      .map((item) => projectBudget(item, transactions));

    const budgeted = checked(rows.reduce(
      (sum, row) => sum + BigInt(row.budgeted),
      0n,
    ));
    const spent = checked(rows.reduce(
      (sum, row) => sum + BigInt(row.spent),
      0n,
    ));
    return {
      month,
      currency,
      rows,
      totals: {
        budgeted,
        spent,
        remaining: checked(BigInt(budgeted) - BigInt(spent)),
      },
    };
  }

  async availableCurrencies(): Promise<readonly CurrencyCode[]> {
    const [settings, accounts, budgets, transactions] = await Promise.all([
      this.dependencies.reads.getSettings(),
      this.dependencies.reads.listAccounts(),
      this.dependencies.reads.listBudgets(),
      this.dependencies.reads.listTransactions(),
    ]);
    if (!settings) throw new Error("Application settings are missing");
    const values = new Set<string>([
      settings.baseCurrency,
      ...accounts.map((item) => item.currency),
      ...budgets.map((item) => item.currency),
      ...transactions.map((item) => item.currency),
    ]);
    const result = [...values].map(validateCurrency);
    return result.sort((left, right) => left.localeCompare(right));
  }

  private async setStatus(
    idValue: string,
    status: Budget["status"],
  ): Promise<void> {
    const expected = await this.requireBudget(idValue);
    const now = this.now();
    const next: Budget = { ...expected, status, updatedAt: now };
    const reactivating = status === "active";
    await this.dependencies.uow.setBudgetStatus(
      expected,
      next,
      this.audit(
        expected.id,
        now,
        reactivating ? "budget.reactivated" : "budget.archived",
        reactivating ? "Budget reactivated" : "Budget archived",
      ),
    );
  }

  private async requireBudget(value: string): Promise<Budget> {
    const id = requiredId(value, "budgetId") as BudgetId;
    const existing = await this.dependencies.reads.getBudget(id);
    if (!existing) throw new ValidationError("BUDGET_NOT_FOUND", "budgetId");
    return existing;
  }

  private async freshBudgetId(): Promise<BudgetId> {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const id = requiredId(this.budgetId(), "budgetId") as BudgetId;
      if (!await this.dependencies.reads.getBudget(id)) return id;
    }
    throw new ValidationError("ID_COLLISION", "budgetId");
  }

  private audit(
    entityId: BudgetId,
    timestamp: string,
    action: Extract<AuditEntry["action"], `budget.${string}`>,
    description: string,
  ): AuditEntry {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const id = requiredId(this.auditId(), "auditId") as AuditEntryId;
      if ((id as string) !== (entityId as string)) {
        return {
          id,
          timestamp,
          action,
          entityType: "budget",
          entityId,
          description,
        };
      }
    }
    throw new ValidationError("ID_COLLISION", "auditId");
  }

  private now(): string {
    return (this.dependencies.clock ?? (() => new Date().toISOString()))();
  }

  private budgetId(): BudgetId {
    return (this.dependencies.budgetId ??
      (() => crypto.randomUUID() as BudgetId))();
  }

  private auditId(): AuditEntryId {
    return (this.dependencies.auditId ??
      (() => crypto.randomUUID() as AuditEntryId))();
  }
}

function validateDraft(
  draft: BudgetDraft,
): Pick<Budget, "name" | "categoryId" | "currency" | "amount" | "month"> {
  const categoryId = requiredId(draft.categoryId, "categoryId");
  const category = categoryFor(categoryId, "expense");
  if (!category) throw new ValidationError("INVALID_CATEGORY", "categoryId");
  const currency = validateCurrency(draft.currency);
  let amount: MinorAmount;
  try {
    amount = parseMajor(draft.amount, currencyFractionDigits(currency));
    if (amount <= 0) throw new RangeError("Amount must be positive");
  } catch {
    throw new ValidationError("INVALID_AMOUNT", "amount");
  }
  return {
    name: category.label,
    categoryId: category.id,
    currency,
    amount,
    month: validateMonth(draft.month),
  };
}

function validateCurrency(value: string): CurrencyCode {
  if (!isSupportedCurrency(value)) {
    throw new ValidationError("INVALID_CURRENCY", "currency");
  }
  return value;
}

function validateMonth(value: string): BudgetMonth {
  if (!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(value)) {
    throw new ValidationError("INVALID_DATE", "month");
  }
  return value as BudgetMonth;
}

function matchingExpenses(
  budget: Budget,
  transactions: readonly Transaction[],
): readonly Extract<Transaction, { type: "expense" }>[] {
  return transactions.filter(
    (item): item is Extract<Transaction, { type: "expense" }> =>
      item.type === "expense" &&
      item.status === "completed" &&
      item.purpose === "standard" &&
      item.currency === budget.currency &&
      item.categoryId === budget.categoryId &&
      new Date(parseTimestamp(item.effectiveAt)).toISOString().slice(0, 7) ===
        budget.month,
  );
}

function projectBudget(
  budget: Budget,
  transactions: readonly Transaction[],
): BudgetListRow {
  const matching = [...matchingExpenses(budget, transactions)]
    .sort((left, right) =>
      left.effectiveAt.localeCompare(right.effectiveAt) ||
      (left.id as string).localeCompare(right.id as string));
  const spent = checked(matching.reduce(
    (sum, item) => sum + BigInt(item.amount),
    0n,
  ));
  const remaining = checked(BigInt(budget.amount) - BigInt(spent));
  const percentUsed =
    Number(BigInt(spent) * 10_000n / BigInt(budget.amount)) / 100;
  if (!Number.isFinite(percentUsed)) {
    throw new RangeError("Budget percentage is not finite");
  }
  return {
    budget,
    categoryLabel: categoryFor(budget.categoryId, "expense")?.label ??
      budget.name,
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
}

function compareBudgets(left: Budget, right: Budget): number {
  const leftLabel = categoryFor(left.categoryId, "expense")?.label ?? left.name;
  const rightLabel =
    categoryFor(right.categoryId, "expense")?.label ?? right.name;
  return leftLabel.localeCompare(rightLabel) ||
    (left.id as string).localeCompare(right.id as string);
}

function checked(value: bigint): MinorAmount {
  if (value < MIN || value > MAX) {
    throw new RangeError("Calculated amount exceeds the safe integer range");
  }
  return Number(value) as MinorAmount;
}

function assertUniqueActiveScopes(budgets: readonly Budget[]): void {
  const ids = new Set<BudgetId>();
  const scopes = new Set<string>();
  for (const budget of budgets) {
    if (ids.has(budget.id)) throw new Error("Duplicate budget ID");
    ids.add(budget.id);
    if (budget.status !== "active") continue;
    const key = `${budget.month}\u0000${budget.categoryId}\u0000${budget.currency}`;
    if (scopes.has(key)) {
      throw new Error("Duplicate active budget scope");
    }
    scopes.add(key);
  }
}
