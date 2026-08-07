import { z } from "zod";
import type {
  Account, AppMetadata, AuditEntry, BackupMetadata, Budget,
  CalculationCache, Settings, Transaction,
} from "../finance/types";

export const BACKUP_SCHEMA_VERSION = 1 as const;
export type BackupValidationErrorCode =
  | "BACKUP_APP_UNSUPPORTED"
  | "BACKUP_VERSION_NEWER"
  | "BACKUP_VERSION_OLDER"
  | "BACKUP_INVALID";

export class BackupValidationError extends Error {
  readonly code: BackupValidationErrorCode;
  override readonly cause?: unknown;
  constructor(code: BackupValidationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "BackupValidationError";
    this.code = code;
    this.cause = cause;
  }
}

export interface BackupDataV1 {
  readonly metadata: readonly AppMetadata[];
  readonly settings: readonly Settings[];
  readonly accounts: readonly Account[];
  readonly transactions: readonly Transaction[];
  readonly budgets: readonly Budget[];
  readonly auditEntries: readonly AuditEntry[];
  readonly backupMetadata: readonly BackupMetadata[];
  readonly calculationCaches: readonly CalculationCache[];
}
export interface BackupEnvelopeV1 {
  readonly app: "MiroraTrack";
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly data: BackupDataV1;
}

const id = z.string().min(1);
const currency = z.string().regex(/^[A-Z]{3}$/);
const integer = z.number().int().safe();
const positiveAmount = integer.positive();
const iso = z.string().refine((value) => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const match = /^(\d{4})-(\d\d)-(\d\d)/.exec(value);
  if (!match) return false;
  const date = new Date(time);
  const localDay = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return !Number.isNaN(localDay.valueOf()) &&
    localDay.getUTCFullYear() === Number(match[1]) &&
    localDay.getUTCMonth() + 1 === Number(match[2]) &&
    localDay.getUTCDate() === Number(match[3]) &&
    !Number.isNaN(date.valueOf());
}, "Invalid ISO 8601 timestamp");

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.string(), z.number().finite(),
  z.array(jsonValue), z.record(z.string(), jsonValue),
]));
const account = z.strictObject({
  id, name: z.string(), type: z.enum(["cash", "checking", "savings", "credit", "investment", "other"]),
  status: z.enum(["active", "archived"]), currency, openingBalance: integer, createdAt: iso, updatedAt: iso,
});
const sharedTransaction = {
  id, status: z.enum(["completed", "planned", "cancelled"]), amount: positiveAmount,
  currency, effectiveAt: iso, description: z.string().optional(), createdAt: iso, updatedAt: iso,
};
const transaction = z.discriminatedUnion("type", [
  z.strictObject({ ...sharedTransaction, type: z.literal("income"), destinationAccountId: id, categoryId: id }),
  z.strictObject({ ...sharedTransaction, type: z.literal("expense"), sourceAccountId: id, categoryId: id }),
  z.strictObject({ ...sharedTransaction, type: z.literal("transfer"), sourceAccountId: id, destinationAccountId: id }),
]);
const budget = z.strictObject({
  id, name: z.string(), categoryId: id, currency, amount: positiveAmount,
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/), rollover: z.boolean(), createdAt: iso, updatedAt: iso,
});
const audit = z.strictObject({
  id, timestamp: iso, action: z.enum(["transaction.created", "transaction.updated", "transaction.deleted"]),
  entityType: z.literal("transaction"), entityId: id, description: z.string(),
});
const settings = z.strictObject({
  key: z.literal("primary"), baseCurrency: currency, locale: z.string().min(1), dateFormat: z.string().min(1),
  defaultAccountId: id.optional(), backupFolderPath: z.string().optional(), automaticBackupsEnabled: z.boolean(),
});
const metadata = z.strictObject({
  key: z.literal("app"), schemaVersion: z.literal(2), calculationVersion: integer.nonnegative(),
  ledgerRevision: integer.nonnegative(), createdAt: iso, updatedAt: iso,
});
const backupMetadata = z.strictObject({
  id, folderPath: z.string().optional(), lastAttemptAt: iso.optional(), lastSuccessfulAt: iso.optional(),
  status: z.enum(["idle", "success", "failed"]), schemaVersion: z.literal(2),
  errorCode: z.string().optional(), errorMessage: z.string().optional(),
});
const cache = z.strictObject({
  key: id, calculationVersion: integer.nonnegative(), sourceRevision: integer.nonnegative(),
  value: jsonValue, updatedAt: iso,
});
const envelopeSchema = z.strictObject({
  app: z.literal("MiroraTrack"), schemaVersion: z.literal(1), exportedAt: iso,
  data: z.strictObject({
    metadata: z.array(metadata).length(1), settings: z.array(settings).length(1),
    accounts: z.array(account), transactions: z.array(transaction), budgets: z.array(budget),
    auditEntries: z.array(audit), backupMetadata: z.array(backupMetadata), calculationCaches: z.array(cache),
  }),
}).superRefine(({ data }, context) => {
  for (const [name, records] of Object.entries(data)) {
    const seen = new Set<string>();
    for (const record of records as readonly Record<string, unknown>[]) {
      const key = String(record.id ?? record.key);
      if (seen.has(key)) context.addIssue({ code: "custom", message: `Duplicate ${name} identifier: ${key}` });
      seen.add(key);
    }
  }
  const accounts = new Map(data.accounts.map((entry) => [entry.id, entry]));
  if (data.settings[0]?.defaultAccountId && !accounts.has(data.settings[0].defaultAccountId)) {
    context.addIssue({ code: "custom", message: "Default account does not exist" });
  }
  for (const entry of data.transactions) {
    const source = "sourceAccountId" in entry ? accounts.get(entry.sourceAccountId) : undefined;
    const destination = "destinationAccountId" in entry ? accounts.get(entry.destinationAccountId) : undefined;
    if ("sourceAccountId" in entry && !source) context.addIssue({ code: "custom", message: `Transaction source account does not exist: ${entry.id}` });
    if ("destinationAccountId" in entry && !destination) context.addIssue({ code: "custom", message: `Transaction destination account does not exist: ${entry.id}` });
    if (entry.type === "transfer" && entry.sourceAccountId === entry.destinationAccountId) context.addIssue({ code: "custom", message: "Transfer accounts must differ" });
    if ((source && source.currency !== entry.currency) || (destination && destination.currency !== entry.currency)) {
      context.addIssue({ code: "custom", message: `Transaction currency does not match its account: ${entry.id}` });
    }
  }
});

export function parseBackupEnvelope(input: unknown): BackupEnvelopeV1 {
  if (typeof input === "object" && input !== null) {
    const candidate = input as { app?: unknown; schemaVersion?: unknown };
    if (candidate.app !== "MiroraTrack") throw new BackupValidationError("BACKUP_APP_UNSUPPORTED", "Backup belongs to an unsupported application");
    if (typeof candidate.schemaVersion === "number" && candidate.schemaVersion > BACKUP_SCHEMA_VERSION) {
      throw new BackupValidationError("BACKUP_VERSION_NEWER", `Backup schema ${candidate.schemaVersion} is newer than supported schema ${BACKUP_SCHEMA_VERSION}`);
    }
    if (typeof candidate.schemaVersion === "number" && candidate.schemaVersion < BACKUP_SCHEMA_VERSION) {
      throw new BackupValidationError("BACKUP_VERSION_OLDER", `Backup schema ${candidate.schemaVersion} is older than supported schema ${BACKUP_SCHEMA_VERSION}`);
    }
  }
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) throw new BackupValidationError("BACKUP_INVALID", "Backup envelope is invalid", parsed.error);
  return parsed.data as unknown as BackupEnvelopeV1;
}

export function migrateBackupEnvelope(envelope: BackupEnvelopeV1): BackupEnvelopeV1 {
  return envelope;
}

export const validateBackupEnvelope = parseBackupEnvelope;
