declare const accountIdBrand: unique symbol;
declare const transactionIdBrand: unique symbol;
declare const budgetIdBrand: unique symbol;
declare const auditEntryIdBrand: unique symbol;
declare const categoryIdBrand: unique symbol;
declare const backupMetadataIdBrand: unique symbol;
declare const cacheKeyBrand: unique symbol;
declare const currencyCodeBrand: unique symbol;
declare const minorAmountBrand: unique symbol;

export type AccountId = string & { readonly [accountIdBrand]: true };
export type TransactionId = string & { readonly [transactionIdBrand]: true };
export type BudgetId = string & { readonly [budgetIdBrand]: true };
export type AuditEntryId = string & { readonly [auditEntryIdBrand]: true };
export type CategoryId = string & { readonly [categoryIdBrand]: true };
export type BackupMetadataId = string & {
  readonly [backupMetadataIdBrand]: true;
};
export type CacheKey = string & { readonly [cacheKeyBrand]: true };
export type CurrencyCode = string & { readonly [currencyCodeBrand]: true };
export type MinorAmount = number & { readonly [minorAmountBrand]: true };
export type BudgetMonth =
  `${number}-${"01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"}`;

export const AUTOMATIC_BACKUP_METADATA_ID =
  "automatic" as BackupMetadataId;

export function minorAmount(value: number): MinorAmount {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Minor amount must be a safe integer");
  }
  return value as MinorAmount;
}

export type AccountType =
  | "cash"
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "other";

export type AccountColor =
  | "blue"
  | "teal"
  | "gold"
  | "purple"
  | "green"
  | "slate";

export type AccountIcon =
  | "banknote"
  | "landmark"
  | "piggy-bank"
  | "credit-card"
  | "chart-line"
  | "wallet";

export interface Account {
  readonly id: AccountId;
  readonly name: string;
  readonly type: AccountType;
  readonly status: "active" | "archived";
  readonly currency: CurrencyCode;
  readonly color: AccountColor;
  readonly icon: AccountIcon;
  readonly creditLimit?: MinorAmount;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TransactionPurpose = "standard" | "opening-balance";

interface TransactionShared {
  readonly id: TransactionId;
  readonly status: "completed" | "planned" | "cancelled";
  readonly purpose: TransactionPurpose;
  readonly amount: MinorAmount;
  readonly currency: CurrencyCode;
  readonly effectiveAt: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IncomeTransaction extends TransactionShared {
  readonly type: "income";
  readonly destinationAccountId: AccountId;
  readonly categoryId: CategoryId;
  readonly sourceAccountId?: never;
}

export interface ExpenseTransaction extends TransactionShared {
  readonly type: "expense";
  readonly sourceAccountId: AccountId;
  readonly categoryId: CategoryId;
  readonly destinationAccountId?: never;
}

export interface TransferTransaction extends TransactionShared {
  readonly type: "transfer";
  readonly sourceAccountId: AccountId;
  readonly destinationAccountId: AccountId;
  readonly categoryId?: never;
}

export type Transaction =
  | IncomeTransaction
  | ExpenseTransaction
  | TransferTransaction;

export interface Budget {
  readonly id: BudgetId;
  readonly name: string;
  readonly categoryId: CategoryId;
  readonly currency: CurrencyCode;
  readonly amount: MinorAmount;
  readonly month: BudgetMonth;
  readonly rollover: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface AuditEntryShared {
  readonly id: AuditEntryId;
  readonly timestamp: string;
  readonly description: string;
}

export interface TransactionAuditEntry extends AuditEntryShared {
  readonly action:
    | "transaction.created"
    | "transaction.updated"
    | "transaction.deleted";
  readonly entityType: "transaction";
  readonly entityId: TransactionId;
}

export interface AccountAuditEntry extends AuditEntryShared {
  readonly action:
    | "account.created"
    | "account.updated"
    | "account.archived"
    | "account.reactivated";
  readonly entityType: "account";
  readonly entityId: AccountId;
}

export interface SettingsAuditEntry extends AuditEntryShared {
  readonly action: "settings.initialized";
  readonly entityType: "settings";
  readonly entityId: "primary";
}

export type AuditEntry =
  | TransactionAuditEntry
  | AccountAuditEntry
  | SettingsAuditEntry;

export interface Settings {
  readonly key: "primary";
  readonly baseCurrency: CurrencyCode;
  readonly locale: string;
  readonly dateFormat: string;
  readonly defaultAccountId?: AccountId;
  readonly backupFolderPath?: string;
  readonly automaticBackupsEnabled: boolean;
}

export interface WindowPreferences {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
}

export interface UiPreferences {
  readonly theme: "system" | "light" | "dark";
  readonly density: "compact" | "comfortable";
  readonly sidebarCollapsed: boolean;
  readonly selectedDisplayCurrency: CurrencyCode;
  readonly window: WindowPreferences;
}

export interface BackupMetadata {
  readonly id: BackupMetadataId;
  readonly folderPath?: string;
  readonly lastAttemptAt?: string;
  readonly lastSuccessfulAt?: string;
  readonly status: "idle" | "success" | "failed";
  readonly schemaVersion: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface AppMetadata {
  readonly key: "app";
  readonly schemaVersion: number;
  readonly calculationVersion: number;
  readonly ledgerRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CalculationCache {
  readonly key: CacheKey;
  readonly calculationVersion: number;
  readonly sourceRevision: number;
  readonly value: unknown;
  readonly updatedAt: string;
}
