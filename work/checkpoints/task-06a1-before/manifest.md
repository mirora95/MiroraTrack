# Task 06A1 before manifest

Captured from the pre-implementation inspection on 2026-07-28.

## Requested scope

- `src/backup/schema.ts` — absent.
- `src/backup/serialize.ts` — absent.
- `src/export/csv.ts` — absent.
- `tests/unit/backup.test.ts` — absent.
- `tests/unit/csv.test.ts` — absent.
- `src/application/ports.ts` — contained a generic collection-record
  `BackupPayload`.
- `docs/checkpoints/task-06a1.md` — absent.

## Existing dependencies inspected

- `src/finance/types.ts` defines all eight persisted entity types, branded IDs,
  discriminated transactions, and the current application metadata schema.
- `src/application/ports.ts` defines the existing backup operations.
- Zod is already a production dependency.

## Constraints

- Tests must be observed failing before production implementation.
- Changes are limited to Task 06A1 backup schema/serialization, CSV, tests, the
  targeted backup payload port type, and checkpoint artifacts.
- Restore, browser/platform integration, Rust, and dependency restore are
  excluded.
- No Git commands or `.git` metadata access.
