import type {
  BackupPort,
  BackupErrorCode,
  BackupResult,
  DbBackupPort,
  RestoreCounts,
  TransactionReadPort,
} from "./ports";
import { BACKUP_ERROR_CODES } from "./ports";
import type { SettingsService } from "./settingsService";
import {
  migrateBackupEnvelope,
  parseBackupEnvelope,
  type BackupEnvelope,
} from "../backup/schema";
import {
  deserializeBackupEnvelope,
  serializeBackupEnvelope,
} from "../backup/serialize";
import type { RestoreService } from "../backup/restoreService";
import { serializeTransactionsCsv } from "../export/csv";

export type DataManagementErrorCode =
  | "RESTORE_CONFIRMATION_REQUIRED"
  | "RESTORE_CANDIDATE_MISSING";

export class DataManagementError extends Error {
  readonly code: DataManagementErrorCode;
  constructor(code: DataManagementErrorCode) {
    super(code);
    this.name = "DataManagementError";
    this.code = code;
  }
}

export interface RestorePreview {
  readonly candidateId: string;
  readonly exportedAt: string;
  readonly schemaVersion: number;
  readonly counts: RestoreCounts;
}

export const DEFAULT_BACKUP_FOLDER_LABEL =
  "Documents\\MiroraTrack\\Backups";

export type DataFileResult =
  | {
      readonly status: "success";
      readonly path: string;
      readonly directory: string;
      readonly warning?: { readonly code: "RETENTION_WARNING"; readonly message?: string };
    }
  | { readonly status: "cancelled" }
  | {
      readonly status: "failed";
      readonly errorCode: BackupErrorCode;
      readonly message: string;
    };

export interface DataManagementDependencies {
  readonly database: Pick<DbBackupPort, "snapshotAll">;
  readonly backups: Pick<
    BackupPort,
    "exportJson" | "exportCsv" | "importJson" | "chooseBackupFolder"
  >;
  readonly restore: Pick<RestoreService, "restore">;
  readonly transactions: TransactionReadPort;
  readonly settings: Pick<SettingsService, "get" | "update">;
  readonly clock?: () => string;
}

export class DataManagementService {
  private readonly dependencies: DataManagementDependencies;
  private candidate:
    | { readonly id: string; readonly canonical: string }
    | undefined;

  constructor(dependencies: DataManagementDependencies) {
    this.dependencies = dependencies;
  }

  async exportJson(): Promise<DataFileResult> {
    return safeFileOperation(async () => {
      const snapshot = await this.dependencies.database.snapshotAll(this.now());
      return this.dependencies.backups.exportJson(snapshot);
    });
  }

  async exportCsv(): Promise<DataFileResult> {
    return safeFileOperation(async () => {
      const rows = [...await this.dependencies.transactions.listTransactions()]
        .sort((left, right) =>
          right.effectiveAt.localeCompare(left.effectiveAt) ||
          (left.id as string).localeCompare(right.id as string));
      return this.dependencies.backups.exportCsv(
        serializeTransactionsCsv(rows),
      );
    });
  }

  async chooseBackupFolder(): Promise<
    { readonly status: "cancelled" } |
    { readonly status: "success"; readonly folderPath: string } |
    {
      readonly status: "failed";
      readonly errorCode: BackupErrorCode;
      readonly message: string;
    }
  > {
    try {
      const folderPath = await this.dependencies.backups.chooseBackupFolder();
      if (folderPath === null) return { status: "cancelled" };
      if (
        folderPath.trim().length === 0 ||
        folderPath.length > 1024 ||
        /[\u0000-\u001F]/.test(folderPath)
      ) return failure("INVALID_PATH");
      const current = await this.dependencies.settings.get();
      await this.dependencies.settings.update({
        ...current,
        backupFolderPath: folderPath,
      });
      return { status: "success", folderPath };
    } catch (error) {
      return safeFailure(error);
    }
  }

  async resetBackupFolder(): Promise<void> {
    const current = await this.dependencies.settings.get();
    const { backupFolderPath: _removed, ...withoutFolder } = current;
    await this.dependencies.settings.update(withoutFolder);
  }

  async selectImport(): Promise<RestorePreview | null> {
    this.candidate = undefined;
    const raw = await this.dependencies.backups.importJson();
    if (raw === null) return null;
    const candidate = migrateBackupEnvelope(parseBackupEnvelope(raw));
    const candidateId = crypto.randomUUID();
    this.candidate = {
      id: candidateId,
      canonical: serializeBackupEnvelope(candidate),
    };
    return {
      candidateId,
      exportedAt: candidate.exportedAt,
      schemaVersion: candidate.schemaVersion,
      counts: counts(candidate),
    };
  }

  previewRestore(): Promise<RestorePreview | null> {
    return this.selectImport();
  }

  async restore(candidateId: string, confirmation: string): Promise<{
    readonly reloadRequired: true;
    readonly counts: RestoreCounts;
  }> {
    if (confirmation !== "REPLACE MY DATA") {
      throw new DataManagementError("RESTORE_CONFIRMATION_REQUIRED");
    }
    const stored = this.candidate;
    if (!stored || stored.id !== candidateId) {
      throw new DataManagementError("RESTORE_CANDIDATE_MISSING");
    }
    this.candidate = undefined;
    const candidate = deserializeBackupEnvelope(stored.canonical);
    const settings = await this.dependencies.settings.get();
    const restored = await this.dependencies.restore.restore(
      candidate,
      settings.backupFolderPath,
    );
    return { reloadRequired: true, counts: restored };
  }

  invalidateRestoreCandidate(): void {
    this.candidate = undefined;
  }

  private now(): string {
    return (this.dependencies.clock ?? (() => new Date().toISOString()))();
  }
}

function counts(envelope: BackupEnvelope): RestoreCounts {
  return {
    metadata: envelope.data.metadata.length,
    settings: envelope.data.settings.length,
    accounts: envelope.data.accounts.length,
    transactions: envelope.data.transactions.length,
    budgets: envelope.data.budgets.length,
    auditEntries: envelope.data.auditEntries.length,
    backupMetadata: envelope.data.backupMetadata.length,
    calculationCaches: envelope.data.calculationCaches.length,
  };
}

async function safeFileOperation(
  operation: () => Promise<BackupResult | null>,
): Promise<DataFileResult> {
  try {
    const result = await operation();
    if (result === null) return { status: "cancelled" };
    if (!result.success) return failure(result.errorCode);
    return {
      status: "success",
      path: result.path,
      directory: result.directory,
      ...(result.warning === undefined ? {} : { warning: result.warning }),
    };
  } catch (error) {
    return safeFailure(error);
  }
}

function safeFailure(error: unknown): Extract<DataFileResult, { status: "failed" }> {
  const candidate = typeof error === "object" && error !== null &&
      "code" in error && typeof error.code === "string"
    ? error.code
    : "UNKNOWN";
  const code = (BACKUP_ERROR_CODES as readonly string[]).includes(candidate)
    ? candidate as BackupErrorCode
    : "UNKNOWN";
  return failure(code);
}

function failure(
  errorCode: BackupErrorCode,
): Extract<DataFileResult, { status: "failed" }> {
  const messages: Record<BackupErrorCode, string> = {
    DOCUMENTS_UNAVAILABLE: "The Documents folder is unavailable.",
    DIRECTORY_UNAVAILABLE: "The backup folder is unavailable.",
    PERMISSION_DENIED: "MiroraTrack does not have permission to use that folder.",
    INVALID_PATH: "The selected folder is invalid.",
    TARGET_EXISTS: "A file with that name already exists.",
    FILE_TOO_LARGE: "The selected file is too large.",
    READ_FAILED: "The selected file could not be read.",
    WRITE_FAILED: "The file could not be written.",
    SYNC_FAILED: "The file could not be safely saved.",
    PROMOTION_FAILED: "The file could not be finalized.",
    DIALOG_FAILED: "The file picker could not be opened.",
    RETENTION_WARNING: "The backup was saved, but older backups could not be pruned.",
    UNKNOWN: "The file operation failed.",
  };
  const safeCode = errorCode in messages ? errorCode : "UNKNOWN";
  return { status: "failed", errorCode: safeCode, message: messages[safeCode] };
}
