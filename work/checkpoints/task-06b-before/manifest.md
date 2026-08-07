# Task 06B before manifest

Captured before production implementation on 2026-07-29.

## Requested scope

- `src/platform/backupPort.ts` — absent.
- `tests/unit/backupPort.test.ts` — absent.
- `src-tauri/src/backup.rs` — absent.
- `src-tauri/src/lib.rs` — Tauri bootstrap with broad dialog, filesystem, and OS plugins; no custom commands.
- `src-tauri/capabilities/default.json` — broad dialog read/write filesystem permissions.
- `src/application/ports.ts` — automatic backup, folder selection, JSON export/import only; safety backups are not distinct.
- `src/backup/restoreService.ts` — creates restore safety snapshots through automatic-backup semantics.
- `docs/checkpoints/task-06b.md` — absent.

## Existing dependencies

- Canonical version 1 JSON backup serialization and validation are complete.
- CSV serialization is complete.
- Restore orchestration and eight-store atomic IndexedDB replacement are complete.
- The Tauri dialog plugin is already available to the native crate.

## Constraints

- Native commands form a narrow file boundary; browser code receives no general path/file access.
- Automatic and safety backup semantics are distinct.
- Final files are promoted only from a sibling partial after flush and sync.
- Automatic retention applies only to recognized automatic snapshots.
- No Git commands or `.git` metadata access.
- UI, startup scheduling, cloud synchronization, installer packaging, and unrelated work remain out of scope.
