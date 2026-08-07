# Task 06A2 before manifest

Captured before production implementation on 2026-07-28.

## Requested scope

- `src/backup/restoreService.ts` — absent.
- `src/database/backupRepository.ts` — absent.
- `tests/integration/restoreInterruption.test.ts` — absent.
- `src/application/ports.ts` — backup file operations only; no database backup port.
- `docs/checkpoints/task-06a2.md` — absent.

## Existing dependencies

- Backup schema strictly validates a canonical version 1 envelope with all eight stores.
- `MiroraTrackDatabase` exposes typed Dexie tables for those eight stores.
- `BackupPort.createAutomaticBackup` returns a typed success/failure result.

## Constraints

- Snapshot and durable safety promotion happen before imported input parsing.
- All eight stores are replaced in one Dexie read/write transaction.
- Calculation caches are cleared in that same transaction instead of restoring imported caches.
- Interruption hooks are synchronous and test-only concrete options.
- No Rust or platform adapter work.
- No Git commands or `.git` metadata access.
