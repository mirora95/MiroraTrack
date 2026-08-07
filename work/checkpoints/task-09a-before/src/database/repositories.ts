import type { Table } from "dexie";

import type {
  Account,
  AccountId,
  AppMetadata,
  AuditEntry,
  AuditEntryId,
  BackupMetadata,
  BackupMetadataId,
  Budget,
  BudgetId,
  CacheKey,
  CalculationCache,
  Settings,
  Transaction,
  TransactionId,
} from "../finance/types";
import type { MiroraTrackDatabase } from "./db";

export interface Repository<T, K> {
  get(key: K): Promise<T | undefined>;
  list(): Promise<T[]>;
  add(value: T): Promise<void>;
  put(value: T): Promise<void>;
  delete(key: K): Promise<void>;
}

export interface FinanceRepositories {
  readonly metadata: Repository<AppMetadata, "app">;
  readonly settings: Repository<Settings, "primary">;
  readonly accounts: Repository<Account, AccountId>;
  readonly transactions: Repository<Transaction, TransactionId>;
  readonly budgets: Repository<Budget, BudgetId>;
  readonly auditEntries: Repository<AuditEntry, AuditEntryId>;
  readonly backupMetadata: Repository<BackupMetadata, BackupMetadataId>;
  readonly calculationCaches: Repository<CalculationCache, CacheKey>;
}

function repository<T, K>(table: Table<T, K>): Repository<T, K> {
  return {
    get: (key) => table.get(key),
    list: () => table.toArray(),
    add: async (value) => {
      await table.add(value);
    },
    put: async (value) => {
      await table.put(value);
    },
    delete: async (key) => {
      await table.delete(key);
    },
  };
}

export function createRepositories(
  db: MiroraTrackDatabase,
): FinanceRepositories {
  return {
    metadata: repository(db.metadata),
    settings: repository(db.settings),
    accounts: repository(db.accounts as unknown as Table<Account, AccountId>),
    transactions: repository(
      db.transactions as unknown as Table<Transaction, TransactionId>,
    ),
    budgets: repository(db.budgets as unknown as Table<Budget, BudgetId>),
    auditEntries: repository(
      db.auditEntries as unknown as Table<AuditEntry, AuditEntryId>,
    ),
    backupMetadata: repository(
      db.backupMetadata as unknown as Table<BackupMetadata, BackupMetadataId>,
    ),
    calculationCaches: repository(
      db.calculationCaches as unknown as Table<CalculationCache, CacheKey>,
    ),
  };
}
