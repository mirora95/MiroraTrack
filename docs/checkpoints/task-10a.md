# Task 10A implementation checkpoint

## Outcome

Implemented the budget domain and persistence prerequisite for the Budgets and
Dashboard UI:

- Budgets now have explicit `active | archived` lifecycle state.
- Budget audit records use a discriminated `budget` entity contract.
- Budget reads and mutations are exposed through application ports.
- Create, replace, archive/reactivate, and archived-only delete operations use
  full expected-record comparison for mutable existing records.
- Every mutation atomically changes the budget, writes its exact audit record,
  advances the metadata revision, and clears calculation caches.
- Active budget scope is unique by month, expense category, and currency,
  including concurrent creates and reactivation.
- Persistence rejects unregistered/non-expense categories, unsupported
  currencies, non-positive unsafe amounts, zero/invalid months, and rollover.
- Database schema v4 adds budget status and query indexes.
- The v3-to-v4 migration activates valid existing budgets, disables legacy
  rollover, upgrades schema/calculation metadata, advances the revision, clears
  caches, and fails closed for duplicate or invalid legacy scopes.
- Backup envelope v3 preserves the exact eight-store shape, accepts and
  migrates v1/v2 backups, adds budget status/audits, and rejects duplicate
  active scopes.

## Created files

- `src/database/budgetReadRepository.ts`
- `src/database/budgetUnitOfWork.ts`
- `tests/integration/budgetUnitOfWork.test.ts`
- `work/checkpoints/task-10a-before/manifest.md`
- `docs/checkpoints/task-10a.md`

## Modified files

- `src/application/activityService.ts`
- `src/application/dashboardService.test.ts`
- `src/application/ports.ts`
- `src/application/validation.ts`
- `src/backup/schema.ts`
- `src/database/backupRepository.ts`
- `src/database/db.ts`
- `src/database/migrations.ts`
- `src/database/schema.ts`
- `src/finance/budgets.test.ts`
- `src/finance/money.ts`
- `src/finance/types.ts`
- `tests/integration/migrations.test.ts`
- `tests/unit/backup.test.ts`

## Verification

- Focused budget/migration/backup/restore run: 110 tests passed.
- TypeScript typecheck: passed.
- Full test suite: 382 tests passed in 30 test files.
- Production Vite build: passed.
- No lint script exists in `package.json`, so linting was not available.
- Native Tauri files were unchanged and native verification was outside this
  task.
- Build emitted the existing advisory that the main minified JavaScript chunk
  exceeds 500 kB; it did not fail the build.

No Git commands or Git metadata operations were used.

## Independent review correction

The P1 review found that backup envelope v3 accepted a stale
`metadata.calculationVersion`. Current v3 envelopes now require the exact
current calculation version (`2`), while legacy v1/v2 envelopes retain
permissive parsing and are upgraded in memory. Regression coverage proves the
stale current envelope is rejected after the durable safety snapshot but
before any IndexedDB replacement, with the existing database unchanged.

The correction has its own before checkpoint at
`work/checkpoints/task-10a-review-p1-before/manifest.md`.
