# Task 06A2 checkpoint

## Scope

Implemented restore safety orchestration and atomic IndexedDB replacement. Native
backup file handling and Rust remain outside this task.

## Changes

- Added a narrow `DbBackupPort` for canonical snapshots and atomic replacement,
  plus an exact eight-collection restore-count result.
- Added a Dexie backup repository that snapshots all eight stores in one
  read-only transaction and validates the resulting envelope.
- Added one read/write replacement transaction spanning all eight stores. It
  clears every store, bulk-adds the seven authoritative imported collections,
  and clears rebuildable calculation caches inside the same transaction.
- Added synchronous concrete repository hooks after clears and before commit for
  deterministic rollback testing without exposing test controls through the
  application port.
- Added restore orchestration in the required order: snapshot current data,
  promote a durable automatic safety backup, parse/validate/migrate imported
  unknown data in memory, atomically replace data, then return committed counts.
- A failed safety backup aborts before imported-input parsing and before any
  database mutation.

## TDD evidence

- The focused test first failed because `restoreService.ts` and
  `backupRepository.ts` did not exist.
- The minimal implementation then passed the initial eight restore tests.
- Additional invalid-record and required-metadata cases brought the focused
  suite to ten tests.
- Typecheck then exposed erasable-syntax and Dexie positional-overload limits;
  explicit constructor fields and table-array transactions resolved both.

## Coverage

- Successful full replacement, cache invalidation, and count summary.
- Canonical current-state safety snapshot.
- Safety-backup failure and invalid import after safety promotion.
- Interruptions before safety, after safety/before database replacement, after
  clears, and before commit.
- Rollback on duplicate-key bulk collision and invalid IndexedDB records.
- Required metadata enforcement during snapshots.
- Unique fake IndexedDB names and cleanup between tests.

## Boundaries

- No Rust, Tauri command, native folder, or platform adapter changes.
- No dependency restore.
- No Git commands or `.git` metadata access.
