import { parseBackupEnvelope, type BackupEnvelopeV1 } from "./schema";

const COLLECTION_ORDER = [
  "metadata", "settings", "accounts", "transactions", "budgets",
  "auditEntries", "backupMetadata", "calculationCaches",
] as const;

export function serializeBackupEnvelope(input: unknown): string {
  const envelope = parseBackupEnvelope(input);
  const data = Object.fromEntries(COLLECTION_ORDER.map((key) => [
    key, envelope.data[key].map((value) => canonicalize(value)),
  ]));
  return JSON.stringify({
    app: envelope.app,
    schemaVersion: envelope.schemaVersion,
    exportedAt: envelope.exportedAt,
    data,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((key) => [
      key, canonicalize((value as Record<string, unknown>)[key]),
    ]));
  }
  return value;
}

export function deserializeBackupEnvelope(serialized: string): BackupEnvelopeV1 {
  try {
    return parseBackupEnvelope(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Backup is not valid JSON", { cause: error });
    }
    throw error;
  }
}
