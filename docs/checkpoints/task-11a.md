# Task 11A implementation checkpoint

## Summary

- Added IndexedDB-authoritative settings with a 6/12/24/168-hour automatic
  backup interval, defaulting to 24 hours through the rollback-safe v5
  migration.
- Added optimistic settings replacement using the expected settings record
  and metadata revision in one Dexie transaction. The transaction bumps the
  revision and invalidates calculation caches without rewriting ledger rows.
- Added canonical locale, date-format, currency, interval, and backup-folder
  validation. Changing the display base currency requires the explicit
  `acknowledgeNoConversion` option.
- Upgraded the strict backup envelope to v4 (database schema v5), including
  v1-v3 migrations and strict backup-status error/warning invariants.
- Added durable warning metadata behavior while preserving the last successful
  backup directory and timestamp across later failures.
- Added robust localStorage preferences v2 for theme, density, sidebar,
  display currency, and bounded window state, with safe v1 migration.
- Added the non-React data-management service for canonical manual JSON
  export, deterministic all-ledger CSV export, folder choose/reset, private
  restore candidates, exact typed confirmation, configured safety-backup
  location, atomic restore, and reload-required results.
- Restore candidate data remains private canonical JSON; selecting or
  dismissing a candidate invalidates the previous candidate. localStorage is
  outside backup and restore payloads.

## Created files

- `src/application/settingsService.ts`
- `src/application/settingsService.test.ts`
- `src/application/dataManagementService.ts`
- `src/application/dataManagementService.test.ts`
- `src/database/settingsUnitOfWork.ts`
- `tests/integration/settingsUnitOfWork.test.ts`
- `tests/unit/preferences.test.ts`
- `work/checkpoints/task-11a-before/manifest.md`

## Modified files

- `index.html`
- `src/application/initializationService.ts`
- `src/application/initializationService.test.ts`
- `src/application/ports.ts`
- `src/application/validation.ts`
- `src/application/budgetService.test.ts`
- `src/application/dashboardService.test.ts`
- `src/application/dashboardService.task10b.test.ts`
- `src/backup/restoreService.ts`
- `src/backup/schema.ts`
- `src/database/backupRepository.ts`
- `src/database/db.ts`
- `src/database/migrations.ts`
- `src/database/schema.ts`
- `src/finance/types.ts`
- `src/platform/backupPort.ts`
- `src/stores/preferences.ts`
- `tests/integration/migrations.test.ts`
- `tests/unit/backup.test.ts`
- `tests/unit/backupPort.test.ts`

## Verification

- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

The final verification output is recorded in the task handoff.

## Independent-review corrections

- The v4-to-v5 database migration now rejects invalid pre-existing backup
  intervals, unsafe or negative metadata revisions, stale calculation
  versions, invalid backup status/error combinations, and invalid metadata
  schema records. Every rejected migration is covered by rollback assertions.
- Legacy idle/success backup metadata has stale error and warning fields
  removed during migration; valid failure metadata is preserved.
- Current v4 backup settings now enforce supported currencies and the same
  bounded, nonempty, control-character-free backup folder policy as the
  settings use case. Restore interruption coverage proves rejection occurs
  without IndexedDB replacement.
- The settings boundary rejects unknown runtime fields and unsafe default
  account identifiers, then constructs a new record from only approved fields.
- JSON snapshot failures, transaction-query failures, CSV serialization
  failures, and native export failures all resolve through the same closed,
  path-safe result union.
- Parsed but structurally invalid v2 preference values, including `{}` and
  `[]`, now fall through to a valid legacy v1 record before defaults.
