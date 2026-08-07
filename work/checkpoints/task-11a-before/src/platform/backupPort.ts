import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import {
  BACKUP_ERROR_CODES,
  type BackupPort,
  type BackupErrorCode,
  type BackupPayload,
  type BackupResult,
} from "../application/ports";
import { serializeBackupEnvelope } from "../backup/serialize";
import {
  AUTOMATIC_BACKUP_METADATA_ID,
  type BackupMetadata,
} from "../finance/types";

export type NativeInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type NativeFileResult = {
  readonly path: string;
  readonly directory: string;
  readonly warning?: {
    readonly code: "RETENTION_WARNING";
    readonly message?: string;
  };
};

const ERROR_CODE_SET = new Set<string>(BACKUP_ERROR_CODES);

export class BackupPortError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupPortError";
    this.code = code;
  }
}

export class TauriBackupPort implements BackupPort {
  private readonly invoke: NativeInvoke;

  constructor(invoke: NativeInvoke = tauriInvoke as NativeInvoke) {
    this.invoke = invoke;
  }

  createAutomaticBackup(
    payload: BackupPayload,
    configuredDirectory?: string,
  ): Promise<BackupResult> {
    return this.createBackup(payload, configuredDirectory, "automatic");
  }

  createSafetyBackup(
    payload: BackupPayload,
    configuredDirectory?: string,
  ): Promise<BackupResult> {
    return this.createBackup(payload, configuredDirectory, "safety");
  }

  async chooseBackupFolder(): Promise<string | null> {
    try {
      return parseNullableString(
        await this.invoke("choose_backup_directory"),
        "INVALID_PATH",
      );
    } catch (error) {
      throw toPortError(error);
    }
  }

  async exportJson(payload: BackupPayload): Promise<BackupResult | null> {
    return this.exportFile("export_json", {
      payload: serializeBackupEnvelope(payload),
    });
  }

  async exportCsv(csv: string): Promise<BackupResult | null> {
    return this.exportFile("export_csv", { csv });
  }

  async importJson(): Promise<unknown | null> {
    try {
      const result = await this.invoke("import_json");
      if (result === null) return null;
      if (!isRecord(result) || typeof result.content !== "string") {
        throw new BackupPortError("READ_FAILED", "The selected backup could not be read");
      }
      try {
        return JSON.parse(result.content) as unknown;
      } catch {
        throw new BackupPortError("READ_FAILED", "The selected file is not valid JSON");
      }
    } catch (error) {
      throw toPortError(error);
    }
  }

  private async createBackup(
    payload: BackupPayload,
    configuredDirectory: string | undefined,
    purpose: "automatic" | "safety",
  ): Promise<BackupResult> {
    try {
      const result = await this.invoke("create_backup", {
        payload: serializeBackupEnvelope(payload),
        configuredDirectory: configuredDirectory ?? null,
        purpose,
      });
      return { success: true, ...parseNativeFileResult(result) };
    } catch (error) {
      return failureResult(error);
    }
  }

  private async exportFile(
    command: "export_json" | "export_csv",
    args: Record<string, unknown>,
  ): Promise<BackupResult | null> {
    try {
      const result = await this.invoke(command, args);
      return result === null
        ? null
        : { success: true, ...parseNativeFileResult(result) };
    } catch (error) {
      return failureResult(error);
    }
  }
}

export interface BackupMetadataStore {
  get(id: typeof AUTOMATIC_BACKUP_METADATA_ID): Promise<BackupMetadata | undefined>;
  put(metadata: BackupMetadata): Promise<void>;
}

export class AutomaticBackupService {
  private readonly backups: Pick<BackupPort, "createAutomaticBackup">;
  private readonly metadata: BackupMetadataStore;
  private readonly clock: () => string;

  constructor(
    backups: Pick<BackupPort, "createAutomaticBackup">,
    metadata: BackupMetadataStore,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.backups = backups;
    this.metadata = metadata;
    this.clock = clock;
  }

  async create(
    payload: BackupPayload,
    configuredDirectory?: string,
  ): Promise<BackupResult> {
    const attemptedAt = this.clock();
    const backedUpSchemaVersion =
      payload.data.metadata.find(({ key }) => key === "app")?.schemaVersion ??
      payload.schemaVersion;
    const previous = await this.metadata.get(AUTOMATIC_BACKUP_METADATA_ID);
    const result = await this.backups.createAutomaticBackup(
      payload,
      configuredDirectory,
    );

    if (result.success) {
      await this.metadata.put({
        id: AUTOMATIC_BACKUP_METADATA_ID,
        folderPath: result.directory,
        lastAttemptAt: attemptedAt,
        lastSuccessfulAt: attemptedAt,
        status: "success",
        schemaVersion: backedUpSchemaVersion,
      });
      return result;
    }

    await this.metadata.put({
      id: AUTOMATIC_BACKUP_METADATA_ID,
      ...(previous?.folderPath === undefined
        ? {}
        : { folderPath: previous.folderPath }),
      ...(previous?.lastSuccessfulAt === undefined
        ? {}
        : { lastSuccessfulAt: previous.lastSuccessfulAt }),
      lastAttemptAt: attemptedAt,
      status: "failed",
      schemaVersion: previous?.schemaVersion ?? backedUpSchemaVersion,
      errorCode: result.errorCode,
      ...(result.message === undefined ? {} : { errorMessage: result.message }),
    });
    return result;
  }
}

function parseNativeFileResult(value: unknown): NativeFileResult {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.directory !== "string"
  ) {
    throw new BackupPortError("UNKNOWN", "Backup operation returned an invalid result");
  }
  const warning = parseWarning(value.warning);
  return {
    path: value.path,
    directory: value.directory,
    ...(warning === undefined ? {} : { warning }),
  };
}

function parseWarning(value: unknown): NativeFileResult["warning"] {
  if (value === undefined || value === null) return undefined;
  if (
    !isRecord(value) ||
    value.code !== "RETENTION_WARNING" ||
    (value.message !== undefined && typeof value.message !== "string")
  ) {
    throw new BackupPortError("UNKNOWN", "Backup operation returned an invalid warning");
  }
  return {
    code: "RETENTION_WARNING",
    ...(value.message === undefined ? {} : { message: safeMessage(value.message) }),
  };
}

function parseNullableString(
  value: unknown,
  code: BackupErrorCode,
): string | null {
  if (value === null || typeof value === "string") return value;
  throw new BackupPortError(code, "The selected location is invalid");
}

function failureResult(error: unknown): Extract<BackupResult, { success: false }> {
  const mapped = toPortError(error);
  return {
    success: false,
    errorCode: mapped.code,
    message: mapped.message,
  };
}

function toPortError(error: unknown): BackupPortError {
  if (error instanceof BackupPortError) return error;
  if (isRecord(error) && typeof error.code === "string") {
    const known = ERROR_CODE_SET.has(error.code)
      ? error.code as BackupErrorCode
      : "UNKNOWN";
    if (known === "UNKNOWN") {
      return new BackupPortError("UNKNOWN", "Backup operation failed");
    }
    return new BackupPortError(
      known,
      typeof error.message === "string"
        ? safeMessage(error.message)
        : "Backup operation failed",
    );
  }
  return new BackupPortError("UNKNOWN", "Backup operation failed");
}

function safeMessage(message: string): string {
  if (
    message.length === 0 ||
    message.length > 240 ||
    /[A-Za-z]:[\\/]|\\\\|[\r\n]/.test(message)
  ) {
    return "Backup operation failed";
  }
  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
