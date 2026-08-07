import type { FinanceUnitOfWork } from "../application/ports";
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
    previousId: TransactionId,
    next: Transaction,
    audit: AuditEntry,
  ): Promise<void> {
    if (previousId !== next.id) {
      throw new Error("Replacement transaction id must remain unchanged");
    }
    validateAudit("replace", previousId, audit);
    await this.commit("replace", previousId, audit, async () => {
      if (!(await this.db.transactions.get(previousId))) {
        throw new Error("Transaction to replace does not exist");
      }
      await this.validateAccounts(next);
      await this.db.transactions.put(next);
    });
  }

  async deleteTransaction(
    id: TransactionId,
    audit: AuditEntry,
  ): Promise<void> {
    validateAudit("delete", id, audit);
    await this.commit("delete", id, audit, async () => {
      if (!(await this.db.transactions.get(id))) {
        throw new Error("Transaction to delete does not exist");
      }
      await this.db.transactions.delete(id);
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
