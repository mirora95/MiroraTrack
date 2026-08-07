# Task 05A before manifest

Captured before Task 05A source edits on 2026-07-28.

## Requested scope

- `src/application/ports.ts` — exists; defines `FinanceUnitOfWork`.
- `src/application/validation.ts` — absent.
- `src/application/financeService.ts` — absent.
- `src/application/financeService.test.ts` — absent.
- `docs/checkpoints/task-05a.md` — absent.

## Existing dependencies inspected

- `src/finance/types.ts` defines the transaction discriminated union, account,
  audit, and branded identifier types.
- `src/finance/money.ts` defines the existing `currencyCode` factory.
- `src/finance/ledger.ts` defines the existing `parseTimestamp` validator.
- `src/database/unitOfWork.ts` implements the current atomic persistence port.

## Constraints

- Tests must be added and observed failing for missing features before production
  implementation.
- Production changes are limited to the requested application files.
- Task 5A excludes dashboard and cache work.
- No Git commands or `.git` metadata access.
