import type {
  Account,
  AccountId,
  AppMetadata,
  AuditEntry,
  Budget,
  BudgetId,
  CacheKey,
  CalculationCache,
  Transaction,
  TransactionId,
  Settings,
} from "../finance/types";
import type { BackupEnvelope } from "../backup/schema";

export interface FinanceReadPort {
  getAccount(id: AccountId): Promise<Account | undefined>;
  getTransaction(id: TransactionId): Promise<Transaction | undefined>;
}

export interface InitializationReadPort {
  getSettings(): Promise<Settings | undefined>;
  listAccounts(): Promise<readonly Account[]>;
}

export interface AccountReadPort extends InitializationReadPort {
  listTransactions(): Promise<readonly Transaction[]>;
}

export interface AccountWriteRecords {
  readonly account: Account;
  readonly openingTransaction?: Transaction;
  readonly accountAudit: AuditEntry;
  readonly transactionAudit?: AuditEntry;
}

export interface InitializationWriteRecords extends AccountWriteRecords {
  readonly settings: Settings;
}

export interface AccountUnitOfWork {
  initialize(records: InitializationWriteRecords): Promise<void>;
  createAccount(records: AccountWriteRecords): Promise<void>;
  updateAccount(account: Account, audit: AuditEntry): Promise<void>;
  setAccountStatus(
    id: AccountId,
    status: Account["status"],
    defaultAccountId: AccountId | undefined,
    audit: AuditEntry,
  ): Promise<void>;
}

export interface DashboardReadPort {
  getSettings(): Promise<Settings | undefined>;
  listAccounts(): Promise<readonly Account[]>;
  listTransactions(): Promise<readonly Transaction[]>;
  listBudgets(): Promise<readonly Budget[]>;
  getMetadata(): Promise<AppMetadata | undefined>;
  getCalculationCache(key: CacheKey): Promise<CalculationCache | undefined>;
  putCalculationCache(cache: CalculationCache): Promise<void>;
}

export interface FinanceUnitOfWork {
  createTransaction(
    transaction: Transaction,
    audit: AuditEntry,
  ): Promise<void>;
  replaceTransaction(
    expected: Transaction,
    next: Transaction,
    audit: AuditEntry,
  ): Promise<void>;
  deleteTransaction(expected: Transaction, audit: AuditEntry): Promise<void>;
}

export interface BudgetUnitOfWork {
  createBudget(budget: Budget, audit: AuditEntry): Promise<void>;
  replaceBudget(
    expected: Budget,
    next: Budget,
    audit: AuditEntry,
  ): Promise<void>;
  setBudgetStatus(
    expected: Budget,
    next: Budget,
    audit: AuditEntry,
  ): Promise<void>;
  deleteBudget(expected: Budget, audit: AuditEntry): Promise<void>;
}

export interface BudgetReadPort {
  getSettings(): Promise<Settings | undefined>;
  getBudget(id: BudgetId): Promise<Budget | undefined>;
  listBudgets(): Promise<readonly Budget[]>;
  listTransactions(): Promise<readonly Transaction[]>;
  listAccounts(): Promise<readonly Account[]>;
}

export interface TransactionReadPort {
  listTransactions(): Promise<readonly Transaction[]>;
  listAccounts(): Promise<readonly Account[]>;
}

export interface ActivityReadPort {
  listAuditEntries(): Promise<readonly AuditEntry[]>;
}

export interface SettingsSnapshot {
  readonly settings: Settings;
  readonly revision: number;
}

export interface SettingsReadPort {
  getSettingsSnapshot(): Promise<SettingsSnapshot>;
}

export interface SettingsUnitOfWork {
  replaceSettings(
    expected: Settings,
    next: Settings,
    expectedRevision: number,
  ): Promise<void>;
}

export type BackupPayload = BackupEnvelope;

export const BACKUP_ERROR_CODES = [
  "DOCUMENTS_UNAVAILABLE",
  "DIRECTORY_UNAVAILABLE",
  "PERMISSION_DENIED",
  "INVALID_PATH",
  "TARGET_EXISTS",
  "FILE_TOO_LARGE",
  "READ_FAILED",
  "WRITE_FAILED",
  "SYNC_FAILED",
  "PROMOTION_FAILED",
  "DIALOG_FAILED",
  "RETENTION_WARNING",
  "UNKNOWN",
] as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

export interface BackupWarning {
  readonly code: "RETENTION_WARNING";
  readonly message?: string;
}

export type BackupResult =
  | {
      readonly success: true;
      readonly path: string;
      readonly directory: string;
      readonly warning?: BackupWarning;
    }
  | {
      readonly success: false;
      readonly errorCode: BackupErrorCode;
      readonly message?: string;
    };

export interface BackupPort {
  createAutomaticBackup(
    payload: BackupPayload,
    configuredDirectory?: string,
  ): Promise<BackupResult>;
  createSafetyBackup(
    payload: BackupPayload,
    configuredDirectory?: string,
  ): Promise<BackupResult>;
  chooseBackupFolder(): Promise<string | null>;
  exportJson(payload: BackupPayload): Promise<BackupResult | null>;
  exportCsv(csv: string): Promise<BackupResult | null>;
  importJson(): Promise<unknown | null>;
}

export type RestoreCounts = {
  readonly [Collection in keyof BackupEnvelope["data"]]: number;
};

export interface DbBackupPort {
  snapshotAll(exportedAt: string): Promise<BackupEnvelope>;
  replaceAllAtomic(envelope: BackupEnvelope): Promise<RestoreCounts>;
}
