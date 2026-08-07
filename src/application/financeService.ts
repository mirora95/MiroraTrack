import type { FinanceReadPort, FinanceUnitOfWork } from "./ports";
import { categoryFor } from "./transactionCategories";
import { ValidationError, requiredId } from "./validation";
import { currencyFractionDigits, parseMajor } from "../finance/money";
import type {
  Account,
  AccountId,
  AuditEntry,
  AuditEntryId,
  CategoryId,
  Transaction,
  TransactionId,
} from "../finance/types";

type SharedDraft = {
  readonly status: Transaction["status"];
  readonly amount: string;
  readonly date: string;
  readonly note?: string;
};

export type TransactionDraft =
  | (SharedDraft & {
      readonly type: "income";
      readonly destinationAccountId: string;
      readonly categoryId: string;
    })
  | (SharedDraft & {
      readonly type: "expense";
      readonly sourceAccountId: string;
      readonly categoryId: string;
    })
  | (SharedDraft & {
      readonly type: "transfer";
      readonly sourceAccountId: string;
      readonly destinationAccountId: string;
      readonly categoryId?: never;
    });

export interface FinanceServiceDependencies {
  readonly reads: FinanceReadPort;
  readonly uow: FinanceUnitOfWork;
  readonly transactionId?: () => TransactionId;
  readonly auditId?: () => AuditEntryId;
  readonly clock?: () => string;
}

const defaultTransactionId = () => crypto.randomUUID() as TransactionId;
const defaultAuditId = () => crypto.randomUUID() as AuditEntryId;
const defaultClock = () => new Date().toISOString();

export class FinanceService {
  private readonly dependencies: FinanceServiceDependencies;
  private readonly transactionId: () => TransactionId;
  private readonly auditId: () => AuditEntryId;
  private readonly clock: () => string;

  constructor(dependencies: FinanceServiceDependencies) {
    this.dependencies = dependencies;
    this.transactionId = dependencies.transactionId ?? defaultTransactionId;
    this.auditId = dependencies.auditId ?? defaultAuditId;
    this.clock = dependencies.clock ?? defaultClock;
  }

  async create(draft: TransactionDraft): Promise<Transaction> {
    const core = await this.validate(draft);
    const id = requiredId(this.transactionId(), "transactionId") as TransactionId;
    const auditId = this.validAuditId(id);
    const now = this.clock();
    const transaction = {
      ...core,
      id,
      createdAt: now,
      updatedAt: now,
    } as Transaction;
    await this.dependencies.uow.createTransaction(
      transaction,
      this.audit(
        auditId,
        id,
        now,
        "transaction.created",
        "Transaction created",
      ),
    );
    return transaction;
  }

  async edit(idValue: string, draft: TransactionDraft): Promise<Transaction> {
    const id = requiredId(idValue, "transactionId") as TransactionId;
    const expected = await this.dependencies.reads.getTransaction(id);
    if (expected === undefined) {
      throw new ValidationError("TRANSACTION_NOT_FOUND", "transactionId");
    }
    this.protectOpening(expected);
    const preservedCategory =
      expected.type === draft.type &&
      expected.type !== "transfer"
        ? expected.categoryId
        : undefined;
    const core = await this.validate(draft, preservedCategory);
    const auditId = this.validAuditId(id);
    const now = this.clock();
    const next = {
      ...core,
      id,
      createdAt: expected.createdAt,
      updatedAt: now,
    } as Transaction;
    await this.dependencies.uow.replaceTransaction(
      expected,
      next,
      this.audit(
        auditId,
        id,
        now,
        "transaction.updated",
        "Transaction updated",
      ),
    );
    return next;
  }

  async delete(idValue: string): Promise<void> {
    const id = requiredId(idValue, "transactionId") as TransactionId;
    const expected = await this.dependencies.reads.getTransaction(id);
    if (expected === undefined) {
      throw new ValidationError("TRANSACTION_NOT_FOUND", "transactionId");
    }
    this.protectOpening(expected);
    const auditId = this.validAuditId(id);
    const now = this.clock();
    await this.dependencies.uow.deleteTransaction(
      expected,
      this.audit(
        auditId,
        id,
        now,
        "transaction.deleted",
        "Transaction deleted",
      ),
    );
  }

  private protectOpening(transaction: Transaction): void {
    if (transaction.purpose === "opening-balance") {
      throw new ValidationError("OPENING_BALANCE_PROTECTED", "transactionId");
    }
  }

  private validAuditId(transactionId: TransactionId): AuditEntryId {
    const id = requiredId(this.auditId(), "auditId") as AuditEntryId;
    if (id === (transactionId as string)) {
      throw new ValidationError("ID_COLLISION", "auditId");
    }
    return id;
  }

  private audit(
    id: AuditEntryId,
    entityId: TransactionId,
    timestamp: string,
    action: Extract<AuditEntry["action"], `transaction.${string}`>,
    description: string,
  ): AuditEntry {
    return {
      id,
      timestamp,
      action,
      entityType: "transaction",
      entityId,
      description,
    };
  }

  private async validate(
    draft: TransactionDraft,
    preservedCategory?: CategoryId,
  ): Promise<Omit<Transaction, "id" | "createdAt" | "updatedAt">> {
    if (!["income", "expense", "transfer"].includes(draft.type)) {
      throw new ValidationError("INVALID_TYPE", "type");
    }
    if (!["completed", "planned", "cancelled"].includes(draft.status)) {
      throw new ValidationError("INVALID_STATUS", "status");
    }
    const effectiveAt = utcMidnight(draft.date);
    const description = note(draft.note);

    if (draft.type === "income") {
      const destinationAccountId = requiredId(
        draft.destinationAccountId,
        "destinationAccountId",
      ) as AccountId;
      const account = await this.account(destinationAccountId, "destinationAccountId");
      return {
        type: "income",
        status: draft.status,
        purpose: "standard",
        amount: amount(draft.amount, account),
        currency: account.currency,
        effectiveAt,
        destinationAccountId,
        categoryId: category(
          draft.categoryId,
          "income",
          preservedCategory,
        ),
        ...(description === undefined ? {} : { description }),
      };
    }

    if (draft.type === "expense") {
      const sourceAccountId = requiredId(
        draft.sourceAccountId,
        "sourceAccountId",
      ) as AccountId;
      const account = await this.account(sourceAccountId, "sourceAccountId");
      return {
        type: "expense",
        status: draft.status,
        purpose: "standard",
        amount: amount(draft.amount, account),
        currency: account.currency,
        effectiveAt,
        sourceAccountId,
        categoryId: category(
          draft.categoryId,
          "expense",
          preservedCategory,
        ),
        ...(description === undefined ? {} : { description }),
      };
    }

    if ("categoryId" in draft && draft.categoryId !== undefined) {
      throw new ValidationError("INVALID_CATEGORY", "categoryId");
    }
    const sourceAccountId = requiredId(
      draft.sourceAccountId,
      "sourceAccountId",
    ) as AccountId;
    const destinationAccountId = requiredId(
      draft.destinationAccountId,
      "destinationAccountId",
    ) as AccountId;
    if (sourceAccountId === destinationAccountId) {
      throw new ValidationError("SAME_ACCOUNT", "destinationAccountId");
    }
    const source = await this.account(sourceAccountId, "sourceAccountId");
    const destination = await this.account(
      destinationAccountId,
      "destinationAccountId",
    );
    if (source.currency !== destination.currency) {
      throw new ValidationError("CURRENCY_MISMATCH", "destinationAccountId");
    }
    return {
      type: "transfer",
      status: draft.status,
      purpose: "standard",
      amount: amount(draft.amount, source),
      currency: source.currency,
      effectiveAt,
      sourceAccountId,
      destinationAccountId,
      ...(description === undefined ? {} : { description }),
    };
  }

  private async account(id: AccountId, field: string): Promise<Account> {
    const account = await this.dependencies.reads.getAccount(id);
    if (account === undefined) {
      throw new ValidationError("ACCOUNT_NOT_FOUND", field);
    }
    if (account.status !== "active") {
      throw new ValidationError("ACCOUNT_ARCHIVED", field);
    }
    return account;
  }
}

function amount(value: string, account: Account): Transaction["amount"] {
  try {
    const parsed = parseMajor(value, currencyFractionDigits(account.currency));
    if (parsed <= 0) throw new RangeError("Amount must be positive");
    return parsed;
  } catch {
    throw new ValidationError("INVALID_AMOUNT", "amount");
  }
}

function category(
  value: string,
  type: "income" | "expense",
  preservedCategory?: CategoryId,
): CategoryId {
  const normalized = requiredId(value, "categoryId");
  if (
    normalized.length > 64 ||
    normalized.startsWith("system:") ||
    (
      normalized !== preservedCategory &&
      categoryFor(normalized, type) === undefined
    )
  ) {
    throw new ValidationError("INVALID_CATEGORY", "categoryId");
  }
  return normalized as CategoryId;
}

function note(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.includes("\u0000") || normalized.length > 240) {
    throw new ValidationError("INVALID_NOTE", "note");
  }
  return normalized.length === 0 ? undefined : normalized;
}

function utcMidnight(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ValidationError("INVALID_DATE", "date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError("INVALID_DATE", "date");
  }
  return `${value}T00:00:00.000Z`;
}
