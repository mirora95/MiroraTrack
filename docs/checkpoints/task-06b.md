# Task 06B checkpoint

## Scope

Implemented the native Tauri backup/file boundary and its TypeScript adapter and
automatic-backup metadata orchestration. UI, startup scheduling, cloud sync, and
installer behavior remain outside this task.

## Changes

- Added a closed backup error-code union and distinct automatic and safety
  backup operations to the application port.
- Changed restore safety promotion to call `createSafetyBackup`, keeping safety
  snapshots separate from automatic rotation and user-facing automatic status.
- Added a Tauri adapter for the five bounded commands:
  `choose_backup_directory`, `create_backup`, `export_json`, `export_csv`, and
  `import_json`.
- Added canonical JSON routing, CSV routing, nullable dialog cancellation,
  stable native-error mapping, safe-message handling, and typed retention
  warnings.
- Added automatic-backup metadata orchestration that records every attempt,
  records successful folder/schema/time facts, and preserves the last successful
  time and folder after later failures.
- Added a native default of the OS Documents directory joined with
  `MiroraTrack\Backups`, plus canonical validation for explicitly configured
  absolute directories.
- Added Windows-safe unique automatic and safety filenames, sibling partial
  creation with `create_new`, full write, flush, `sync_all`, non-overwrite
  promotion, and best-effort cleanup of only the operation's partial file.
- Added exact automatic filename recognition and deterministic newest-ten
  retention. Safety, malformed, unrelated, non-file, and symlink entries are
  ignored, including Windows reparse-point entries. Retention failure returns a warning after the new backup remains
  successful.
- Added bounded manual JSON/CSV save dialogs with non-overwrite behavior and a
  JSON import dialog restricted to regular `.json` files no larger than 100 MiB.
- Removed the general filesystem and OS plugins from the Rust bootstrap and
  removed broad dialog/filesystem/OS capability grants from the frontend.

## TDD and coverage

- TypeScript tests first failed because the platform adapter did not exist and
  restore still called automatic-backup semantics.
- Restore tests then passed after introducing the distinct safety operation.
- A JSON-import test failed while the adapter still returned raw text, then
  passed after bounded JSON parsing was added.
- A metadata regression test failed while a stale prior error message survived,
  then passed after failure records were rebuilt from only durable prior facts.
- Rust unit tests were authored for exact automatic filename parsing,
  deterministic retention, invalid configured paths, collision preservation,
  and promotion-failure preservation.

## Verification

- `npm test -- --run tests/unit/backupPort.test.ts tests/integration/restoreInterruption.test.ts`
  — 2 files, 21 tests passed.
- `npm run typecheck` — passed.
- `npm test -- --run` — 13 files, 173 tests passed.
- `npm run build` — passed; Vite production bundle generated.
- `cargo fmt --check`, `cargo test`, and `cargo check` — not run because
  `cargo`, `rustc`, and `rustup` are unavailable on this machine.

## Native verification status

The Rust implementation and five native unit tests are authored but native
formatting, compilation, and execution remain explicitly unverified until a
Rust/MSVC Windows toolchain is installed. No native pass claim is made.

## Files

Created:

- `src/platform/backupPort.ts`
- `tests/unit/backupPort.test.ts`
- `src-tauri/src/backup.rs`
- `work/checkpoints/task-06b-before/manifest.md`
- `docs/checkpoints/task-06b.md`

Modified:

- `src/application/ports.ts`
- `src/backup/restoreService.ts`
- `tests/integration/restoreInterruption.test.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/default.json`

No Git commands or Git metadata changes were made.
