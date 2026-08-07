export type ValidationErrorCode =
  | "REQUIRED"
  | "INVALID_TYPE"
  | "INVALID_STATUS"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_TIMESTAMP"
  | "INVALID_DATE"
  | "INVALID_CATEGORY"
  | "INVALID_NOTE"
  | "INVALID_FILTER"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_ARCHIVED"
  | "CURRENCY_MISMATCH"
  | "SAME_ACCOUNT"
  | "TRANSACTION_NOT_FOUND"
  | "CONCURRENT_MODIFICATION"
  | "OPENING_BALANCE_PROTECTED"
  | "INVALID_ACCOUNT_NAME"
  | "INVALID_ACCOUNT_TYPE"
  | "INVALID_ACCOUNT_COLOR"
  | "INVALID_ACCOUNT_ICON"
  | "INVALID_CREDIT_LIMIT"
  | "CREDIT_LIMIT_NOT_ALLOWED"
  | "ACCOUNT_ALREADY_EXISTS"
  | "ACCOUNT_CURRENCY_LOCKED"
  | "INITIALIZATION_STATE_INVALID"
  | "ID_COLLISION"
  | "BUDGET_NOT_FOUND"
  | "BUDGET_SCOPE_CONFLICT"
  | "BUDGET_MUST_BE_ARCHIVED"
  | "BASE_CURRENCY_ACKNOWLEDGEMENT_REQUIRED"
  | "INVALID_SETTINGS"
  | "INVALID_LOCALE"
  | "INVALID_DATE_FORMAT"
  | "INVALID_BACKUP_INTERVAL"
  | "INVALID_BACKUP_FOLDER";

export class ValidationError extends Error {
  readonly code: ValidationErrorCode;
  readonly field: string;

  constructor(
    code: ValidationErrorCode,
    field: string,
  ) {
    super(`${code}: ${field}`);
    this.name = "ValidationError";
    this.code = code;
    this.field = field;
  }
}

export function requiredId(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new ValidationError("REQUIRED", field);
  return normalized;
}
