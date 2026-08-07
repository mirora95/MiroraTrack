import type {
  SettingsReadPort,
  SettingsUnitOfWork,
} from "./ports";
import { ValidationError } from "./validation";
import { isSupportedCurrency } from "../finance/money";
import type { Settings } from "../finance/types";

export const DATE_FORMATS = [
  "yyyy-MM-dd",
  "MM/dd/yyyy",
  "dd/MM/yyyy",
] as const;
export const BACKUP_INTERVALS = [6, 12, 24, 168] as const;

export interface SettingsUpdateOptions {
  readonly acknowledgeNoConversion?: boolean;
}

export interface SettingsServiceDependencies {
  readonly reads: SettingsReadPort;
  readonly uow: SettingsUnitOfWork;
}

export class SettingsService {
  private readonly dependencies: SettingsServiceDependencies;

  constructor(dependencies: SettingsServiceDependencies) {
    this.dependencies = dependencies;
  }

  async get(): Promise<Settings> {
    return (await this.dependencies.reads.getSettingsSnapshot()).settings;
  }

  async update(
    candidate: Settings,
    options: SettingsUpdateOptions = {},
  ): Promise<Settings> {
    const snapshot = await this.dependencies.reads.getSettingsSnapshot();
    const next = validateSettings(candidate);
    if (
      next.baseCurrency !== snapshot.settings.baseCurrency &&
      options.acknowledgeNoConversion !== true
    ) {
      throw new ValidationError(
        "BASE_CURRENCY_ACKNOWLEDGEMENT_REQUIRED",
        "baseCurrency",
      );
    }
    await this.dependencies.uow.replaceSettings(
      snapshot.settings,
      next,
      snapshot.revision,
    );
    return next;
  }
}

export function validateSettings(candidate: Settings): Settings {
  const allowed = new Set([
    "key",
    "baseCurrency",
    "locale",
    "dateFormat",
    "defaultAccountId",
    "backupFolderPath",
    "automaticBackupsEnabled",
    "automaticBackupIntervalHours",
  ]);
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Object.keys(candidate).some((key) => !allowed.has(key))
  ) {
    throw new ValidationError("INVALID_SETTINGS", "settings");
  }
  if (candidate.key !== "primary") {
    throw new ValidationError("INVALID_SETTINGS", "key");
  }
  if (!isSupportedCurrency(candidate.baseCurrency)) {
    throw new ValidationError("INVALID_CURRENCY", "baseCurrency");
  }
  if (
    typeof candidate.locale !== "string" ||
    candidate.locale.length === 0 ||
    candidate.locale !== candidate.locale.trim() ||
    /[\u0000-\u001F\u007F]/.test(candidate.locale)
  ) {
    throw new ValidationError("INVALID_LOCALE", "locale");
  }
  let locale: string;
  try {
    locale = Intl.getCanonicalLocales(candidate.locale)[0] ?? "";
  } catch {
    throw new ValidationError("INVALID_LOCALE", "locale");
  }
  if (!locale) throw new ValidationError("INVALID_LOCALE", "locale");
  if (!DATE_FORMATS.includes(candidate.dateFormat as never)) {
    throw new ValidationError("INVALID_DATE_FORMAT", "dateFormat");
  }
  if (!BACKUP_INTERVALS.includes(candidate.automaticBackupIntervalHours as never)) {
    throw new ValidationError(
      "INVALID_BACKUP_INTERVAL",
      "automaticBackupIntervalHours",
    );
  }
  if (typeof candidate.automaticBackupsEnabled !== "boolean") {
    throw new ValidationError("INVALID_SETTINGS", "automaticBackupsEnabled");
  }
  if (
    candidate.backupFolderPath !== undefined &&
    (candidate.backupFolderPath.trim().length === 0 ||
      candidate.backupFolderPath.length > 1024 ||
      /[\u0000-\u001F]/.test(candidate.backupFolderPath))
  ) {
    throw new ValidationError("INVALID_BACKUP_FOLDER", "backupFolderPath");
  }
  if (
    candidate.defaultAccountId !== undefined &&
    (typeof candidate.defaultAccountId !== "string" ||
      candidate.defaultAccountId.trim().length === 0 ||
      candidate.defaultAccountId !== candidate.defaultAccountId.trim() ||
      candidate.defaultAccountId.length > 128 ||
      /[\u0000-\u001F]/.test(candidate.defaultAccountId))
  ) {
    throw new ValidationError("INVALID_SETTINGS", "defaultAccountId");
  }
  return {
    key: "primary",
    baseCurrency: candidate.baseCurrency,
    locale,
    dateFormat: candidate.dateFormat,
    ...(candidate.defaultAccountId === undefined
      ? {}
      : { defaultAccountId: candidate.defaultAccountId }),
    ...(candidate.backupFolderPath === undefined
      ? {}
      : { backupFolderPath: candidate.backupFolderPath }),
    automaticBackupsEnabled: candidate.automaticBackupsEnabled,
    automaticBackupIntervalHours: candidate.automaticBackupIntervalHours,
  };
}
