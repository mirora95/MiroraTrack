import type {
  AccountUnitOfWork,
  AccountWriteRecords,
  InitializationWriteRecords,
} from "../application/ports";
import type {
  Account,
  AccountId,
  AppMetadata,
  AuditEntry,
} from "../finance/types";
import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
  type MiroraTrackDatabase,
} from "./db";

export type AccountUnitOfWorkStage =
  | "afterAccount"
  | "afterTransaction"
  | "afterAudit"
  | "afterMetadata"
  | "afterCacheClear"
  | "beforeCommit";

export interface DexieAccountUnitOfWorkOptions {
  readonly clock?: () => string;
  readonly onStage?: (stage: AccountUnitOfWorkStage) => void;
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

function validateAccountAudit(
  accountId: AccountId,
  audit: AuditEntry,
  action: AuditEntry["action"],
): void {
  if (
    audit.action !== action ||
    audit.entityType !== "account" ||
    audit.entityId !== accountId
  ) {
    throw new Error("Account audit does not match the operation");
  }
}

function validateCreateRecords(records: AccountWriteRecords): void {
  validateAccountAudit(records.account.id, records.accountAudit, "account.created");
  if ((records.openingTransaction === undefined) !==
      (records.transactionAudit === undefined)) {
    throw new Error("Opening transaction and audit must be provided together");
  }
  if (records.openingTransaction) {
    const transaction = records.openingTransaction;
    const exactDirection =
      (transaction.type === "income" &&
        transaction.destinationAccountId === records.account.id &&
        !("sourceAccountId" in transaction)) ||
      (transaction.type === "expense" &&
        transaction.sourceAccountId === records.account.id &&
        !("destinationAccountId" in transaction));
    if (
      transaction.type === "transfer" ||
      transaction.purpose !== "opening-balance" ||
      transaction.status !== "completed" ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount <= 0 ||
      transaction.currency !== records.account.currency ||
      transaction.effectiveAt !== records.account.createdAt ||
      transaction.categoryId !== "system:opening-balance" ||
      !exactDirection ||
      records.transactionAudit?.action !== "transaction.created" ||
      records.transactionAudit.entityType !== "transaction" ||
      records.transactionAudit.entityId !== transaction.id ||
      records.transactionAudit.id === (transaction.id as string)
    ) {
      throw new Error("Opening transaction records are invalid");
    }
  }
}

export class DexieAccountUnitOfWork implements AccountUnitOfWork {
  private readonly db: MiroraTrackDatabase;
  private readonly clock: () => string;
  private readonly onStage: ((stage: AccountUnitOfWorkStage) => void) | undefined;

  constructor(
    db: MiroraTrackDatabase,
    options: DexieAccountUnitOfWorkOptions = {},
  ) {
    this.db = db;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.onStage = options.onStage;
  }

  async initialize(records: InitializationWriteRecords): Promise<void> {
    validateCreateRecords(records);
    await this.transaction(async () => {
      if (
        await this.db.settings.count() !== 0 ||
        await this.db.accounts.count() !== 0
      ) {
        throw new Error("Application is already initialized");
      }
      if (records.settings.defaultAccountId !== records.account.id) {
        throw new Error("Initial account must be the default account");
      }
      await this.db.settings.add(records.settings);
      await this.writeCreatedAccount(records);
    });
  }

  async createAccount(records: AccountWriteRecords): Promise<void> {
    validateCreateRecords(records);
    await this.transaction(async () => {
      if (!(await this.db.settings.get("primary"))) {
        throw new Error("Settings are missing");
      }
      await this.writeCreatedAccount(records);
    });
  }

  async updateAccount(account: Account, audit: AuditEntry): Promise<void> {
    validateAccountAudit(account.id, audit, "account.updated");
    await this.transaction(async () => {
      const previous = await this.db.accounts.get(account.id);
      if (!previous) throw new Error("Account does not exist");
      if (previous.createdAt !== account.createdAt || previous.id !== account.id) {
        throw new Error("Account identity is immutable");
      }
      if (previous.currency !== account.currency) {
        const referenced = await this.db.transactions
          .filter((transaction) =>
            ("sourceAccountId" in transaction &&
              transaction.sourceAccountId === account.id) ||
            ("destinationAccountId" in transaction &&
              transaction.destinationAccountId === account.id),
          )
          .count();
        if (referenced > 0) {
          throw new Error("Account currency cannot change after transactions");
        }
      }
      await this.db.accounts.put({ ...account, status: previous.status });
      this.onStage?.("afterAccount");
      this.onStage?.("afterTransaction");
      await this.db.auditEntries.add(audit);
      this.onStage?.("afterAudit");
    });
  }

  async setAccountStatus(
    id: AccountId,
    status: Account["status"],
    preferredDefaultAccountId: AccountId | undefined,
    audit: AuditEntry,
  ): Promise<void> {
    validateAccountAudit(
      id, audit,
      status === "active" ? "account.reactivated" : "account.archived",
    );
    await this.transaction(async () => {
      const account = await this.db.accounts.get(id);
      if (!account) throw new Error("Account does not exist");
      await this.db.accounts.put({
        ...account, status, updatedAt: audit.timestamp,
      });
      this.onStage?.("afterAccount");
      this.onStage?.("afterTransaction");
      const settings = await this.db.settings.get("primary");
      if (!settings) throw new Error("Settings are missing");
      if (status === "archived" && settings.defaultAccountId === id) {
        const active = (await this.db.accounts.toArray())
          .filter((candidate) =>
            candidate.id !== id && candidate.status === "active")
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id));
        const replacement =
          active.find(({ id: candidateId }) =>
            candidateId === preferredDefaultAccountId)?.id ??
          active[0]?.id;
        const { defaultAccountId: _, ...withoutDefault } = settings;
        await this.db.settings.put(replacement
          ? { ...withoutDefault, defaultAccountId: replacement }
          : withoutDefault);
      }
      await this.db.auditEntries.add(audit);
      this.onStage?.("afterAudit");
    });
  }

  private async writeCreatedAccount(records: AccountWriteRecords): Promise<void> {
    await this.db.accounts.add(records.account);
    this.onStage?.("afterAccount");
    if (records.openingTransaction) {
      await this.db.transactions.add(records.openingTransaction);
    }
    this.onStage?.("afterTransaction");
    await this.db.auditEntries.add(records.accountAudit);
    if (records.transactionAudit) {
      await this.db.auditEntries.add(records.transactionAudit);
    }
    this.onStage?.("afterAudit");
  }

  private async transaction(work: () => Promise<void>): Promise<void> {
    await this.db.transaction(
      "rw",
      [
        this.db.settings,
        this.db.accounts,
        this.db.transactions,
        this.db.auditEntries,
        this.db.metadata,
        this.db.calculationCaches,
      ],
      async () => {
        const metadata = nextMetadata(
          await this.db.metadata.get(APP_METADATA_KEY),
          this.clock,
        );
        await work();
        await this.db.metadata.put(metadata);
        this.onStage?.("afterMetadata");
        await this.db.calculationCaches.clear();
        this.onStage?.("afterCacheClear");
        this.onStage?.("beforeCommit");
      },
    );
  }
}
