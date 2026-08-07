# Task 12B implementation checkpoint

## Summary

- Added a fail-closed startup preparation transaction that validates current
  application metadata and settings before any cleanup. Partial initialization
  and broken default-account references enter protected recovery without
  mutating records.
- Stale calculation caches are removed only when their calculation version or
  source revision differs from current metadata. Cleanup and its interruption
  hook share one IndexedDB transaction, so interrupted cleanup rolls back.
- Production runtime construction now stops and closes the database when
  startup preparation requests recovery. No dashboard calculation or backup
  I/O is performed while constructing the runtime.
- Automatic backups now start through `requestIdleCallback` after the routed
  interface has rendered, with a cancellable zero-delay timer fallback.
  StrictMode setup/cleanup replay cannot duplicate the coordinator start.
- Added a root React error boundary with safe retry/reload actions and
  protected-data recovery copy. It never displays raw errors or offers reset
  or deletion.
- Added a narrow native-window port. Saved local preferences are clamped to
  the visible work area and restored best-effort without delaying React
  rendering; native or work-area failure leaves Windows defaults untouched.

## TDD evidence

- Startup and error-boundary tests initially failed because their modules did
  not exist.
- Routed-app tests then failed because backups still started immediately and
  twice under StrictMode.
- Production-runtime tests failed because database preparation was not wired.
- Window tests initially failed because the platform adapter did not exist.
- Strict metadata and broken-account-reference tests failed against the first
  startup implementation before the validation boundary was tightened.

## Created files

- `src/app/startup.ts`
- `src/app/startup.test.ts`
- `src/app/ErrorBoundary.tsx`
- `src/app/ErrorBoundary.test.tsx`
- `src/platform/windowPort.ts`
- `src/platform/windowPort.test.ts`
- `work/checkpoints/task-12b-before/manifest.md`

## Modified files

- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/app/productionRuntime.ts`
- `src/app/productionRuntime.test.ts`
- `src/main.tsx`

## Verification

- Focused Task 12B suite: 6 test files, 17 tests passed.
- TypeScript type check: passed.
- Complete Vitest suite: 46 test files, 547 tests passed after review
  correction.
- Production Vite build: passed.
- The existing startup chunk-size advisory remains deferred to the performance
  task.

## Scope

- No Git metadata was read or modified.
- No finance-engine calculation, native Rust command, database schema, backup
  envelope, or installer configuration was changed.

## Independent-review correction

- Locale validation now requires a primitive string before calling
  `Intl.getCanonicalLocales`, and rejects empty, padded, control-containing,
  array, boxed-string, and object candidates through the typed
  `INVALID_LOCALE` boundary.
- Startup regression coverage seeds a corrupted IndexedDB locale array and
  proves preparation enters protected recovery while leaving pre-existing
  calculation caches untouched.
- Review-correction focused suite: 2 test files, 20 tests passed.
- Created
  `work/checkpoints/task-12b-review-fix-before/manifest.md` before the
  correction.
