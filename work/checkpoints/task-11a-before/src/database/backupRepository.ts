import type { DbBackupPort, RestoreCounts } from "../application/ports";
import type { BackupEnvelope } from "../backup/schema";
import { validateBackupEnvelope } from "../backup/schema";
import type { MiroraTrackDatabase } from "./db";

export interface RestoreTransactionHooks {
  readonly afterClears?: () => void;
  readonly beforeCommit?: () => void;
}

export class DexieBackupRepository implements DbBackupPort {
  private readonly db: MiroraTrackDatabase;
  private readonly hooks: RestoreTransactionHooks;

  constructor(
    db: MiroraTrackDatabase,
    hooks: RestoreTransactionHooks = {},
  ) {
    this.db = db;
    this.hooks = hooks;
  }

  async snapshotAll(exportedAt: string): Promise<BackupEnvelope> {
    const data = await this.db.transaction(
      "r",
      [
        this.db.metadata,
        this.db.settings,
        this.db.accounts,
        this.db.transactions,
        this.db.budgets,
        this.db.auditEntries,
        this.db.backupMetadata,
        this.db.calculationCaches,
      ],
      async () => ({
        metadata: await this.db.metadata.toArray(),
        settings: await this.db.settings.toArray(),
        accounts: await this.db.accounts.toArray(),
        transactions: await this.db.transactions.toArray(),
        budgets: await this.db.budgets.toArray(),
        auditEntries: await this.db.auditEntries.toArray(),
        backupMetadata: await this.db.backupMetadata.toArray(),
        calculationCaches: await this.db.calculationCaches.toArray(),
      }),
    );

    return validateBackupEnvelope({
      app: "MiroraTrack",
      schemaVersion: 3,
      exportedAt,
      data,
    });
  }

  async replaceAllAtomic(envelope: BackupEnvelope): Promise<RestoreCounts> {
    const { data } = envelope;
    await this.db.transaction(
      "rw",
      [
        this.db.metadata,
        this.db.settings,
        this.db.accounts,
        this.db.transactions,
        this.db.budgets,
        this.db.auditEntries,
        this.db.backupMetadata,
        this.db.calculationCaches,
      ],
      async () => {
        await Promise.all([
          this.db.metadata.clear(),
          this.db.settings.clear(),
          this.db.accounts.clear(),
          this.db.transactions.clear(),
          this.db.budgets.clear(),
          this.db.auditEntries.clear(),
          this.db.backupMetadata.clear(),
          this.db.calculationCaches.clear(),
        ]);
        this.hooks.afterClears?.();

        await this.db.metadata.bulkAdd([...data.metadata]);
        await this.db.settings.bulkAdd([...data.settings]);
        await this.db.accounts.bulkAdd([...data.accounts]);
        await this.db.transactions.bulkAdd([...data.transactions]);
        await this.db.budgets.bulkAdd([...data.budgets]);
        await this.db.auditEntries.bulkAdd([...data.auditEntries]);
        await this.db.backupMetadata.bulkAdd([...data.backupMetadata]);
        await this.db.calculationCaches.clear();
        this.hooks.beforeCommit?.();
      },
    );

    return {
      metadata: data.metadata.length,
      settings: data.settings.length,
      accounts: data.accounts.length,
      transactions: data.transactions.length,
      budgets: data.budgets.length,
      auditEntries: data.auditEntries.length,
      backupMetadata: data.backupMetadata.length,
      calculationCaches: 0,
    };
  }
}
