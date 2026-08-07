import { deriveBalances } from "../finance/ledger";
import type {
  Account,
  AccountId,
  AuditEntryId,
  MinorAmount,
  TransactionId,
} from "../finance/types";
import {
  accountAudit,
  type AccountDraft,
  openingTransaction,
  transactionAudit,
  validateAccountDraft,
  validatedId,
} from "./accountRecords";
import type { AccountReadPort, AccountUnitOfWork } from "./ports";
import { ValidationError } from "./validation";

export interface AccountListItem {
  readonly account: Account;
  readonly balance: MinorAmount;
}

export interface UpdateAccountCommand extends Omit<AccountDraft, "openingBalance"> {
  readonly id: string;
}

export interface AccountServiceDependencies {
  readonly reads: AccountReadPort;
  readonly uow: AccountUnitOfWork;
  readonly accountId?: () => AccountId;
  readonly transactionId?: () => TransactionId;
  readonly auditId?: () => AuditEntryId;
  readonly clock?: () => string;
}

export class AccountService {
  private readonly dependencies: AccountServiceDependencies;

  constructor(dependencies: AccountServiceDependencies) {
    this.dependencies = dependencies;
  }

  async list(): Promise<readonly AccountListItem[]> {
    const [accounts, transactions] = await Promise.all([
      this.dependencies.reads.listAccounts(),
      this.dependencies.reads.listTransactions(),
    ]);
    const balances = deriveBalances(accounts, transactions);
    return accounts.map((account) => ({
      account, balance: balances.get(account.id)!,
    }));
  }

  async create(command: AccountDraft): Promise<Account> {
    const now = this.clock();
    const id = validatedId(this.accountId(), "accountId");
    const account: Account = {
      ...validateAccountDraft(command), id, status: "active",
      createdAt: now, updatedAt: now,
    };
    const opening = command.openingBalance === 0
      ? undefined
      : openingTransaction(
          account, command.openingBalance,
          validatedId(this.transactionId(), "transactionId"),
        );
    const accountAuditEntry = accountAudit(
      validatedId(this.auditId(), "auditId"), id, now, "account.created",
    );
    const openingAudit = opening
      ? transactionAudit(validatedId(this.auditId(), "auditId"), opening.id, now)
      : undefined;
    await this.dependencies.uow.createAccount({
      account, accountAudit: accountAuditEntry,
      ...(opening ? { openingTransaction: opening } : {}),
      ...(openingAudit ? { transactionAudit: openingAudit } : {}),
    });
    return account;
  }

  async update(command: UpdateAccountCommand): Promise<Account> {
    const id = validatedId(command.id as AccountId, "accountId");
    const accounts = await this.dependencies.reads.listAccounts();
    const previous = accounts.find((account) => account.id === id);
    if (!previous) throw new ValidationError("ACCOUNT_NOT_FOUND", "accountId");
    const core = validateAccountDraft({ ...command, openingBalance: 0 });
    const next: Account = {
      ...core, id, status: previous.status, createdAt: previous.createdAt,
      updatedAt: this.clock(),
    };
    await this.dependencies.uow.updateAccount(
      next,
      accountAudit(
        validatedId(this.auditId(), "auditId"), id, next.updatedAt,
        "account.updated",
      ),
    );
    return next;
  }

  async archive(value: string): Promise<void> {
    await this.setStatus(value, "archived");
  }

  async reactivate(value: string): Promise<void> {
    await this.setStatus(value, "active");
  }

  private async setStatus(
    value: string,
    status: Account["status"],
  ): Promise<void> {
    const id = validatedId(value as AccountId, "accountId");
    const [settings, accounts] = await Promise.all([
      this.dependencies.reads.getSettings(),
      this.dependencies.reads.listAccounts(),
    ]);
    const account = accounts.find((item) => item.id === id);
    if (!account) throw new ValidationError("ACCOUNT_NOT_FOUND", "accountId");
    const defaultAccountId = status === "archived" &&
        settings?.defaultAccountId === id
      ? accounts.find((item) => item.id !== id && item.status === "active")?.id
      : undefined;
    const now = this.clock();
    await this.dependencies.uow.setAccountStatus(
      id, status, defaultAccountId,
      accountAudit(
        validatedId(this.auditId(), "auditId"), id, now,
        status === "active" ? "account.reactivated" : "account.archived",
      ),
    );
  }

  private clock(): string {
    return (this.dependencies.clock ?? (() => new Date().toISOString()))();
  }
  private accountId(): AccountId {
    return (this.dependencies.accountId ?? (() => crypto.randomUUID() as AccountId))();
  }
  private transactionId(): TransactionId {
    return (this.dependencies.transactionId ?? (() => crypto.randomUUID() as TransactionId))();
  }
  private auditId(): AuditEntryId {
    return (this.dependencies.auditId ?? (() => crypto.randomUUID() as AuditEntryId))();
  }
}
