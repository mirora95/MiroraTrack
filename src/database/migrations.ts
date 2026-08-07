import type { Transaction as DexieTransaction } from "dexie";

import { categoryFor } from "../application/transactionCategories";
import { BACKUP_ERROR_CODES } from "../application/ports";
import { isSupportedCurrency } from "../finance/money";
import type {
  Account,
  AccountColor,
  AccountIcon,
  AppMetadata,
  AuditEntry,
  BackupMetadata,
  Budget,
  Transaction,
  Settings,
} from "../finance/types";

export interface MigrationContext {
  readonly clock: () => string;
  readonly beforeSchemaVersionCommit?: () => void | Promise<void>;
  readonly onMigrationStage?: (stage: MigrationStage) => void | Promise<void>;
}

export type MigrationStage =
  | "afterSettings"
  | "afterBudgets"
  | "afterAccounts"
  | "afterTransactions"
  | "afterAudits"
  | "afterMetadata"
  | "afterCacheClear"
  | "beforeCommit";

export async function migrateV4ToV5(
  transaction: DexieTransaction,
  context: MigrationContext,
): Promise<void> {
  const settings = transaction.table<Mutable<Settings>, "primary">("settings");
  await settings.toCollection().modify((record) => {
    let locale: string;
    try {
      locale = Intl.getCanonicalLocales(record.locale)[0] ?? "";
    } catch {
      throw new Error("Legacy settings locale is invalid");
    }
    if (
      locale.length === 0 ||
      !["yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy"].includes(record.dateFormat) ||
      typeof record.automaticBackupsEnabled !== "boolean" ||
      !isSupportedCurrency(record.baseCurrency) ||
      (record.automaticBackupIntervalHours !== undefined &&
        ![6, 12, 24, 168].includes(record.automaticBackupIntervalHours))
    ) {
      throw new Error("Legacy settings are invalid");
    }
    record.locale = locale;
    if (record.automaticBackupIntervalHours === undefined) {
      record.automaticBackupIntervalHours = 24;
    }
  });
  await context.onMigrationStage?.("afterSettings");
  const metadata = transaction.table<AppMetadata, "app">("metadata");
  const existing = await metadata.get("app");
  if (
    !existing ||
    existing.schemaVersion !== 4 ||
    existing.calculationVersion !== 2 ||
    !Number.isSafeInteger(existing.ledgerRevision) ||
    existing.ledgerRevision < 0 ||
    existing.ledgerRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("App metadata is invalid");
  }
  await metadata.put({
    ...existing,
    schemaVersion: 5,
    updatedAt: context.clock(),
  });
  const backups =
    transaction.table<Mutable<BackupMetadata>, string>("backupMetadata");
  await backups.toCollection().modify((record) => {
    if (
      record.schemaVersion !== 4 ||
      typeof record.id !== "string" ||
      record.id.length === 0
    ) {
      throw new Error("Legacy backup metadata is invalid");
    }
    if (record.status === "failed") {
      if (
        typeof record.errorCode !== "string" ||
        !(BACKUP_ERROR_CODES as readonly string[]).includes(record.errorCode) ||
        record.errorCode === "RETENTION_WARNING"
      ) {
        throw new Error("Legacy backup failure metadata is invalid");
      }
      if (
        record.errorMessage !== undefined &&
        typeof record.errorMessage !== "string"
      ) {
        throw new Error("Legacy backup failure message is invalid");
      }
    } else if (record.status === "idle" || record.status === "success") {
      delete record.errorCode;
      delete record.errorMessage;
    } else {
      throw new Error("Legacy backup status is invalid");
    }
    record.schemaVersion = 5;
    delete record.warningCode;
    delete record.warningMessage;
  });
  await context.onMigrationStage?.("afterMetadata");
  await transaction.table("calculationCaches").clear();
  await context.onMigrationStage?.("afterCacheClear");
  await context.onMigrationStage?.("beforeCommit");
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

export async function migrateV1ToV2(
  transaction: DexieTransaction,
  context: MigrationContext,
): Promise<void> {
  const settings =
    transaction.table<Mutable<Settings>, "primary">("settings");
  await settings.toCollection().modify((record) => {
    if (record.automaticBackupsEnabled === undefined) {
      record.automaticBackupsEnabled = true;
    }
  });

  const budgets = transaction.table<Mutable<Budget>, string>("budgets");
  await budgets.toCollection().modify((record) => {
    if (record.rollover === undefined) record.rollover = false;
  });

  const backups =
    transaction.table<Mutable<BackupMetadata>, string>("backupMetadata");
  await backups.toCollection().modify((record) => {
    if (record.schemaVersion === undefined) record.schemaVersion = 2;
  });

  await transaction.table("calculationCaches").clear();

  const metadata = transaction.table<AppMetadata, "app">("metadata");
  const existing = await metadata.get("app");
  if (existing) {
    await context.beforeSchemaVersionCommit?.();
    await metadata.put({
      ...existing,
      calculationVersion: existing.calculationVersion ?? 1,
      ledgerRevision: existing.ledgerRevision ?? 0,
      updatedAt: context.clock(),
      schemaVersion: 2,
    });
  }
}

const visuals: Record<Account["type"], {
  readonly color: AccountColor;
  readonly icon: AccountIcon;
}> = {
  cash: { color: "green", icon: "banknote" },
  checking: { color: "blue", icon: "landmark" },
  savings: { color: "gold", icon: "piggy-bank" },
  credit: { color: "slate", icon: "credit-card" },
  investment: { color: "purple", icon: "chart-line" },
  other: { color: "teal", icon: "wallet" },
};

interface LegacyAccount extends Omit<Account, "color" | "icon"> {
  openingBalance?: number;
}

export async function migrateV2ToV3(
  transaction: DexieTransaction,
  context: MigrationContext,
): Promise<void> {
  const accounts = transaction.table<LegacyAccount, string>("accounts");
  const transactions = transaction.table<Transaction, string>("transactions");
  const audits = transaction.table<AuditEntry, string>("auditEntries");
  const legacyAccounts = await accounts.toArray();
  const opening = legacyAccounts.filter(({ openingBalance }) =>
    openingBalance !== undefined && openingBalance !== 0);

  for (const account of opening) {
    const transactionId = `opening-balance:${account.id}`;
    const auditId = `audit:opening-balance:${account.id}`;
    if (
      await transactions.get(transactionId) !== undefined ||
      await audits.get(auditId) !== undefined
    ) {
      throw new Error("Generated opening-balance identifier collision");
    }
    if (
      !Number.isSafeInteger(account.openingBalance) ||
      account.openingBalance === undefined
    ) {
      throw new Error("Legacy opening balance is invalid");
    }
  }

  await accounts.toCollection().modify((record) => {
    const visual = visuals[record.type];
    (record as LegacyAccount & { color: AccountColor }).color = visual.color;
    (record as LegacyAccount & { icon: AccountIcon }).icon = visual.icon;
    if (record.type === "credit") {
      (record as LegacyAccount & { creditLimit: Account["creditLimit"] })
        .creditLimit = 0 as never;
    }
    delete record.openingBalance;
  });
  await context.onMigrationStage?.("afterAccounts");

  await transactions.toCollection().modify((record) => {
    if (record.purpose === undefined) {
      (record as Mutable<Transaction>).purpose = "standard";
    }
  });
  for (const account of opening) {
    const amount = Math.abs(account.openingBalance!);
    const shared = {
      id: `opening-balance:${account.id}`,
      status: "completed" as const,
      purpose: "opening-balance" as const,
      amount,
      currency: account.currency,
      effectiveAt: account.createdAt,
      categoryId: "system:opening-balance",
      createdAt: account.createdAt,
      updatedAt: account.createdAt,
    };
    await transactions.add((account.openingBalance! > 0
      ? { ...shared, type: "income", destinationAccountId: account.id }
      : { ...shared, type: "expense", sourceAccountId: account.id }) as Transaction);
  }
  await context.onMigrationStage?.("afterTransactions");

  for (const account of opening) {
    await audits.add({
      id: `audit:opening-balance:${account.id}` as AuditEntry["id"],
      timestamp: account.createdAt,
      action: "transaction.created",
      entityType: "transaction",
      entityId: `opening-balance:${account.id}` as Transaction["id"],
      description: "Opening balance migrated",
    });
  }
  await context.onMigrationStage?.("afterAudits");

  const metadata = transaction.table<AppMetadata, "app">("metadata");
  const existing = await metadata.get("app");
  if (!existing || existing.ledgerRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error("App metadata is invalid");
  }
  await metadata.put({
    ...existing,
    schemaVersion: 3,
    ledgerRevision: existing.ledgerRevision + 1,
    updatedAt: context.clock(),
  });
  const backups =
    transaction.table<Mutable<BackupMetadata>, string>("backupMetadata");
  await backups.toCollection().modify((record) => {
    record.schemaVersion = 3;
  });
  await context.onMigrationStage?.("afterMetadata");

  await transaction.table("calculationCaches").clear();
  await context.onMigrationStage?.("afterCacheClear");
  await context.onMigrationStage?.("beforeCommit");
}

export async function migrateV3ToV4(
  transaction: DexieTransaction,
  context: MigrationContext,
): Promise<void> {
  const budgets = transaction.table<Mutable<Budget>, string>("budgets");
  const scopes = new Set<string>();
  for (const budget of await budgets.toArray()) {
    if (
      !categoryFor(budget.categoryId, "expense") ||
      !isSupportedCurrency(budget.currency) ||
      !Number.isSafeInteger(budget.amount) ||
      budget.amount <= 0 ||
      !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(budget.month)
    ) {
      throw new Error("Legacy budget is invalid");
    }
    const scope =
      `${budget.month}\u0000${budget.categoryId}\u0000${budget.currency}`;
    if (scopes.has(scope)) {
      throw new Error("Legacy budgets have duplicate active scope");
    }
    scopes.add(scope);
  }
  await budgets.toCollection().modify((record) => {
    if (record.status === undefined) record.status = "active";
    record.rollover = false;
  });
  await context.onMigrationStage?.("afterBudgets");

  const metadata = transaction.table<AppMetadata, "app">("metadata");
  const existing = await metadata.get("app");
  if (
    !existing ||
    !Number.isSafeInteger(existing.ledgerRevision) ||
    existing.ledgerRevision < 0 ||
    existing.ledgerRevision === Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("App metadata is invalid");
  }
  await metadata.put({
    ...existing,
    schemaVersion: 4,
    calculationVersion: 2,
    ledgerRevision: existing.ledgerRevision + 1,
    updatedAt: context.clock(),
  });
  const backups =
    transaction.table<Mutable<BackupMetadata>, string>("backupMetadata");
  await backups.toCollection().modify((record) => {
    record.schemaVersion = 4;
  });
  await context.onMigrationStage?.("afterMetadata");

  await transaction.table("calculationCaches").clear();
  await context.onMigrationStage?.("afterCacheClear");
  await context.onMigrationStage?.("beforeCommit");
}
