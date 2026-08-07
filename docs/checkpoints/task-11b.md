# Task 11B implementation checkpoint

## Summary

- Replaced the Settings placeholder with a premium, responsive settings
  workspace for appearance, density, locale, date format, base currency, and
  automatic-backup preferences.
- Base-currency changes display the no-conversion warning and require an
  explicit acknowledgement before the application service is called.
- Added backup health, configured/default folder display, last-attempt,
  last-success, calculated next-attempt, choose/reset folder, manual JSON
  export, all-ledger CSV export, and a disabled Task 12 retry interface.
- Added a restore dialog that selects and validates before preview, shows
  schema/timestamp/record counts, requires the exact `REPLACE MY DATA` phrase,
  prevents dismissal during replacement, and converts failures to fixed,
  path-safe messages.
- Restore completion replaces the application shell with a reload-required
  summary. Finance navigation remains unavailable until the user chooses the
  single `Restart MiroraTrack` action.
- Added synchronous operation guards and generation-token invalidation for
  file pickers, dismissals, new selections, refreshes, and unmounts.
- Composed `SettingsService`, `DataManagementService`, `RestoreService`, and
  their Dexie/native adapters in the production runtime without importing
  database or Tauri code into React features.

## Created files

- `src/features/settings/SettingsPage.tsx`
- `src/features/settings/BackupPanel.tsx`
- `src/features/settings/RestoreDialog.tsx`
- `src/features/settings/SettingsPage.test.tsx`
- `src/features/settings/RestoreDialog.test.tsx`
- `work/checkpoints/task-11b-before/manifest.md`

## Modified files

- `src/app/App.tsx`
- `src/app/runtime.tsx`
- `src/app/productionRuntime.ts`
- `src/app/productionRuntime.test.ts`
- `src/app/App.test.tsx`
- `src/app/AppShell.test.tsx`
- `src/features/onboarding/OnboardingPage.test.tsx`
- `src/i18n/en.ts`
- `src/styles/index.css`

## Scope

- No scheduler, startup coordinator, native command, database schema, backup
  schema, or finance-engine file was changed.
- No Git metadata was read or modified.
- The Task 12 automatic-backup coordinator can supply
  `retryAutomaticBackup`; until then the visible retry control is disabled
  with an explanatory tooltip.

## Verification

- Focused settings/runtime/architecture tests
- TypeScript type check
- Complete Vitest suite
- Production Vite build

The production build retains the existing advisory for a startup chunk above
500 kB. Visual browser inspection was not part of this implementation agent's
automated verification; the independent review should include a visual pass.

## Independent-review corrections

- Replaced the Settings-only currency list with the finance engine's single
  `SUPPORTED_CURRENCY_CODES` source. Both base and display controls now expose
  exactly `USD`, `EUR`, `GBP`, `UZS`, and `JPY`.
- Added a distinct device-local Display currency control wired to the
  preference store's `selectedDisplayCurrency` setter and v2 localStorage
  persistence. It does not mutate the authoritative base currency setting.
- Restore failures now invalidate the selected candidate, clear its preview
  and confirmation, retain only a path-safe alert, and require the user to
  select and validate a new candidate before another restore.
- Next automatic-backup timing is derived from `lastSuccessfulAt`, never
  `lastAttemptAt`. A missing success is due on the next application start; an
  elapsed success interval is explicitly shown as overdue and due for retry on
  the next start.

### Additional created file

- `src/features/settings/BackupPanel.test.tsx`

### Additional modified files

- `src/features/settings/SettingsPage.tsx`
- `src/features/settings/SettingsPage.test.tsx`
- `src/features/settings/RestoreDialog.tsx`
- `src/features/settings/RestoreDialog.test.tsx`
- `src/features/settings/BackupPanel.tsx`
- `docs/checkpoints/task-11b.md`

### Fresh verification after corrections

- Focused Settings, Restore, runtime, service, persistence, and architecture
  gate: 8 test files, 36 tests passed.
- TypeScript type check: passed.
- Complete Vitest suite: 41 test files, 504 tests passed.
- Production Vite build: passed.
- The pre-existing startup chunk-size advisory remains deferred to the
  performance task.
