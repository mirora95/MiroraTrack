# Task 05B before manifest

Captured before Task 05B source edits on 2026-07-28.

## Requested scope

- `src/application/ports.ts` exists and has no dashboard read port.
- `src/application/dashboardService.ts` is absent.
- `src/application/dashboardService.test.ts` is absent.
- `docs/checkpoints/task-05b.md` is absent.

## Existing dependencies inspected

- `src/finance/types.ts` defines accounts, transactions, budgets, metadata,
  calculation caches, and branded financial types.
- `src/finance/ledger.ts` defines date-range parsing, balance derivation, and
  transaction summaries with safe-integer checks.
- `src/finance/budgets.ts` defines monthly budget usage calculation.

## Constraints

- Tests are added and observed failing before production implementation.
- Production changes are limited to the requested application files.
- Dashboard reads remain behind a narrow port with no database imports.
- No Git commands or `.git` metadata access.
