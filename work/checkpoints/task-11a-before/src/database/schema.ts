export const STORE_NAMES = [
  "metadata",
  "settings",
  "accounts",
  "transactions",
  "budgets",
  "auditEntries",
  "backupMetadata",
  "calculationCaches",
] as const;

export const V1_STORES = {
  metadata: "&key",
  settings: "&key",
  accounts: "&id,status,currency,createdAt,updatedAt",
  transactions:
    "&id,type,status,currency,effectiveAt,sourceAccountId,destinationAccountId,categoryId,createdAt,updatedAt",
  budgets: "&id,month,categoryId,currency,createdAt,updatedAt",
  auditEntries: "&id,timestamp,action,entityType,entityId",
  backupMetadata: "&id,status,lastSuccessfulAt",
  calculationCaches: "&key,calculationVersion,sourceRevision,updatedAt",
} as const;

export const V2_STORES = { ...V1_STORES } as const;
export const V3_STORES = { ...V2_STORES } as const;
export const V4_STORES = {
  ...V3_STORES,
  budgets:
    "&id,status,month,categoryId,currency,[month+categoryId+currency],createdAt,updatedAt",
} as const;
