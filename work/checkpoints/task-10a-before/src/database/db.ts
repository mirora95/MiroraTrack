import Dexie, { type Table } from "dexie";

import type {
  Account,
  AppMetadata,
  AuditEntry,
  BackupMetadata,
  Budget,
  CalculationCache,
  Settings,
  Transaction,
} from "../finance/types";
import {
  migrateV1ToV2,
  migrateV2ToV3,
  type MigrationContext,
  type MigrationStage,
} from "./migrations";
import { V1_STORES, V2_STORES, V3_STORES } from "./schema";

export const DATABASE_VERSION = 3;
export const CALCULATION_VERSION = 1;
export const APP_METADATA_KEY = "app" as const;

type Clock = () => string;

export interface OpenDatabaseOptions {
  readonly name?: string;
  readonly clock?: Clock;
  readonly beforeSchemaVersionCommit?: MigrationContext["beforeSchemaVersionCommit"];
  readonly onMigrationStage?: (stage: MigrationStage) => void | Promise<void>;
}

export type OpenDatabaseResult =
  | { readonly status: "ready"; readonly db: MiroraTrackDatabase }
  | {
      readonly status: "read-only-recovery";
      readonly reason: "physical-version-newer";
      readonly databaseVersion: number;
    }
  | {
      readonly status: "read-only-recovery";
      readonly reason: "schema-version-newer";
      readonly schemaVersion: number;
    }
  | {
      readonly status: "read-only-recovery";
      readonly reason: "migration-failed";
    };

export class MiroraTrackDatabase extends Dexie {
  readonly metadata!: Table<AppMetadata, "app">;
  readonly settings!: Table<Settings, "primary">;
  readonly accounts!: Table<Account, string>;
  readonly transactions!: Table<Transaction, string>;
  readonly budgets!: Table<Budget, string>;
  readonly auditEntries!: Table<AuditEntry, string>;
  readonly backupMetadata!: Table<BackupMetadata, string>;
  readonly calculationCaches!: Table<CalculationCache, string>;

  constructor(
    name = "MiroraTrack",
    clock: Clock = () => new Date().toISOString(),
    migrationContext: Omit<MigrationContext, "clock"> = {},
  ) {
    super(name);

    this.version(1).stores(V1_STORES);
    this.version(2)
      .stores(V2_STORES)
      .upgrade((transaction) =>
        migrateV1ToV2(transaction, { clock, ...migrationContext }),
      );
    this.version(DATABASE_VERSION)
      .stores(V3_STORES)
      .upgrade((transaction) =>
        migrateV2ToV3(transaction, { clock, ...migrationContext }),
      );

    this.on("populate", (transaction) => {
      const timestamp = clock();
      return transaction.table("metadata").add({
        key: APP_METADATA_KEY,
        schemaVersion: DATABASE_VERSION,
        calculationVersion: CALCULATION_VERSION,
        ledgerRevision: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  }
}

interface NativePreflight {
  readonly databaseVersion: number;
  readonly schemaVersion?: number;
}

async function nativePreflight(
  name: string,
): Promise<NativePreflight | undefined> {
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === name)) return undefined;

  return new Promise<NativePreflight>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const connection = request.result;
      const databaseVersion = connection.version / 10;
      if (!connection.objectStoreNames.contains("metadata")) {
        connection.close();
        resolve({ databaseVersion });
        return;
      }

      const transaction = connection.transaction("metadata", "readonly");
      const metadataRequest = transaction.objectStore("metadata").get(
        APP_METADATA_KEY,
      );
      const fail = (error: DOMException | null) => {
        connection.close();
        reject(error);
      };
      metadataRequest.onerror = () => fail(metadataRequest.error);
      transaction.onabort = () => fail(transaction.error);
      transaction.onerror = () => fail(transaction.error);
      transaction.oncomplete = () => {
        const metadata = metadataRequest.result as
          | { readonly schemaVersion?: unknown }
          | undefined;
        connection.close();
        resolve({
          databaseVersion,
          ...(typeof metadata?.schemaVersion === "number"
            ? { schemaVersion: metadata.schemaVersion }
            : {}),
        });
      };
    };
  });
}

export async function openMiroraTrackDatabase(
  options: OpenDatabaseOptions = {},
): Promise<OpenDatabaseResult> {
  const name = options.name ?? "MiroraTrack";
  const preflight = await nativePreflight(name);
  if (preflight && preflight.databaseVersion > DATABASE_VERSION) {
    return {
      status: "read-only-recovery",
      reason: "physical-version-newer",
      databaseVersion: preflight.databaseVersion,
    };
  }
  if (preflight?.schemaVersion && preflight.schemaVersion > DATABASE_VERSION) {
    return {
      status: "read-only-recovery",
      reason: "schema-version-newer",
      schemaVersion: preflight.schemaVersion,
    };
  }

  const migrationContext = {
    ...(options.beforeSchemaVersionCommit
      ? { beforeSchemaVersionCommit: options.beforeSchemaVersionCommit }
      : {}),
    ...(options.onMigrationStage
      ? { onMigrationStage: options.onMigrationStage }
      : {}),
  };
  const db = new MiroraTrackDatabase(name, options.clock, migrationContext);
  try {
    await db.open();
  } catch {
    db.close();
    return { status: "read-only-recovery", reason: "migration-failed" };
  }

  const metadata = await db.metadata.get(APP_METADATA_KEY);
  if (metadata && metadata.schemaVersion > DATABASE_VERSION) {
    db.close();
    return {
      status: "read-only-recovery",
      reason: "schema-version-newer",
      schemaVersion: metadata.schemaVersion,
    };
  }

  return { status: "ready", db };
}
