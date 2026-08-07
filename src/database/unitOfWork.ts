import type { FinanceUnitOfWork } from "../application/ports";
import { ValidationError } from "../application/validation";
import type {
  AppMetadata,
  AuditEntry,
  Transaction,
  TransactionId,
} from "../finance/types";
import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
  type MiroraTrackDatabase,
} from "./db";

export type UnitOfWorkStage = "afterLedgerMutation" | "beforeCommit";

export interface DexieFinanceUnitOfWorkOptions {
  readonly clock?: () => string;
  readonly onStage?: (stage: UnitOfWorkStage) => void;
}

type LedgerOperation = "create" | "replace" | "delete";

const expectedActions: Record<LedgerOperation, AuditEntry["action"]> = {
  create: "transaction.created",
  replace: "transaction.updated",
  delete: "transaction.deleted",
};

const expectedDescriptions: Record<LedgerOperation, string> = {
  create: "Transaction created",
  replace: "Transaction updated",
  delete: "Transaction deleted",
};

function validateAudit(
  operation: LedgerOperation,
  entityId: TransactionId,
  audit: AuditEntry,
): void {
  if (audit.action !== expectedActions[operation]) {
    throw new Error(`Invalid audit action for ${operation}`);
  }
  if (audit.entityType !== "transaction") {
    throw new Error("Invalid audit entity type");
  }
  if (audit.entityId !== entityId) {
    throw new Error("Audit entity id does not match transaction");
  }
  if ((audit.id as string) === (entityId as string)) {
    throw new Error("Audit id must be independent from transaction id");
  }
  if (audit.description !== expectedDescriptions[operation]) {
    throw new Error(`Invalid audit description for ${operation}`);
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(audit.timestamp) ||
    !Number.isFinite(Date.parse(audit.timestamp)) ||
    new Date(Date.parse(audit.timestamp)).toISOString() !== audit.timestamp
  ) {
    throw new Error(`Invalid audit timestamp for ${operation}`);
  }
}

function nextMetadata(metadata: AppMetadata | undefined, clock: () => string) {
  if (!metadata) throw new Error("App metadata is missing");
  if (metadata.schemaVersion !== DATABASE_VERSION) {
    throw new Error("App metadata schema version is invalid");
  }
  if (metadata.calculationVersion !== CALCULATION_VERSION) {
    throw new Error("App metadata calculation version is invalid");
  }
  if (
    !Number.isSafeInteger(metadata.ledgerRevision) ||
    metadata.ledgerRevision < 0
  ) {
    throw new Error("App metadata ledger revision is invalid");
  }
  const ledgerRevision = metadata.ledgerRevision + 1;
  if (!Number.isSafeInteger(ledgerRevision)) {
    throw new Error("App metadata ledger revision would overflow");
  }
  return { ...metadata, ledgerRevision, updatedAt: clock() };
}

export class DexieFinanceUnitOfWork implements FinanceUnitOfWork {
  private readonly db: MiroraTrackDatabase;
  private readonly clock: () => string;
  private readonly onStage: ((stage: UnitOfWorkStage) => void) | undefined;

  constructor(
    db: MiroraTrackDatabase,
    options: DexieFinanceUnitOfWorkOptions = {},
  ) {
    this.db = db;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.onStage = options.onStage;
  }

  async createTransaction(
    transaction: Transaction,
    audit: AuditEntry,
  ): Promise<void> {
    validateAudit("create", transaction.id, audit);
    await this.commit("create", transaction.id, audit, async () => {
      await this.validateAccounts(transaction);
      await this.db.transactions.add(transaction);
    });
  }

  async replaceTransaction(
    expected: Transaction,
    next: Transaction,
    audit: AuditEntry,
  ): Promise<void> {
    if (expected.id !== next.id) {
      throw new Error("Replacement transaction id must remain unchanged");
    }
    protectOpening(expected);
    validateAudit("replace", expected.id, audit);
    await this.commit("replace", expected.id, audit, async () => {
      const current = await this.db.transactions.get(expected.id);
      if (current !== undefined) protectOpening(current);
      ensureCurrent(expected, current);
      await this.validateAccounts(next);
      await this.db.transactions.put(next);
    });
  }

  async deleteTransaction(
    expected: Transaction,
    audit: AuditEntry,
  ): Promise<void> {
    protectOpening(expected);
    validateAudit("delete", expected.id, audit);
    await this.commit("delete", expected.id, audit, async () => {
      const current = await this.db.transactions.get(expected.id);
      if (current !== undefined) protectOpening(current);
      ensureCurrent(expected, current);
      await this.db.transactions.delete(expected.id);
    });
  }

  private async commit(
    _operation: LedgerOperation,
    _entityId: TransactionId,
    audit: AuditEntry,
    mutateLedger: () => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.transactions,
      this.db.accounts,
      this.db.auditEntries,
      this.db.metadata,
      this.db.calculationCaches,
      async () => {
        const metadata = await this.db.metadata.get(APP_METADATA_KEY);
        const updatedMetadata = nextMetadata(metadata, this.clock);
        await mutateLedger();
        this.onStage?.("afterLedgerMutation");
        await this.db.auditEntries.add(audit);
        await this.db.metadata.put(updatedMetadata);
        await this.db.calculationCaches.clear();
        this.onStage?.("beforeCommit");
      },
    );
  }

  private async validateAccounts(transaction: Transaction): Promise<void> {
    if (
      transaction.type === "transfer" &&
      transaction.sourceAccountId === transaction.destinationAccountId
    ) {
      throw new Error("Transfer accounts must be distinct");
    }
    const ids = transaction.type === "income"
      ? [transaction.destinationAccountId]
      : transaction.type === "expense"
        ? [transaction.sourceAccountId]
        : [transaction.sourceAccountId, transaction.destinationAccountId];
    for (const id of ids) {
      const account = await this.db.accounts.get(id);
      if (!account) throw new Error("Referenced transaction account is missing");
      if (account.status !== "active") {
        throw new Error("Referenced transaction account is archived");
      }
      if (account.currency !== transaction.currency) {
        throw new Error("Referenced transaction account currency does not match");
      }
    }
  }
}

function protectOpening(transaction: Transaction): void {
  if (transaction.purpose === "opening-balance") {
    throw new ValidationError(
      "OPENING_BALANCE_PROTECTED",
      "transactionId",
    );
  }
}

function ensureCurrent(
  expected: Transaction,
  current: Transaction | undefined,
): asserts current is Transaction {
  if (current === undefined || !samePersistedRecord(expected, current)) {
    throw new ValidationError(
      "CONCURRENT_MODIFICATION",
      "transactionId",
    );
  }
}

function samePersistedRecord(
  expected: Transaction,
  current: Transaction,
): boolean {
  return canonical(expected) === canonical(current);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
