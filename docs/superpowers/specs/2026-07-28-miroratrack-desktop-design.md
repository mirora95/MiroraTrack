# MiroraTrack Desktop — Product and Technical Design

## 1. Purpose

MiroraTrack is a local-first personal finance application for Windows 10/11 x64. It launches from a desktop or Start menu shortcut into its own native window, works entirely offline, and preserves user data across launches without a backend, browser tab, local server, or terminal.

The first release includes onboarding, accounts, income, expenses, transfers, budgets, a real-data dashboard, activity history, settings, automatic backups, JSON export/import, CSV export, and Windows installation. Windows ARM64 packaging can be added later without changing application code.

## 2. Experience and Visual Identity

MiroraTrack should feel like a polished commercial desktop product inspired by Linear, Stripe, Apple, and Arc Browser without imitating them.

- Midnight Blue `#0F172A` anchors a subtly graduated sidebar.
- Professional Blue `#2563EB` is the primary action and active-navigation color.
- Teal `#0F766E` represents secondary actions.
- Gold `#F59E0B` represents savings, highlights, and achievements.
- Purple represents investments and future wealth-building features.
- Green is reserved for income and success.
- Red is reserved for expenses and errors.
- Orange is reserved for warnings.
- White and soft-gray surfaces, 16–20 px corner radii, refined shadows, elegant typography, and restrained gradients establish visual depth.
- The active sidebar item uses a blue accent line, softly elevated background, and smooth transition.
- Lucide icons provide consistent iconography.
- Charts support hover details and drill-down into filtered transactions.
- Empty states are intentional compositions with a clear explanation and useful next action.
- Light and dark themes share the same visual hierarchy. Dark mode uses layered midnight/navy surfaces rather than flat black.
- Motion respects reduced-motion preferences and never blocks use.

The desktop layout uses a collapsible sidebar, global header, summary cards, chart and budget panels, recent activity, and quick-add controls. The responsive design remains usable in narrow native windows.

## 3. Primary User Flows

### First launch

1. Show a welcome screen and privacy statement.
2. Select base currency and date format.
3. Create the first account with its own currency.
4. Optionally load demo data.
5. Open the dashboard.

### Record income or expense

1. Open the global quick-add action.
2. Choose income or expense.
3. Enter amount, account, category, date, and optional description.
4. Validate the form.
5. Commit the transaction and audit entry atomically.
6. Refresh ledger-derived balances, budgets, and dashboard metrics.

### Transfer

1. Select distinct source and destination accounts.
2. Enter the amount and optional note.
3. Commit the transfer records and audit entry atomically.
4. Derive both account balances from the ledger.
5. Exclude the transfer from income, expense, and budget spending totals.

### Backup and restore

1. Create rotating automatic snapshots in the configured local backup folder.
2. Show the configured folder and last successful backup status.
3. Allow manual JSON export through a native file dialog.
4. For restore, validate schema and content before mutation.
5. Preview counts and compatibility.
6. Create a safety snapshot.
7. Require explicit replacement confirmation.
8. Replace data atomically and show a summary.

## 4. Architecture

The application uses React, TypeScript, Vite, and Tauri. The finance engine is a framework-independent TypeScript module with no React, IndexedDB, Tauri, or platform imports.

```text
React UI
  -> application services / use cases
    -> finance engine (pure rules and calculations)
    -> repository interfaces
      -> IndexedDB repositories
    -> platform interfaces
      -> Tauri file and backup adapter
      -> browser-compatible test adapter
```

UI components never write IndexedDB directly. Application services orchestrate validation, finance rules, persistence, audit records, cache invalidation, and platform actions.

Repository interfaces isolate persistence so a future synchronization coordinator can combine local and remote repositories without changing the finance engine or UI. Platform-specific file and packaging code remains behind small adapters. ARM64 support therefore requires a Rust target and packaging job, not application changes.

## 5. Data Model and Ledger Rules

Transactions are the authoritative financial ledger. Account balances, budget totals, dashboard metrics, and reports are derived values.

Core entities:

- `AppMetadata`: schema and calculation versions.
- `Settings`: base currency, locale, date format, theme, density, sidebar state, and backup preferences.
- `Account`: type, name, account currency, opening balance in minor units, status, and timestamps.
- `Transaction`: type, status, amount in minor units, currency, date, source/destination references, category, description, and timestamps.
- `Budget`: period, category scope, amount in minor units, and rollover preference.
- `AuditEntry`: timestamp, action, entity identifiers, and non-secret change summary.
- `BackupMetadata`: path, completion status, last successful time, error summary, and schema version.
- `CalculationCache`: calculation version, source revision, key, and rebuildable result.

Money is stored as integer minor units. Raw floating-point arithmetic is not used for ledger effects. A base currency is stored in settings and every account stores a currency so later multi-currency behavior can be introduced without remodeling accounts.

Financial effects:

- Completed income increases its destination account.
- Completed expense decreases its source account.
- Completed transfer decreases the source and increases the destination while contributing zero income and zero expense.
- Editing or deleting a transaction changes the authoritative ledger record; derived values are then invalidated or rebuilt.
- Cancelled items do not affect actual totals.

Every financial mutation and its audit entry use one IndexedDB transaction. Partial writes are forbidden. Cached calculations include a version and source revision and must always be rebuildable from settings, accounts, budgets, and transactions.

## 6. Local Persistence

IndexedDB stores structured records: metadata, accounts, transactions, budgets, audit entries, backup metadata, and rebuildable caches. localStorage stores lightweight preferences such as theme, selected display currency, table density, collapsed navigation state, and window preferences.

Database access is versioned. Each schema upgrade has an explicit migration, validation, and rollback-safe failure path. Unknown newer schemas are not opened for mutation. Migration failures preserve the previous database and provide recovery guidance.

## 7. Backup, Import, and Export

The default automatic backup location is:

`Documents\MiroraTrack\Backups`

MiroraTrack retains the latest ten automatic JSON snapshots. Users can select an alternative folder through a native folder dialog.

Backup folder access can fail because of permissions, removal, external storage availability, or OS policy. Such failures never block normal finance operations. The application shows:

- last successful backup time;
- configured folder;
- current failure in plain language;
- retry action;
- choose-another-folder action;
- manual export fallback.

The JSON backup format includes application name, schema version, exported timestamp, and typed record collections. Import validates structure, supported schema, references, and money fields before any mutation. Replacement creates a safety snapshot and uses an atomic database operation.

CSV export supports all transactions and the current filtered transaction view. CSV serialization uses stable headers, safe quoting, ISO dates, and human-readable decimal amounts derived from minor units.

## 8. Reliability and Error Handling

- Storage-unavailable, quota, corruption, migration, file permission, and restore errors have non-technical messages and recovery actions.
- Financial operation failures leave the previous ledger and audit history unchanged.
- Interrupted restores never expose a partially replaced database.
- Interrupted backups may leave an incomplete temporary file, but never replace the latest valid snapshot. A completed backup is promoted atomically where supported.
- UI form state is retained after recoverable failures.
- The application records backup health without logging secret or sensitive values.
- Error boundaries provide a safe restart path without clearing data.

## 9. Windows Packaging and Data Lifecycle

Tauri produces an NSIS `.exe` installer for Windows 10/11 x64 with:

- a native application window;
- application icon;
- desktop shortcut support;
- Start menu shortcut support;
- upgrade and repair/reinstall behavior;
- application version metadata.

Application updates preserve IndexedDB, localStorage preferences, user-selected backup folders, and backup files. Repair or reinstall must not clear finance data.

Uninstalling the application never removes finance records or backups without separate, explicit user confirmation. The default uninstaller leaves application data intact and documents its location. Data removal, if offered, is a distinct opt-in action with a strong warning.

Code signing is supported by configuration but is not required to produce a local installer. Unsigned builds may display Windows reputation warnings.

## 10. Accessibility and Interaction

- Semantic controls, keyboard navigation, visible focus rings, accessible dialog focus management, and announced validation errors are required.
- Charts include textual summaries and drill down to an accessible transaction table.
- Color is never the only status indicator.
- Global shortcuts do not activate while typing in form fields.
- Touch targets remain comfortable in narrow windows.
- High-contrast and reduced-motion system settings are respected.

## 11. Verification Strategy

### Unit tests

- Income and expense balance effects.
- Transfer effects on both accounts and exclusion from income/expense.
- Editing and deleting ledger entries.
- Budget totals excluding transfers.
- Minor-unit arithmetic and formatting.
- Cache invalidation and full ledger rebuild.
- Backup schema validation and CSV serialization.
- Migration of older supported database versions.

### Interruption and integrity tests

- Abort each financial operation before commit and verify no partial record or audit entry exists.
- Interrupt restore before atomic replacement and verify the previous database remains complete.
- Interrupt backup before promotion and verify the latest valid backup remains readable.
- Simulate unavailable and permission-denied backup folders.
- Verify corrupted and newer unsupported schemas fail closed.

### UI tests

- Complete onboarding.
- Create account.
- Add income and expense.
- Create transfer.
- Create budget.
- Export JSON and CSV.
- Restore a valid backup.
- Recover from backup-folder failure and choose a different folder.

### Installer lifecycle verification

- Clean install creates the app, desktop shortcut, and Start menu shortcut.
- Installed app launches without a server or terminal.
- Create finance data, close, reopen, and verify persistence.
- Upgrade from the previous installer preserves data and backups.
- Repair/reinstall preserves data and settings.
- Uninstall leaves finance data and backups intact by default.
- Reinstall after uninstall reconnects to preserved local data.

## 12. Delivery

The repository will include:

- complete source code;
- generated application icon assets;
- unit and UI tests;
- a production build;
- an x64 Windows `.exe` installer when the local toolchain permits packaging;
- README instructions for development, testing, installer generation, code signing configuration, backup behavior, data locations, upgrades, and uninstall data preservation.

No public deployment is created.
