import type { Transaction as DexieTransaction } from "dexie";

import type {
  AppMetadata,
  BackupMetadata,
  Budget,
  Settings,
} from "../finance/types";

export interface MigrationContext {
  readonly clock: () => string;
  readonly beforeSchemaVersionCommit?: () => void | Promise<void>;
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
