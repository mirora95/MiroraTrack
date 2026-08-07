import type { FinanceReadPort, FinanceUnitOfWork } from "./ports";
import { ValidationError, requiredId } from "./validation";
import { parseTimestamp } from "../finance/ledger";
import { currencyCode } from "../finance/money";
import { minorAmount } from "../finance/types";
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
  readonly amount: number;
  readonly currency: string;
  readonly effectiveAt: string;
  readonly description?: string;
};
export type TransactionDraft =
  | (SharedDraft & { readonly type: "income"; readonly destinationAccountId: string; readonly categoryId: string })
  | (SharedDraft & { readonly type: "expense"; readonly sourceAccountId: string; readonly categoryId: string })
  | (SharedDraft & { readonly type: "transfer"; readonly sourceAccountId: string; readonly destinationAccountId: string });

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
    const transaction = { ...core, id, createdAt: now, updatedAt: now } as Transaction;
    await this.dependencies.uow.createTransaction(
      transaction,
      this.audit(auditId, id, now, "transaction.created", "Transaction created"),
    );
    return transaction;
  }

  async edit(idValue: string, draft: TransactionDraft): Promise<Transaction> {
    const id = requiredId(idValue, "transactionId") as TransactionId;
    const previous = await this.dependencies.reads.getTransaction(id);
    if (previous === undefined) throw new ValidationError("TRANSACTION_NOT_FOUND", "transactionId");
    const core = await this.validate(draft);
    const auditId = this.validAuditId(id);
    const now = this.clock();
    const next = { ...core, id, createdAt: previous.createdAt, updatedAt: now } as Transaction;
    await this.dependencies.uow.replaceTransaction(
      id, next, this.audit(auditId, id, now, "transaction.updated", "Transaction updated"),
    );
    return next;
  }

  async delete(idValue: string): Promise<void> {
    const id = requiredId(idValue, "transactionId") as TransactionId;
    if (await this.dependencies.reads.getTransaction(id) === undefined) {
      throw new ValidationError("TRANSACTION_NOT_FOUND", "transactionId");
    }
    const auditId = this.validAuditId(id);
    const now = this.clock();
    await this.dependencies.uow.deleteTransaction(
      id, this.audit(auditId, id, now, "transaction.deleted", "Transaction deleted"),
    );
  }

  private validAuditId(transactionId: TransactionId): AuditEntryId {
    const id = requiredId(this.auditId(), "auditId") as AuditEntryId;
    if (id === (transactionId as string)) throw new ValidationError("ID_COLLISION", "auditId");
    return id;
  }

  private audit(
    id: AuditEntryId, entityId: TransactionId, timestamp: string,
    action: AuditEntry["action"], description: string,
  ): AuditEntry {
    return { id, timestamp, action, entityType: "transaction", entityId, description };
  }

  private async validate(draft: TransactionDraft): Promise<Omit<Transaction, "id" | "createdAt" | "updatedAt">> {
    if (!["completed", "planned", "cancelled"].includes(draft.status)) {
      throw new ValidationError("INVALID_STATUS", "status");
    }
    if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) {
      throw new ValidationError("INVALID_AMOUNT", "amount");
    }
    let currency;
    try { currency = currencyCode(draft.currency); }
    catch { throw new ValidationError("INVALID_CURRENCY", "currency"); }
    try { parseTimestamp(draft.effectiveAt); }
    catch { throw new ValidationError("INVALID_TIMESTAMP", "effectiveAt"); }
    const shared = {
      status: draft.status, amount: minorAmount(draft.amount), currency,
      effectiveAt: draft.effectiveAt,
      ...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
    };
    if (draft.type === "income") {
      const destinationAccountId = requiredId(draft.destinationAccountId, "destinationAccountId") as AccountId;
      await this.account(destinationAccountId, currency, "destinationAccountId");
      return { ...shared, type: "income", destinationAccountId, categoryId: this.category(draft.categoryId) };
    }
    if (draft.type === "expense") {
      const sourceAccountId = requiredId(draft.sourceAccountId, "sourceAccountId") as AccountId;
      await this.account(sourceAccountId, currency, "sourceAccountId");
      return { ...shared, type: "expense", sourceAccountId, categoryId: this.category(draft.categoryId) };
    }
    if (draft.type === "transfer") {
      const sourceAccountId = requiredId(draft.sourceAccountId, "sourceAccountId") as AccountId;
      const destinationAccountId = requiredId(draft.destinationAccountId, "destinationAccountId") as AccountId;
      if (sourceAccountId === destinationAccountId) throw new ValidationError("SAME_ACCOUNT", "destinationAccountId");
      await this.account(sourceAccountId, currency, "sourceAccountId");
      await this.account(destinationAccountId, currency, "destinationAccountId");
      return { ...shared, type: "transfer", sourceAccountId, destinationAccountId };
    }
    throw new ValidationError("INVALID_TYPE", "type");
  }

  private category(value: string): CategoryId {
    return requiredId(value, "categoryId") as CategoryId;
  }

  private async account(id: AccountId, currency: Account["currency"], field: string): Promise<Account> {
    const account = await this.dependencies.reads.getAccount(id);
    if (account === undefined) throw new ValidationError("ACCOUNT_NOT_FOUND", field);
    if (account.status === "archived") throw new ValidationError("ACCOUNT_ARCHIVED", field);
    if (account.currency !== currency) throw new ValidationError("CURRENCY_MISMATCH", field);
    return account;
  }
}
