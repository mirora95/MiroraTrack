# Task 08A — ledger-only accounts foundation

Completed: 2026-07-29

## Implementation summary

Task 08A removes account opening balances as stored balance sources. Account
balances now start at zero and rebuild exclusively from completed ledger
transactions. A signed opening value is represented by one protected,
completed income or expense transaction with purpose `opening-balance`,
positive absolute minor units, and the reserved
`system:opening-balance` category.

Accounts now persist typed color and icon identifiers plus an optional
credit-only limit. `InitializationService` classifies IndexedDB state as
uninitialized, ready, or recovery-required. `AccountService` exposes
ledger-derived account read models and validated create, update, archive, and
reactivate operations without depending on React, Dexie, or Tauri.

`DexieAccountUnitOfWork` atomically covers settings, accounts, transactions,
audit entries, application metadata, and calculation caches. Initialization
and later account creation cannot commit a partial opening balance. Account
currency changes verify transaction references inside the same transaction.
Archiving the default account reassigns another active account or clears the
default without deleting history.

The IndexedDB version advances from 2 to 3. Its rollback-safe migration adds
account visuals, gives legacy credit accounts a zero limit, marks existing
transactions as standard, converts every nonzero legacy opening balance to a
deterministic opening transaction and audit, detects generated-ID collisions,
advances the ledger revision, and clears calculation caches.

The backup envelope advances from version 1 to version 2. Existing v1 JSON is
strictly validated and migrated in memory to the new account and transaction
shapes before restore. This migration preserves each account balance and
clears rebuildable caches. Current snapshots and exports use envelope version
2 with database schema version 3.

## Created files

- `src/application/accountRecords.ts`
- `src/application/accountService.ts`
- `src/application/accountService.test.ts`
- `src/application/initializationService.ts`
- `src/application/initializationService.test.ts`
- `src/database/accountReadRepository.ts`
- `src/database/accountUnitOfWork.ts`
- `tests/integration/accountUnitOfWork.test.ts`
- `work/checkpoints/task-08a-before/manifest.md`
- `docs/checkpoints/task-08a.md`

## Modified files

- `src/finance/types.ts`
- `src/finance/types.test-d.ts`
- `src/finance/money.ts`
- `src/finance/money.test.ts`
- `src/finance/ledger.ts`
- `src/finance/ledger.test.ts`
- `src/finance/budgets.ts`
- `src/finance/budgets.test.ts`
- `src/application/ports.ts`
- `src/application/validation.ts`
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
- `tests/integration/repositories.test.ts`
- `tests/integration/restoreInterruption.test.ts`
- `tests/unit/backup.test.ts`
- `tests/unit/backupPort.test.ts`

## Test coverage

- Exact signed minor-unit parsing, negative zero, malformed input, and overflow.
- Ledger-only opening balances and exclusion from summaries, cash-flow,
  savings-rate, and budget metrics.
- Ordinary finance commands cannot edit or delete opening records.
- First-run, ready, malformed, duplicate, partial, and broken-default state
  classification.
- Atomic initialization and later account creation at all six interruption
  stages.
- Account reads, derived balances, validation, edits, transaction-locked
  currency changes, archive/default reassignment, last-active archive, and
  reactivation.
- IndexedDB v2-to-v3 migration, exact balance preservation, deterministic
  collision failure, and rollback at all migration stages.
- Backup v1-to-v2 migration, current strict validation, canonical
  serialization, restore, and collision handling.

## Verification

- Focused Task 08A suite:
  `npm test -- --run src/finance/money.test.ts src/finance/ledger.test.ts src/finance/budgets.test.ts src/application/financeService.test.ts src/application/dashboardService.test.ts src/application/initializationService.test.ts src/application/accountService.test.ts tests/integration/accountUnitOfWork.test.ts tests/integration/migrations.test.ts tests/unit/backup.test.ts tests/integration/restoreInterruption.test.ts tests/unit/backupPort.test.ts`
  — passed, 192 tests across 12 files.
- Type check: `npm run typecheck` — passed.
- Complete suite: `npm test -- --run` — passed, 256 tests across 18 files.
- Production build: `npm run build` — passed; Vite emitted the offline static
  frontend into `dist`.
- Lint: not run because the project has no lint script or configuration.

## Scope and safety

- React onboarding, Accounts UI, routing, and CSS are deferred to Task 08B.
- Tauri and native backup code were not changed.
- No Git command or Git metadata operation was used.
- The before checkpoint preserves every pre-existing risky domain, schema,
  migration, backup, and integration-test file changed by this task.

## Independent-review follow-up

Completed: 2026-07-29

All five review findings were addressed:

1. `DexieFinanceUnitOfWork` now includes the accounts store in every ledger
   write transaction and revalidates each referenced account's existence,
   active status, and currency immediately before create or replacement.
   Regression tests reproduce a stale service read followed by archival and
   prove that no transaction or audit can commit.
2. Account updates now merge editable fields onto the transaction-current
   status instead of overwriting a concurrent archive/reactivation with stale
   service data. The regression verifies both final archived status and the
   ordered archive/update audits.
3. The account UoW now accepts only a positive completed income into the new
   account or expense from the new account for opening records. It rejects
   transfers, second references, wrong direction, wrong category, zero
   amounts, currency/time mismatches, and mismatched transaction audits.
4. `AuditEntry` is now a discriminated union binding transaction actions to
   transaction entities, account actions to account entities, and the
   settings action to the primary settings entity. Current backup validation
   uses the same strict union, and restore tests prove invalid combinations
   fail after safety promotion without mutating IndexedDB.
5. Dashboard cache validation now includes the required `purpose` transaction
   key and validates its value. A populated cache-hit regression proves a
   recent standard transaction is returned without account, transaction, or
   cache-write reads.

Follow-up files:

- Modified `src/finance/types.ts`
- Modified `src/application/financeService.ts`
- Modified `src/application/dashboardService.ts`
- Modified `src/application/dashboardService.test.ts`
- Modified `src/database/unitOfWork.ts`
- Modified `src/database/accountUnitOfWork.ts`
- Modified `src/backup/schema.ts`
- Modified `tests/integration/unitOfWork.test.ts`
- Modified `tests/integration/accountUnitOfWork.test.ts`
- Modified `tests/integration/restoreInterruption.test.ts`
- Modified `tests/unit/backup.test.ts`
- Modified `docs/checkpoints/task-08a.md`

Follow-up verification:

- Focused review suite: 101 tests across 5 files passed.
- `npm run typecheck` passed.
- `npm test -- --run` passed, 256 tests across 18 files.
- `npm run build` passed and emitted the offline frontend to `dist`.
- No lint script exists.
