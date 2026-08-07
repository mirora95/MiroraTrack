import { z } from "zod";

import type {
  Account,
  AccountColor,
  AccountIcon,
  AppMetadata,
  AuditEntry,
  BackupMetadata,
  Budget,
  CalculationCache,
  Settings,
  Transaction,
} from "../finance/types";

export const BACKUP_SCHEMA_VERSION = 2 as const;
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

interface BackupData {
  readonly metadata: readonly AppMetadata[];
  readonly settings: readonly Settings[];
  readonly accounts: readonly Account[];
  readonly transactions: readonly Transaction[];
  readonly budgets: readonly Budget[];
  readonly auditEntries: readonly AuditEntry[];
  readonly backupMetadata: readonly BackupMetadata[];
  readonly calculationCaches: readonly CalculationCache[];
}

export interface BackupEnvelope {
  readonly app: "MiroraTrack";
  readonly schemaVersion: 2;
  readonly exportedAt: string;
  readonly data: BackupData;
}

interface LegacyAccount extends Omit<Account, "color" | "icon" | "creditLimit"> {
  readonly openingBalance: number;
}
interface LegacyTransactionShared {
  readonly id: string;
  readonly status: "completed" | "planned" | "cancelled";
  readonly amount: number;
  readonly currency: string;
  readonly effectiveAt: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
type LegacyTransaction =
  | (LegacyTransactionShared & {
      readonly type: "income";
      readonly destinationAccountId: string;
      readonly categoryId: string;
    })
  | (LegacyTransactionShared & {
      readonly type: "expense";
      readonly sourceAccountId: string;
      readonly categoryId: string;
    })
  | (LegacyTransactionShared & {
      readonly type: "transfer";
      readonly sourceAccountId: string;
      readonly destinationAccountId: string;
    });

export interface BackupEnvelopeV1 {
  readonly app: "MiroraTrack";
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly data: Omit<BackupData, "accounts" | "transactions"> & {
    readonly accounts: readonly LegacyAccount[];
    readonly transactions: readonly LegacyTransaction[];
  };
}

export type ParsedBackupEnvelope = BackupEnvelopeV1 | BackupEnvelope;

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
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]);
}, "Invalid ISO 8601 timestamp");
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.string(), z.number().finite(),
  z.array(jsonValue), z.record(z.string(), jsonValue),
]));

const accountCore = {
  id, name: z.string(), type: z.enum([
    "cash", "checking", "savings", "credit", "investment", "other",
  ]),
  status: z.enum(["active", "archived"]), currency,
  createdAt: iso, updatedAt: iso,
};
const accountV1 = z.strictObject({ ...accountCore, openingBalance: integer });
const accountV2 = z.strictObject({
  ...accountCore,
  color: z.enum(["blue", "teal", "gold", "purple", "green", "slate"]),
  icon: z.enum([
    "banknote", "landmark", "piggy-bank", "credit-card", "chart-line", "wallet",
  ]),
  creditLimit: integer.nonnegative().optional(),
}).superRefine((value, context) => {
  if (value.type !== "credit" && value.creditLimit !== undefined) {
    context.addIssue({ code: "custom", message: "Credit limit is only valid for credit accounts" });
  }
});
const sharedTransaction = {
  id, status: z.enum(["completed", "planned", "cancelled"]),
  amount: positiveAmount, currency, effectiveAt: iso,
  description: z.string().optional(), createdAt: iso, updatedAt: iso,
};
const transactionSchemas = (purpose: boolean) => {
  const shared = purpose
    ? { ...sharedTransaction, purpose: z.enum(["standard", "opening-balance"]) }
    : sharedTransaction;
  return z.discriminatedUnion("type", [
    z.strictObject({ ...shared, type: z.literal("income"), destinationAccountId: id, categoryId: id }),
    z.strictObject({ ...shared, type: z.literal("expense"), sourceAccountId: id, categoryId: id }),
    z.strictObject({ ...shared, type: z.literal("transfer"), sourceAccountId: id, destinationAccountId: id }),
  ]);
};
const budget = z.strictObject({
  id, name: z.string(), categoryId: id, currency, amount: positiveAmount,
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
  rollover: z.boolean(), createdAt: iso, updatedAt: iso,
});
const auditV1 = z.strictObject({
  id, timestamp: iso,
  action: z.enum(["transaction.created", "transaction.updated", "transaction.deleted"]),
  entityType: z.literal("transaction"), entityId: id, description: z.string(),
});
const auditShared = {
  id, timestamp: iso, entityId: id, description: z.string(),
};
const auditV2 = z.discriminatedUnion("entityType", [
  z.strictObject({
    ...auditShared,
    action: z.enum([
      "transaction.created", "transaction.updated", "transaction.deleted",
    ]),
    entityType: z.literal("transaction"),
  }),
  z.strictObject({
    ...auditShared,
    action: z.enum([
      "account.created", "account.updated", "account.archived",
      "account.reactivated",
    ]),
    entityType: z.literal("account"),
  }),
  z.strictObject({
    ...auditShared,
    action: z.literal("settings.initialized"),
    entityType: z.literal("settings"),
    entityId: z.literal("primary"),
  }),
]);
const settings = z.strictObject({
  key: z.literal("primary"), baseCurrency: currency,
  locale: z.string().min(1), dateFormat: z.string().min(1),
  defaultAccountId: id.optional(), backupFolderPath: z.string().optional(),
  automaticBackupsEnabled: z.boolean(),
});
const metadata = (version: 2 | 3) => z.strictObject({
  key: z.literal("app"), schemaVersion: z.literal(version),
  calculationVersion: integer.nonnegative(), ledgerRevision: integer.nonnegative(),
  createdAt: iso, updatedAt: iso,
});
const backupMetadata = (version: 2 | 3) => z.strictObject({
  id, folderPath: z.string().optional(), lastAttemptAt: iso.optional(),
  lastSuccessfulAt: iso.optional(), status: z.enum(["idle", "success", "failed"]),
  schemaVersion: z.literal(version), errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
const cache = z.strictObject({
  key: id, calculationVersion: integer.nonnegative(),
  sourceRevision: integer.nonnegative(), value: jsonValue, updatedAt: iso,
});

function envelopeSchema(version: 1 | 2) {
  const current = version === 2;
  return z.strictObject({
    app: z.literal("MiroraTrack"), schemaVersion: z.literal(version),
    exportedAt: iso,
    data: z.strictObject({
      metadata: z.array(metadata(current ? 3 : 2)).length(1),
      settings: z.array(settings).length(1),
      accounts: z.array(current ? accountV2 : accountV1),
      transactions: z.array(transactionSchemas(current)),
      budgets: z.array(budget),
      auditEntries: z.array(current ? auditV2 : auditV1),
      backupMetadata: z.array(backupMetadata(current ? 3 : 2)),
      calculationCaches: z.array(cache),
    }),
  }).superRefine(({ data }, context) => {
    for (const [name, records] of Object.entries(data)) {
      const seen = new Set<string>();
      for (const record of records as readonly Record<string, unknown>[]) {
        const key = String(record.id ?? record.key);
        if (seen.has(key)) {
          context.addIssue({ code: "custom", message: `Duplicate ${name} identifier: ${key}` });
        }
        seen.add(key);
      }
    }
    const accounts = new Map(data.accounts.map((entry) => [entry.id, entry]));
    if (data.settings[0]?.defaultAccountId &&
        !accounts.has(data.settings[0].defaultAccountId)) {
      context.addIssue({ code: "custom", message: "Default account does not exist" });
    }
    for (const entry of data.transactions) {
      const source = "sourceAccountId" in entry
        ? accounts.get(entry.sourceAccountId)
        : undefined;
      const destination = "destinationAccountId" in entry
        ? accounts.get(entry.destinationAccountId)
        : undefined;
      if ("sourceAccountId" in entry && !source) {
        context.addIssue({ code: "custom", message: `Transaction source account does not exist: ${entry.id}` });
      }
      if ("destinationAccountId" in entry && !destination) {
        context.addIssue({ code: "custom", message: `Transaction destination account does not exist: ${entry.id}` });
      }
      if (entry.type === "transfer" &&
          entry.sourceAccountId === entry.destinationAccountId) {
        context.addIssue({ code: "custom", message: "Transfer accounts must differ" });
      }
      if ((source && source.currency !== entry.currency) ||
          (destination && destination.currency !== entry.currency)) {
        context.addIssue({ code: "custom", message: `Transaction currency does not match its account: ${entry.id}` });
      }
      if (current && "purpose" in entry &&
          entry.purpose === "opening-balance" &&
          (entry.status !== "completed" ||
            entry.type === "transfer" ||
            ("categoryId" in entry &&
              entry.categoryId !== "system:opening-balance"))) {
        context.addIssue({ code: "custom", message: `Opening balance transaction is invalid: ${entry.id}` });
      }
    }
  });
}

const v1Schema = envelopeSchema(1);
const v2Schema = envelopeSchema(2);

export function parseBackupEnvelope(input: unknown): ParsedBackupEnvelope {
  if (typeof input === "object" && input !== null) {
    const candidate = input as { app?: unknown; schemaVersion?: unknown };
    if (candidate.app !== "MiroraTrack") {
      throw new BackupValidationError(
        "BACKUP_APP_UNSUPPORTED",
        "Backup belongs to an unsupported application",
      );
    }
    if (typeof candidate.schemaVersion === "number" &&
        candidate.schemaVersion > BACKUP_SCHEMA_VERSION) {
      throw new BackupValidationError(
        "BACKUP_VERSION_NEWER",
        `Backup schema ${candidate.schemaVersion} is newer than supported schema ${BACKUP_SCHEMA_VERSION}`,
      );
    }
    if (typeof candidate.schemaVersion === "number" &&
        candidate.schemaVersion < 1) {
      throw new BackupValidationError(
        "BACKUP_VERSION_OLDER",
        `Backup schema ${candidate.schemaVersion} is older than supported schema 1`,
      );
    }
  }
  const version = (input as { schemaVersion?: unknown })?.schemaVersion;
  const parsed = (version === 1 ? v1Schema : v2Schema).safeParse(input);
  if (!parsed.success) {
    throw new BackupValidationError(
      "BACKUP_INVALID", "Backup envelope is invalid", parsed.error,
    );
  }
  return parsed.data as unknown as ParsedBackupEnvelope;
}

const visualDefaults: Record<Account["type"], {
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

export function migrateBackupEnvelope(
  envelope: ParsedBackupEnvelope,
): BackupEnvelope {
  if (envelope.schemaVersion === 2) return envelope;
  const transactionIds = new Set(envelope.data.transactions.map(({ id }) => id));
  const auditIds = new Set<string>(
    envelope.data.auditEntries.map(({ id }) => id as string),
  );
  const generatedTransactions: Transaction[] = [];
  const generatedAudits: AuditEntry[] = [];
  for (const account of envelope.data.accounts) {
    if (account.openingBalance === 0) continue;
    const transactionId = `opening-balance:${account.id}`;
    const auditId = `audit:opening-balance:${account.id}`;
    if (transactionIds.has(transactionId) || auditIds.has(auditId)) {
      throw new BackupValidationError(
        "BACKUP_INVALID",
        "Backup opening-balance identifiers collide",
      );
    }
    const shared = {
      id: transactionId as Transaction["id"],
      status: "completed" as const,
      purpose: "opening-balance" as const,
      amount: Math.abs(account.openingBalance) as Transaction["amount"],
      currency: account.currency,
      effectiveAt: account.createdAt,
      categoryId: "system:opening-balance" as never,
      createdAt: account.createdAt,
      updatedAt: account.createdAt,
    };
    generatedTransactions.push(account.openingBalance > 0
      ? { ...shared, type: "income", destinationAccountId: account.id }
      : { ...shared, type: "expense", sourceAccountId: account.id });
    generatedAudits.push({
      id: auditId as AuditEntry["id"],
      timestamp: account.createdAt,
      action: "transaction.created",
      entityType: "transaction",
      entityId: transactionId as Transaction["id"],
      description: "Opening balance migrated",
    });
  }
  const metadata = envelope.data.metadata[0]!;
  if (metadata.ledgerRevision === Number.MAX_SAFE_INTEGER) {
    throw new BackupValidationError("BACKUP_INVALID", "Backup revision overflows");
  }
  const migrated: BackupEnvelope = {
    app: "MiroraTrack", schemaVersion: 2, exportedAt: envelope.exportedAt,
    data: {
      metadata: [{
        ...metadata, schemaVersion: 3,
        ledgerRevision: metadata.ledgerRevision + 1,
      }],
      settings: envelope.data.settings,
      accounts: envelope.data.accounts.map(({ openingBalance: _, ...account }) => ({
        ...account, ...visualDefaults[account.type],
        ...(account.type === "credit" ? { creditLimit: 0 as never } : {}),
      })),
      transactions: [
        ...envelope.data.transactions.map((transaction) => ({
          ...transaction, purpose: "standard" as const,
        })) as Transaction[],
        ...generatedTransactions,
      ],
      budgets: envelope.data.budgets,
      auditEntries: [...envelope.data.auditEntries, ...generatedAudits],
      backupMetadata: envelope.data.backupMetadata.map((entry) => ({
        ...entry, schemaVersion: 3,
      })),
      calculationCaches: [],
    },
  };
  return validateBackupEnvelope(migrated);
}

export function validateBackupEnvelope(input: unknown): BackupEnvelope {
  const parsed = parseBackupEnvelope(input);
  if (parsed.schemaVersion !== 2) {
    throw new BackupValidationError(
      "BACKUP_VERSION_OLDER",
      "Backup must be migrated before current validation",
    );
  }
  return parsed;
}
