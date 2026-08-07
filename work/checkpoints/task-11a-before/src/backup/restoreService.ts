import type {
  BackupPort,
  DbBackupPort,
  RestoreCounts,
} from "../application/ports";
import { migrateBackupEnvelope, parseBackupEnvelope } from "./schema";

export interface RestoreServiceHooks {
  readonly beforeSafety?: () => void;
  readonly afterSafetyBeforeDb?: () => void;
}

export class RestoreService {
  private readonly database: DbBackupPort;
  private readonly backups: Pick<BackupPort, "createSafetyBackup">;
  private readonly clock: () => string;
  private readonly hooks: RestoreServiceHooks;

  constructor(
    database: DbBackupPort,
    backups: Pick<BackupPort, "createSafetyBackup">,
    clock: () => string = () => new Date().toISOString(),
    hooks: RestoreServiceHooks = {},
  ) {
    this.database = database;
    this.backups = backups;
    this.clock = clock;
    this.hooks = hooks;
  }

  async restore(imported: unknown): Promise<RestoreCounts> {
    const current = await this.database.snapshotAll(this.clock());
    this.hooks.beforeSafety?.();
    const safety = await this.backups.createSafetyBackup(current);
    if (!safety.success) {
      throw new Error(`Safety backup failed: ${safety.errorCode}`);
    }
    this.hooks.afterSafetyBeforeDb?.();

    const validated = migrateBackupEnvelope(parseBackupEnvelope(imported));
    return this.database.replaceAllAtomic(validated);
  }
}
