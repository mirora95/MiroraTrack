# Task 12A implementation checkpoint

## Summary

- Added a single automatic-backup coordinator per production runtime with
  idempotent start/stop, activation listeners, observable status, manual
  retry, and restore-aware pause/resume behavior.
- Automatic scheduling is derived from persisted settings and backup
  metadata. Missing or overdue success runs after activation; warning results
  count as successful snapshots; failures use a bounded one-minute cooldown.
  Scheduling uses recalculated one-shot timers rather than a drifting
  interval.
- Successful structured mutations notify the coordinator only after their
  atomic application operation resolves. Reads, exports, cancelled folder
  selection, and failed mutations do not notify it.
- Mutation notifications debounce for five seconds. Concurrent attempts share
  one promise, and changes during an in-flight backup produce one coalesced
  trailing run.
- Automatic-backup failures are isolated from finance/UI operations.
  Subscriber failures are also isolated from persistence.
- Restore waits for any active automatic snapshot, discards pending dirty
  work, resumes scheduling after restore failure, and remains stopped after a
  successful restore while the application requires reload.
- The routed application owns coordinator start/stop. The implementation is
  safe under React StrictMode stop/start replay, including replay while a
  backup is in flight.
- Wired the existing Settings retry control to the coordinator and exposed a
  narrow lifecycle/status subscription surface through the application
  runtime.

## TDD evidence

- The first coordinator run failed because `src/backup/automaticBackup.ts`
  did not exist.
- Runtime mutation tests then failed because the decorator did not exist.
- StrictMode in-flight restart and missing-onboarding-settings tests failed
  against the first implementation, exposing a lost-reschedule path and an
  unhandled rejection. Both received focused corrections.
- Subscriber-isolation failed before listener errors were contained.

## Created files

- `src/backup/automaticBackup.ts`
- `src/backup/automaticBackup.test.ts`
- `src/app/automaticBackupRuntime.test.ts`
- `work/checkpoints/task-12a-before/manifest.md`

## Modified files

- `src/app/runtime.tsx`
- `src/app/productionRuntime.ts`
- `src/app/productionRuntime.test.ts`
- `src/app/App.tsx`
- `src/app/App.test.tsx`

## Scope

- No native Tauri command, Rust source, database schema, backup envelope,
  finance-engine calculation, or broad Settings visual design was changed.
- No Git metadata was read or modified.

## Fresh verification

- Focused coordinator/runtime/application suite: 7 test files, 35 tests
  passed.
- TypeScript type check: passed.
- Complete Vitest suite: 43 test files, 529 tests passed.
- Production Vite build: passed.
- The existing startup chunk-size advisory remains deferred to the
  performance task.

## Independent review corrections

- `retryNow()` now returns a safe discriminated outcome for success, warning,
  or failure. Snapshot, native-adapter, and metadata-persistence exceptions
  are contained and converted to a non-sensitive `UNKNOWN` failure outcome;
  they still publish a visible failed coordinator status.
- Terminal statuses remain observable while the coordinator calculates and
  exposes the next eligible run, including the one-minute failure cooldown
  and mutation debounce.
- The Settings page subscribes to the live coordinator status, passes its
  `nextEligibleAt` value to the backup panel, refreshes persisted metadata
  after each terminal status, isolates refresh failures, and invalidates both
  subscriptions and stale async refreshes on unmount.
- Retry notices now describe the actual result instead of reporting
  unconditional completion.
- Added regression coverage for success/warning/failure retry outcomes,
  thrown internal failures, metadata-persistence failure visibility, live
  status updates, next eligibility, terminal metadata refresh, and cleanup.

## Review-correction files

- Modified: `src/backup/automaticBackup.ts`
- Modified: `src/backup/automaticBackup.test.ts`
- Modified: `src/app/runtime.tsx`
- Modified: `src/app/App.tsx`
- Modified: `src/features/settings/BackupPanel.tsx`
- Modified: `src/features/settings/BackupPanel.test.tsx`
- Modified: `src/features/settings/SettingsPage.tsx`
- Modified: `src/features/settings/SettingsPage.test.tsx`
- Created: `work/checkpoints/task-12a-review-fixes-before/` (recoverable
  pre-change copies use `.bak` suffixes so Vitest and TypeScript ignore them)
