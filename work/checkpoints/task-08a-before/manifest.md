# Task 08A before checkpoint

Created: 2026-07-29

Preserves the domain, service, database migration, and backup files before the ledger-only opening balance and account service migration. No Git metadata was accessed or modified.

## Preserved files

- `src/finance/types.ts`
- `src/finance/money.ts`
- `src/finance/money.test.ts`
- `src/finance/ledger.ts`
- `src/finance/ledger.test.ts`
- `src/finance/budgets.ts`
- `src/finance/budgets.test.ts`
- `src/application/ports.ts`
- `src/application/financeService.ts`
- `src/application/financeService.test.ts`
- `src/application/dashboardService.ts`
- `src/application/dashboardService.test.ts`
- `src/database/db.ts`
- `src/database/schema.ts`
- `src/database/migrations.ts`
- `src/database/backupRepository.ts`
- `src/backup/schema.ts`
- `src/backup/serialize.ts`
- `tests/integration/migrations.test.ts`
- `tests/integration/unitOfWork.test.ts`
- `tests/integration/restoreInterruption.test.ts`
- `tests/unit/backup.test.ts`


## Scope

Task 08A changes domain/schema/backup compatibility, exact signed money parsing, account and initialization services, atomic IndexedDB unit of work, migration and integration tests. React routes and visual UI are excluded.
