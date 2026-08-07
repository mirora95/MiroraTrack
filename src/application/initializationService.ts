import type {
  AccountUnitOfWork,
  InitializationReadPort,
} from "./ports";
import {
  accountAudit,
  type AccountDraft,
  openingTransaction,
  transactionAudit,
  validateAccountDraft,
  validatedId,
} from "./accountRecords";
import { currencyCode } from "../finance/money";
import type {
  AccountId,
  AuditEntryId,
  Settings,
  TransactionId,
} from "../finance/types";
import { ValidationError } from "./validation";

export type InitializationState =
  | { readonly status: "uninitialized" }
  | { readonly status: "ready" }
  | { readonly status: "recovery-required"; readonly reason: string };

export interface InitializeCommand {
  readonly baseCurrency: string;
  readonly locale: string;
  readonly dateFormat: string;
  readonly account: AccountDraft;
}

export interface InitializationServiceDependencies {
  readonly reads: InitializationReadPort;
  readonly uow: AccountUnitOfWork;
  readonly accountId?: () => AccountId;
  readonly transactionId?: () => TransactionId;
  readonly auditId?: () => AuditEntryId;
  readonly clock?: () => string;
}

export class InitializationService {
  private readonly dependencies: InitializationServiceDependencies;

  constructor(dependencies: InitializationServiceDependencies) {
    this.dependencies = dependencies;
  }

  async getState(): Promise<InitializationState> {
    const [settings, accounts] = await Promise.all([
      this.dependencies.reads.getSettings(),
      this.dependencies.reads.listAccounts(),
    ]);
    if (!settings && accounts.length === 0) return { status: "uninitialized" };
    if (!settings || accounts.length === 0) {
      return { status: "recovery-required", reason: "partial-initialization" };
    }
    try {
      if (
        settings.key !== "primary" ||
        !settings.locale?.trim() ||
        !settings.dateFormat?.trim() ||
        typeof settings.automaticBackupsEnabled !== "boolean" ||
        ![6, 12, 24, 168].includes(settings.automaticBackupIntervalHours)
      ) {
        throw new Error("Invalid settings");
      }
      currencyCode(settings.baseCurrency);
      const ids = new Set<string>();
      for (const account of accounts) {
        if (
          !account.id ||
          ids.has(account.id) ||
          !["active", "archived"].includes(account.status)
        ) {
          throw new Error("Invalid account");
        }
        ids.add(account.id);
        validateAccountDraft({
          name: account.name,
          type: account.type,
          currency: account.currency,
          color: account.color,
          icon: account.icon,
          ...(account.creditLimit === undefined
            ? {}
            : { creditLimit: account.creditLimit }),
          openingBalance: 0,
        });
      }
    } catch {
      return { status: "recovery-required", reason: "invalid-records" };
    }
    if (
      settings.defaultAccountId !== undefined &&
      !accounts.some(({ id }) => id === settings.defaultAccountId)
    ) {
      return { status: "recovery-required", reason: "broken-default-account" };
    }
    return { status: "ready" };
  }

  async initialize(command: InitializeCommand): Promise<void> {
    if ((await this.getState()).status !== "uninitialized") {
      throw new ValidationError("INITIALIZATION_STATE_INVALID", "initialization");
    }
    const now = (this.dependencies.clock ?? (() => new Date().toISOString()))();
    const locale = command.locale.trim();
    const dateFormat = command.dateFormat.trim();
    if (!locale) throw new ValidationError("REQUIRED", "locale");
    if (!dateFormat) throw new ValidationError("REQUIRED", "dateFormat");
    const accountId = validatedId(
      (this.dependencies.accountId ?? (() => crypto.randomUUID() as AccountId))(),
      "accountId",
    );
    const core = validateAccountDraft(command.account);
    let baseCurrency;
    try {
      baseCurrency = currencyCode(command.baseCurrency);
    } catch {
      throw new ValidationError("INVALID_CURRENCY", "baseCurrency");
    }
    const account = {
      ...core, id: accountId, status: "active" as const,
      createdAt: now, updatedAt: now,
    };
    const opening = command.account.openingBalance === 0
      ? undefined
      : openingTransaction(
          account,
          command.account.openingBalance,
          validatedId(
            (this.dependencies.transactionId ??
              (() => crypto.randomUUID() as TransactionId))(),
            "transactionId",
          ),
        );
    const nextAudit = this.dependencies.auditId ?? (() => crypto.randomUUID() as AuditEntryId);
    const accountAuditEntry = accountAudit(
      validatedId(nextAudit(), "auditId"), accountId, now, "account.created",
    );
    const openingAudit = opening
      ? transactionAudit(validatedId(nextAudit(), "auditId"), opening.id, now)
      : undefined;
    const settings: Settings = {
      key: "primary", baseCurrency,
      locale, dateFormat,
      defaultAccountId: accountId, automaticBackupsEnabled: true,
      automaticBackupIntervalHours: 24,
    };
    await this.dependencies.uow.initialize({
      settings, account, accountAudit: accountAuditEntry,
      ...(opening ? { openingTransaction: opening } : {}),
      ...(openingAudit ? { transactionAudit: openingAudit } : {}),
    });
  }
}
