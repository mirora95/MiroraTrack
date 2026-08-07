export type ValidationErrorCode =
  | "REQUIRED"
  | "INVALID_TYPE"
  | "INVALID_STATUS"
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_TIMESTAMP"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_ARCHIVED"
  | "CURRENCY_MISMATCH"
  | "SAME_ACCOUNT"
  | "TRANSACTION_NOT_FOUND"
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
  | "ID_COLLISION";

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
