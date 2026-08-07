import type { BudgetUnitOfWork } from "../application/ports";
import { categoryFor } from "../application/transactionCategories";
import { ValidationError } from "../application/validation";
import { isSupportedCurrency } from "../finance/money";
import type {
  AppMetadata,
  AuditEntry,
  Budget,
  BudgetId,
} from "../finance/types";
import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
  type MiroraTrackDatabase,
} from "./db";

export type BudgetUnitOfWorkStage =
  | "afterBudgetMutation"
  | "afterAudit"
  | "afterMetadata"
  | "afterCacheClear"
  | "beforeCommit";

export interface DexieBudgetUnitOfWorkOptions {
  readonly clock?: () => string;
  readonly onStage?: (stage: BudgetUnitOfWorkStage) => void;
}

type BudgetOperation =
  | "create"
  | "replace"
  | "archive"
  | "reactivate"
  | "delete";

const actionByOperation = {
  create: "budget.created",
  replace: "budget.updated",
  archive: "budget.archived",
  reactivate: "budget.reactivated",
  delete: "budget.deleted",
} as const;

const descriptionByOperation = {
  create: "Budget created",
  replace: "Budget updated",
  archive: "Budget archived",
  reactivate: "Budget reactivated",
  delete: "Budget deleted",
} as const;

export class DexieBudgetUnitOfWork implements BudgetUnitOfWork {
  private readonly db: MiroraTrackDatabase;
  private readonly clock: () => string;
  private readonly onStage:
    | ((stage: BudgetUnitOfWorkStage) => void)
    | undefined;

  constructor(
    db: MiroraTrackDatabase,
    options: DexieBudgetUnitOfWorkOptions = {},
  ) {
    this.db = db;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.onStage = options.onStage;
  }

  async createBudget(budget: Budget, audit: AuditEntry): Promise<void> {
    validateBudget(budget);
    if (budget.status !== "active") {
      throw new Error("New budgets must be active");
    }
    validateAudit("create", budget.id, audit);
    await this.commit(audit, async () => {
      if (await this.db.budgets.get(budget.id)) {
        throw new ValidationError("ID_COLLISION", "budgetId");
      }
      await this.ensureScopeAvailable(budget);
      await this.db.budgets.add(budget);
    });
  }

  async replaceBudget(
    expected: Budget,
    next: Budget,
    audit: AuditEntry,
  ): Promise<void> {
    if (expected.id !== next.id || expected.createdAt !== next.createdAt) {
      throw new Error("Budget identity and creation time are immutable");
    }
    if (expected.status !== next.status) {
      throw new Error("Use setBudgetStatus to change budget status");
    }
    validateBudget(next);
    validateAudit("replace", expected.id, audit);
    await this.commit(audit, async () => {
      await this.ensureCurrent(expected);
      await this.ensureScopeAvailable(next, next.id);
      await this.db.budgets.put(next);
    });
  }

  async setBudgetStatus(
    expected: Budget,
    next: Budget,
    audit: AuditEntry,
  ): Promise<void> {
    if (!sameExceptStatusAndUpdatedAt(expected, next)) {
      throw new Error("Status operation may only change status and updatedAt");
    }
    const operation = expected.status === "active" &&
        next.status === "archived"
      ? "archive"
      : expected.status === "archived" && next.status === "active"
        ? "reactivate"
        : undefined;
    if (!operation) throw new Error("Invalid budget status transition");
    validateBudget(next);
    validateAudit(operation, expected.id, audit);
    await this.commit(audit, async () => {
      await this.ensureCurrent(expected);
      if (next.status === "active") {
        await this.ensureScopeAvailable(next, next.id);
      }
      await this.db.budgets.put(next);
    });
  }

  async deleteBudget(expected: Budget, audit: AuditEntry): Promise<void> {
    if (expected.status !== "archived") {
      throw new ValidationError("BUDGET_MUST_BE_ARCHIVED", "budgetId");
    }
    validateAudit("delete", expected.id, audit);
    await this.commit(audit, async () => {
      await this.ensureCurrent(expected);
      await this.db.budgets.delete(expected.id);
    });
  }

  private async commit(
    audit: AuditEntry,
    mutation: () => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.budgets,
      this.db.auditEntries,
      this.db.metadata,
      this.db.calculationCaches,
      async () => {
        const metadata = nextMetadata(
          await this.db.metadata.get(APP_METADATA_KEY),
          this.clock,
        );
        await mutation();
        this.onStage?.("afterBudgetMutation");
        await this.db.auditEntries.add(audit);
        this.onStage?.("afterAudit");
        await this.db.metadata.put(metadata);
        this.onStage?.("afterMetadata");
        await this.db.calculationCaches.clear();
        this.onStage?.("afterCacheClear");
        this.onStage?.("beforeCommit");
      },
    );
  }

  private async ensureCurrent(expected: Budget): Promise<void> {
    const current = await this.db.budgets.get(expected.id);
    if (!current || canonical(current) !== canonical(expected)) {
      throw new ValidationError("CONCURRENT_MODIFICATION", "budgetId");
    }
  }

  private async ensureScopeAvailable(
    candidate: Budget,
    exceptId?: BudgetId,
  ): Promise<void> {
    if (candidate.status !== "active") return;
    const collision = (await this.db.budgets.toArray()).some((budget) =>
      budget.status === "active" &&
      budget.id !== exceptId &&
      budget.month === candidate.month &&
      budget.categoryId === candidate.categoryId &&
      budget.currency === candidate.currency
    );
    if (collision) {
      throw new ValidationError("BUDGET_SCOPE_CONFLICT", "categoryId");
    }
  }
}

function validateBudget(budget: Budget): void {
  if (
    budget.name.trim().length === 0 ||
    budget.name !== budget.name.trim() ||
    budget.name.length > 60
  ) {
    throw new Error("Invalid budget name");
  }
  if (!categoryFor(budget.categoryId, "expense")) {
    throw new ValidationError("INVALID_CATEGORY", "categoryId");
  }
  if (!isSupportedCurrency(budget.currency)) {
    throw new ValidationError("INVALID_CURRENCY", "currency");
  }
  if (!Number.isSafeInteger(budget.amount) || budget.amount <= 0) {
    throw new ValidationError("INVALID_AMOUNT", "amount");
  }
  if (!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(budget.month)) {
    throw new ValidationError("INVALID_DATE", "month");
  }
  if (budget.rollover !== false) {
    throw new Error("Budget rollover must be false");
  }
  if (budget.status !== "active" && budget.status !== "archived") {
    throw new ValidationError("INVALID_STATUS", "status");
  }
  validateIso(budget.createdAt, "createdAt");
  validateIso(budget.updatedAt, "updatedAt");
}

function validateAudit(
  operation: BudgetOperation,
  entityId: BudgetId,
  audit: AuditEntry,
): void {
  if (audit.action !== actionByOperation[operation]) {
    throw new Error(`Invalid audit action for ${operation}`);
  }
  if (audit.entityType !== "budget") {
    throw new Error("Invalid audit entity type");
  }
  if (audit.entityId !== entityId) {
    throw new Error("Audit entity id does not match budget");
  }
  if (audit.id === (entityId as unknown as AuditEntry["id"])) {
    throw new Error("Audit id must be independent from budget id");
  }
  if (audit.description !== descriptionByOperation[operation]) {
    throw new Error(`Invalid audit description for ${operation}`);
  }
  validateIso(audit.timestamp, "audit timestamp");
}

function nextMetadata(
  metadata: AppMetadata | undefined,
  clock: () => string,
): AppMetadata {
  if (
    !metadata ||
    metadata.schemaVersion !== DATABASE_VERSION ||
    metadata.calculationVersion !== CALCULATION_VERSION ||
    !Number.isSafeInteger(metadata.ledgerRevision) ||
    metadata.ledgerRevision < 0 ||
    metadata.ledgerRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("App metadata is invalid");
  }
  return {
    ...metadata,
    ledgerRevision: metadata.ledgerRevision + 1,
    updatedAt: clock(),
  };
}

function validateIso(value: string, field: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error(`Invalid ${field}`);
  }
}

function sameExceptStatusAndUpdatedAt(
  expected: Budget,
  next: Budget,
): boolean {
  const { status: _expectedStatus, updatedAt: _expectedUpdated, ...left } =
    expected;
  const { status: _nextStatus, updatedAt: _nextUpdated, ...right } = next;
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
