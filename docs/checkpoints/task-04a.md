# Task 04A checkpoint: database schema and migrations

## Files

- Created `src/database/db.ts`.
- Updated `src/database/migrations.ts` only to give Dexie migration callbacks
  mutable record views; runtime behavior is unchanged.
- Created `docs/checkpoints/task-04a.md`.

## RED

Command:

`npm test -- tests/integration/migrations.test.ts`

Observed result: exit code 1. The suite failed during import because
`src/database/db.ts` did not exist, so no tests were collected. This was the
expected feature-missing failure.

The first implementation run collected all three tests: fresh creation passed,
while v1 migration and future-version recovery failed. Native IndexedDB
reported Dexie logical versions multiplied by ten (`1` as `10`, `3` as `30`).
The preflight comparison was corrected to normalize the native value.

## GREEN

Command:

`npm test -- tests/integration/migrations.test.ts`

Observed result: exit code 0, 1 test file passed, 3 tests passed.

Command:

`npm run typecheck`

Observed result: exit code 0; `tsc -b --noEmit` completed without diagnostics.

Command:

`npm test`

Observed result: exit code 0, 5 test files passed, 63 tests passed.

Command:

`npm run build`

Observed result: exit code 0; `tsc -b && vite build` completed successfully,
with 17 modules transformed.

## Test-quality follow-up

- Centralized tracking closes every legacy and production Dexie connection
  before database deletion, including when an assertion fails.
- Raw v1 before/after snapshots now include all eight stores: metadata,
  settings, accounts, transactions, budgets, audit entries, backup metadata,
  and calculation caches. The injected-failure test therefore verifies the
  complete upgrade transaction rollback, not only selected records.

Focused command:

`npm test -- tests/integration/migrations.test.ts`

Observed result: exit code 0, 1 test file passed, 8 tests passed.

Full-suite command:

`npm test`

Observed result: exit code 0, 5 test files passed, 68 tests passed.

Typecheck command:

`npm run typecheck`

Observed result: exit code 0; `tsc -b --noEmit` completed without diagnostics.

Build command:

`npm run build`

Observed result: exit code 0; `tsc -b && vite build` completed successfully,
with 17 modules transformed.

## Decisions and limitations

- Schema versions 1 and 2 are registered explicitly; v1-to-v2 work remains in
  the existing migration function and executes inside Dexie's upgrade
  transaction.
- Fresh databases receive exactly one current metadata record using the
  injected clock.
- A native, no-version IndexedDB open checks the physical version before Dexie
  can request an upgrade. Newer physical or metadata schema versions return a
  read-only recovery result without exposing a mutable database.
- Migration-open failures close the database and return recovery; IndexedDB
  aborts the upgrade transaction, preserving the prior schema and records.
- This task does not add repositories, unit-of-work behavior, or finance
  mutation APIs.
- No Git command or repository metadata access was used.

## Review follow-up RED/GREEN

Five integration tests were added before the review production change for:

- native metadata-version rejection without migration or data mutation;
- complete rollback after an injected migration failure;
- one-time fresh metadata seeding;
- exact v1/v2 store definitions; and
- preservation of existing defaults and authoritative rows during migration.

RED command:

`npm test -- tests/integration/migrations.test.ts`

Observed result: exit code 1, 8 tests total, 7 passed and 1 failed. A physical
v1 database whose metadata declared schema version 99 was upgraded and returned
as ready, proving metadata inspection occurred too late.

GREEN command:

`npm test -- tests/integration/migrations.test.ts`

Observed result: exit code 0, 1 test file passed, 8 tests passed. The native
no-version preflight now reads metadata in a readonly transaction and closes
the native connection before constructing the mutable Dexie database.

Review full-suite command:

`npm test`

Observed result: exit code 0, 5 test files passed, 68 tests passed.

Review typecheck command:

`npm run typecheck`

Observed result: exit code 0; `tsc -b --noEmit` completed without diagnostics.

Review build command:

`npm run build`

Observed result: exit code 0; `tsc -b && vite build` completed successfully,
with 17 modules transformed.
