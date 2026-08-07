import type {
  Account,
  AccountId,
  AppMetadata,
  AuditEntry,
  Budget,
  CacheKey,
  CalculationCache,
  Transaction,
  TransactionId,
} from "../finance/types";
import type { BackupEnvelopeV1 } from "../backup/schema";

export interface FinanceReadPort {
  getAccount(id: AccountId): Promise<Account | undefined>;
  getTransaction(id: TransactionId): Promise<Transaction | undefined>;
}

export interface DashboardReadPort {
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
    previousId: TransactionId,
    next: Transaction,
    audit: AuditEntry,
  ): Promise<void>;
  deleteTransaction(id: TransactionId, audit: AuditEntry): Promise<void>;
}

export type BackupPayload = BackupEnvelopeV1;

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
  readonly [Collection in keyof BackupEnvelopeV1["data"]]: number;
};

export interface DbBackupPort {
  snapshotAll(exportedAt: string): Promise<BackupEnvelopeV1>;
  replaceAllAtomic(envelope: BackupEnvelopeV1): Promise<RestoreCounts>;
}
