# MiroraTrack Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package a premium, fully offline Windows 10/11 x64 personal-finance desktop application with ledger-derived balances, atomic local persistence, automatic backups, imports/exports, and upgrade-safe installation.

**Architecture:** A pure TypeScript finance engine sits behind application use cases and repository interfaces. React consumes those use cases; Dexie implements the IndexedDB unit of work, and a narrow Tauri adapter implements native file and backup behavior. All derived values are rebuildable from the transaction ledger, and Windows/ARM packaging remains separate from application code.

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, Tailwind CSS 4, React Router, Zustand, Dexie/IndexedDB, Zod, React Hook Form, Recharts, Lucide React, date-fns, Vitest, Testing Library, Playwright, Rust/Cargo, NSIS.

---

## File Map

```text
src/
  app/                 routing, providers, shell, startup
  components/          reusable visual primitives
  features/            dashboard, onboarding, accounts, transactions, budgets, activity, settings
  finance/             pure ledger types, money rules, calculations
  application/         use cases, ports, errors
  database/            Dexie schema, repositories, migrations, unit of work
  platform/            Tauri and browser-test adapters
  backup/              backup schema, validation, serialization
  export/              CSV serialization
  stores/              UI-only Zustand state
  i18n/                English message dictionary
  styles/              tokens, themes, motion, layout
src-tauri/
  src/                 native backup/file commands
  capabilities/        least-privilege Tauri permissions
  icons/               generated Windows icons
tests/
  unit/                finance, backup, migration, export tests
  integration/         IndexedDB interruption and atomicity tests
  ui/                  Testing Library flows
  e2e/                 installed-app and browser-harness flows
scripts/
  verify-installer.ps1 installer lifecycle checks
```

### Task 1: Scaffold the React and Tauri workspace

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/lib.rs`
- Create: `vitest.config.ts`

- [ ] **Step 1: Initialize the Sites React/Vite project once**

Run the Sites initializer exactly once against the repository root, retain its package manager, and then add Tauri:

```powershell
npm install
npm install @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/plugin-fs @tauri-apps/plugin-os
npm install dexie zod zustand react-router-dom react-hook-form @hookform/resolvers recharts lucide-react date-fns
npm install -D @tauri-apps/cli vitest @vitest/coverage-v8 fake-indexeddb @testing-library/react @testing-library/user-event @testing-library/jest-dom playwright
```

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 2: Add smoke test before application implementation**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

it("renders the MiroraTrack product name", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "MiroraTrack" })).toBeVisible();
});
```

- [ ] **Step 3: Run the smoke test and verify failure**

Run: `npm test -- --run src/app/App.test.tsx`

Expected: FAIL because `App` is not implemented.

- [ ] **Step 4: Implement the minimal application shell**

Create `src/app/App.tsx`:

```tsx
export function App() {
  return <h1>MiroraTrack</h1>;
}
```

Create `src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
```

- [ ] **Step 5: Configure the native bundle**

Set `identifier` to `com.miroratrack.desktop`, product name to `MiroraTrack`, frontend output to `../dist`, window size to 1440×920 with a 1080×720 minimum, and NSIS as the Windows bundle target. Set the updater and uninstall behavior so application data directories are not deleted.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- --run
npm run build
npx tauri info
```

Expected: tests PASS, Vite build succeeds, and Tauri reports the Windows x64 toolchain.

Commit: `git commit -am "chore: scaffold MiroraTrack desktop app"`

### Task 2: Define money, account, transaction, and settings contracts

**Files:**
- Create: `src/finance/types.ts`
- Create: `src/finance/money.ts`
- Create: `src/finance/money.test.ts`
- Create: `src/application/ports.ts`
- Create: `src/i18n/en.ts`

- [ ] **Step 1: Write failing minor-unit tests**

```ts
import { formatMinor, parseMajor } from "./money";

it("parses decimal text without floating point drift", () => {
  expect(parseMajor("10.29", 2)).toBe(1029);
});

it("formats minor units", () => {
  expect(formatMinor(1029, "USD", "en-US")).toBe("$10.29");
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/finance/money.test.ts`

Expected: FAIL because the money functions do not exist.

- [ ] **Step 3: Implement typed contracts**

Define branded `MinorAmount`, `CurrencyCode`, `AccountId`, and `TransactionId` types. Define `Account`, `Transaction`, `Budget`, `AuditEntry`, `Settings`, `BackupMetadata`, and `CalculationCache`. Transaction types are `income | expense | transfer`; statuses are `completed | planned | cancelled`.

Implement `parseMajor` with string normalization and integer digit assembly, and implement `formatMinor` by dividing only for presentation through `Intl.NumberFormat`.

- [ ] **Step 4: Define application ports**

```ts
export interface FinanceUnitOfWork {
  createTransaction(input: Transaction, audit: AuditEntry): Promise<void>;
  replaceTransaction(previousId: TransactionId, next: Transaction, audit: AuditEntry): Promise<void>;
  deleteTransaction(id: TransactionId, audit: AuditEntry): Promise<void>;
}

export interface BackupPort {
  createAutomaticBackup(payload: BackupEnvelope): Promise<BackupResult>;
  chooseBackupFolder(): Promise<string | null>;
  exportJson(payload: BackupEnvelope): Promise<void>;
  importJson(): Promise<unknown | null>;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/finance/money.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: define finance domain contracts"`

### Task 3: Implement the authoritative ledger engine

**Files:**
- Create: `src/finance/ledger.ts`
- Create: `src/finance/ledger.test.ts`
- Create: `src/finance/budgets.ts`
- Create: `src/finance/budgets.test.ts`

- [ ] **Step 1: Write failing ledger tests**

Cover:

```ts
expect(deriveBalance(checking, [income(500_00)])).toBe(500_00);
expect(deriveBalance(checking, [expense(125_50)])).toBe(-125_50);
expect(deriveBalance(source, [transfer(source, target, 200_00)])).toBe(-200_00);
expect(deriveBalance(target, [transfer(source, target, 200_00)])).toBe(200_00);
expect(summarize([transfer(source, target, 200_00)])).toEqual({ income: 0, expenses: 0 });
expect(summarize([cancelledExpense(40_00)])).toEqual({ income: 0, expenses: 0 });
```

Add a budget test proving transfers are excluded.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/finance/ledger.test.ts src/finance/budgets.test.ts`

Expected: FAIL because ledger functions do not exist.

- [ ] **Step 3: Implement pure calculations**

Implement:

```ts
deriveBalance(account, transactions): MinorAmount
deriveBalances(accounts, transactions): Map<AccountId, MinorAmount>
summarize(transactions, range?): { income; expenses; netCashFlow }
calculateBudgetUsage(budget, transactions, range): MinorAmount
```

Filter actual calculations to completed records. Keep all functions deterministic and side-effect free.

- [ ] **Step 4: Add edit/delete reversal tests**

Test that replacing an expense amount changes the rebuilt balance exactly once and removing it restores the prior balance.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/finance`

Expected: all finance tests PASS.

Commit: `git commit -am "feat: implement ledger-derived finance engine"`

### Task 4: Build versioned IndexedDB persistence and migrations

**Files:**
- Create: `src/database/db.ts`
- Create: `src/database/schema.ts`
- Create: `src/database/migrations.ts`
- Create: `src/database/repositories.ts`
- Create: `src/database/unitOfWork.ts`
- Create: `tests/integration/unitOfWork.test.ts`
- Create: `tests/integration/migrations.test.ts`

- [ ] **Step 1: Write atomicity tests with fake IndexedDB**

Create a unit of work, inject a failure after the transaction record is staged but before the audit record is staged, and assert both stores remain unchanged.

```ts
await expect(uow.createTransaction(tx, audit, { failAt: "beforeAudit" })).rejects.toThrow();
expect(await db.transactions.count()).toBe(0);
expect(await db.auditEntries.count()).toBe(0);
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run tests/integration/unitOfWork.test.ts`

Expected: FAIL because the database and unit of work do not exist.

- [ ] **Step 3: Implement Dexie schema and atomic unit of work**

Create stores for metadata, settings, accounts, transactions, budgets, audit entries, backup metadata, and calculation caches. Wrap each financial operation in:

```ts
db.transaction("rw", db.transactions, db.auditEntries, db.metadata, async () => {
  await mutateLedger();
  await db.auditEntries.add(audit);
  await bumpLedgerRevision();
  await db.calculationCaches.clear();
});
```

- [ ] **Step 4: Write and implement migration tests**

Seed schema version 1, open with version 2, verify every record survives and receives new required defaults. Seed a newer unsupported metadata version and verify the app opens read-only recovery instead of mutating it.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run tests/integration`

Expected: atomicity and migration tests PASS.

Commit: `git commit -am "feat: add atomic IndexedDB persistence"`

### Task 5: Implement application use cases and rebuildable caches

**Files:**
- Create: `src/application/financeService.ts`
- Create: `src/application/dashboardService.ts`
- Create: `src/application/validation.ts`
- Create: `src/application/financeService.test.ts`
- Create: `src/application/dashboardService.test.ts`

- [ ] **Step 1: Write failing use-case tests**

Test account-reference validation, positive amount validation, distinct transfer accounts, atomic create/edit/delete orchestration, audit descriptions, cache revision checks, and a full cache rebuild from ledger records.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/application`

Expected: FAIL because services do not exist.

- [ ] **Step 3: Implement services**

`FinanceService` validates commands, constructs typed records, and calls `FinanceUnitOfWork`. `DashboardService` loads a cache only when `calculationVersion` and `ledgerRevision` match; otherwise it calls pure ledger functions and replaces the cache.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- --run src/application`

Expected: PASS.

Commit: `git commit -am "feat: add finance application services"`

### Task 6: Implement backup schema, native folder handling, and exports

**Files:**
- Create: `src/backup/schema.ts`
- Create: `src/backup/serialize.ts`
- Create: `src/backup/restoreService.ts`
- Create: `src/export/csv.ts`
- Create: `src/platform/backupPort.ts`
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `tests/unit/backup.test.ts`
- Create: `tests/unit/csv.test.ts`
- Create: `tests/integration/restoreInterruption.test.ts`

- [ ] **Step 1: Write failing backup and CSV tests**

Validate a versioned `MiroraTrack` envelope, reject unknown newer versions, preserve older compatible versions through migration, quote commas and quotes in CSV, and serialize money accurately.

- [ ] **Step 2: Write interruption tests**

Simulate restore failure before database replacement and assert the original record counts and ledger revision remain unchanged. Simulate backup failure before temporary-file promotion and assert the last valid backup still parses.

- [ ] **Step 3: Implement browser-independent serialization**

Use Zod for:

```ts
{ app: "MiroraTrack", schemaVersion: 1, exportedAt: string, data: { ...collections } }
```

Never silently discard unknown collections; return an incompatibility result.

- [ ] **Step 4: Implement Tauri backup commands**

In Rust, resolve the default documents directory, create `MiroraTrack\Backups`, write `*.partial`, flush, and rename to the final `.json`. Retain the newest ten automatic snapshots. Return typed permission/unavailable errors. Add a native folder picker and persist only the selected path in settings.

- [ ] **Step 5: Implement restore safety**

Create a safety backup, validate and migrate input in memory, then replace IndexedDB stores in one transaction. Report counts after success.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- --run tests/unit tests/integration/restoreInterruption.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all backup, CSV, restore interruption, and Rust tests PASS.

Commit: `git commit -am "feat: add resilient local backup and export"`

### Task 7: Build the premium design system and desktop shell

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/index.css`
- Create: `src/components/Button.tsx`
- Create: `src/components/Card.tsx`
- Create: `src/components/EmptyState.tsx`
- Create: `src/components/Dialog.tsx`
- Create: `src/app/AppShell.tsx`
- Create: `src/app/Sidebar.tsx`
- Create: `src/app/Header.tsx`
- Create: `src/stores/preferences.ts`
- Create: `src/app/AppShell.test.tsx`

- [ ] **Step 1: Write failing shell accessibility test**

Assert a named navigation landmark, active page indication, accessible theme control, visible page heading, and keyboard-reachable quick-add button.

- [ ] **Step 2: Implement tokens**

Define Midnight Blue, Professional Blue, Teal, Gold, income green, expense red, investment purple, warning orange, layered light/dark surfaces, 16–20 px radii, shadow levels, and reduced-motion overrides.

- [ ] **Step 3: Implement the shell**

Create a gradient sidebar with a blue active accent line, Lucide icons, animated hover elevation, compact header, theme switching, and responsive collapsed state. Store only preferences in localStorage through Zustand persistence.

- [ ] **Step 4: Implement accessible primitives**

Buttons retain 44 px targets, dialogs trap/restore focus, empty states include a title, explanation, and action, and status indicators pair icons/text with color.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/app/AppShell.test.tsx`

Expected: PASS.

Commit: `git commit -am "feat: add premium desktop design system"`

### Task 8: Implement onboarding and accounts

**Files:**
- Create: `src/features/onboarding/OnboardingPage.tsx`
- Create: `src/features/onboarding/OnboardingPage.test.tsx`
- Create: `src/features/accounts/AccountsPage.tsx`
- Create: `src/features/accounts/AccountForm.tsx`
- Create: `src/features/accounts/AccountsPage.test.tsx`

- [ ] **Step 1: Write failing onboarding flow test**

Use Testing Library to select USD, choose a date format, create a checking account, skip demo data, and assert navigation to Dashboard.

- [ ] **Step 2: Implement onboarding**

Use React Hook Form and Zod. Persist settings and account in one initialization use case, and never auto-load demo data.

- [ ] **Step 3: Write failing account tests**

Test create, edit, archive, currency selection, and validation of a non-negative credit limit where applicable.

- [ ] **Step 4: Implement accounts page**

Show ledger-derived balances, premium empty state, accessible account form, and archived-state handling.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/features/onboarding src/features/accounts`

Expected: PASS.

Commit: `git commit -am "feat: add onboarding and accounts"`

### Task 9: Implement transaction workflows and activity history

**Files:**
- Create: `src/features/transactions/TransactionsPage.tsx`
- Create: `src/features/transactions/TransactionForm.tsx`
- Create: `src/features/transactions/TransactionTable.tsx`
- Create: `src/features/transactions/TransactionsPage.test.tsx`
- Create: `src/features/activity/ActivityPage.tsx`

- [ ] **Step 1: Write failing income, expense, and transfer UI tests**

Test each complete form flow, validation messages, transfer account inequality, derived balance updates, and audit history creation.

- [ ] **Step 2: Implement the quick-add dialog**

Render type-specific fields, parse money through `parseMajor`, call `FinanceService`, announce errors, retain form state on failure, and close only after commit.

- [ ] **Step 3: Implement transaction table and editing**

Add search, type/account/date filters, semantic amount styling, edit, delete confirmation, pagination, and CSV export of the current filtered set.

- [ ] **Step 4: Implement activity page**

Display searchable audit entries without secrets or raw backup paths.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/features/transactions src/features/activity`

Expected: PASS.

Commit: `git commit -am "feat: add transaction and activity workflows"`

### Task 10: Implement budgets and interactive dashboard

**Files:**
- Create: `src/features/budgets/BudgetsPage.tsx`
- Create: `src/features/budgets/BudgetForm.tsx`
- Create: `src/features/budgets/BudgetsPage.test.tsx`
- Create: `src/features/dashboard/DashboardPage.tsx`
- Create: `src/features/dashboard/CashFlowChart.tsx`
- Create: `src/features/dashboard/DashboardPage.test.tsx`

- [ ] **Step 1: Write failing budget tests**

Create a monthly grocery budget, add expense and transfer records, and verify only the expense contributes to usage.

- [ ] **Step 2: Implement budget UI**

Add category/month selection, positive minor-unit amount validation, progress state, and a premium empty state.

- [ ] **Step 3: Write failing dashboard tests**

Assert net worth, income, expenses, cash flow, savings rate, recent transactions, budget health, and textual chart summary from stored ledger data.

- [ ] **Step 4: Implement dashboard and charts**

Use Recharts with hover tooltips, keyboard-accessible summaries, concept colors, and click drill-down that navigates to Transactions with encoded filters.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/features/budgets src/features/dashboard`

Expected: PASS.

Commit: `git commit -am "feat: add budgets and ledger dashboard"`

### Task 11: Implement settings, backup status, and restore UX

**Files:**
- Create: `src/features/settings/SettingsPage.tsx`
- Create: `src/features/settings/BackupPanel.tsx`
- Create: `src/features/settings/RestoreDialog.tsx`
- Create: `src/features/settings/SettingsPage.test.tsx`

- [ ] **Step 1: Write failing settings tests**

Test theme persistence, base currency display, backup status, permission failure, retry, alternative folder selection, manual JSON export, restore preview, typed replacement confirmation, and success summary.

- [ ] **Step 2: Implement preferences**

Store theme, density, sidebar, and window preferences in localStorage. Store financial settings and backup metadata in IndexedDB.

- [ ] **Step 3: Implement backup status**

Show last successful time, configured folder, next automatic attempt, retry, choose-folder, and manual export. Errors do not block navigation or finance forms.

- [ ] **Step 4: Implement restore flow**

Validate before preview, show collection counts, create safety snapshot, require the exact phrase `REPLACE MY DATA`, execute atomic replacement, rebuild caches, and announce success.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/features/settings`

Expected: PASS.

Commit: `git commit -am "feat: add settings backup and restore UX"`

### Task 12: Add automatic backup scheduling and startup recovery

**Files:**
- Create: `src/app/startup.ts`
- Create: `src/backup/automaticBackup.ts`
- Create: `src/backup/automaticBackup.test.ts`
- Create: `src/app/ErrorBoundary.tsx`

- [ ] **Step 1: Write failing scheduler tests**

Given no successful backup in 24 hours, app activation schedules one backup. Given a recent success, it does not. Given permission failure, it records failure and keeps the app ready.

- [ ] **Step 2: Implement startup sequence**

Open database, run migrations, validate metadata, rebuild stale caches, start the UI, and schedule backup after the app becomes idle. Never delay first render for backup I/O.

- [ ] **Step 3: Implement graceful recovery**

Show read-only recovery for unsupported schemas and an error boundary for UI failures. Never offer “reset data” as the primary recovery action.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- --run src/backup/automaticBackup.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: add startup recovery and automatic backups"`

### Task 13: Generate branding assets and configure Windows shortcuts

**Files:**
- Create: `src-tauri/icons/icon.png`
- Create: `src-tauri/icons/icon.ico`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src/components/LogoMark.tsx`

- [ ] **Step 1: Create the MiroraTrack icon source**

Generate a polished rounded “M + upward path” application icon using the approved Midnight Blue, Professional Blue, Teal, and Gold palette. Export a 1024 px PNG and derive required Tauri sizes with:

```powershell
npx tauri icon src-tauri/icons/icon.png
```

- [ ] **Step 2: Configure installer shortcuts**

Configure NSIS to create Start menu and desktop shortcuts, set upgrade-safe product identifiers, preserve application data on uninstall, and use the generated `.ico`.

- [ ] **Step 3: Verify icon and config**

Run: `npx tauri build --debug`

Expected: debug bundle builds with MiroraTrack branding.

- [ ] **Step 4: Commit**

Commit: `git commit -am "feat: add MiroraTrack Windows branding"`

### Task 14: Run accessibility, performance, and complete-flow verification

**Files:**
- Create: `tests/e2e/coreFlows.spec.ts`
- Create: `tests/e2e/persistence.spec.ts`
- Create: `tests/fixtures/ten-thousand-transactions.ts`
- Modify: `package.json`

- [ ] **Step 1: Add complete-flow browser harness tests**

Cover first setup, account creation, income, expense, transfer, budget, dashboard drill-down, JSON export/restore, CSV export, and backup-location recovery.

- [ ] **Step 2: Add persistence test**

Create records, reload the application harness, and verify accounts, transactions, preferences, and derived balances.

- [ ] **Step 3: Add 10,000-transaction performance fixture**

Measure initial dashboard calculation and filtered-table response. Expected: no frozen UI; calculations run off render paths and repeated dashboard access uses a valid cache.

- [ ] **Step 4: Run complete verification**

Run:

```powershell
npm test -- --run
npm run test:e2e
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests PASS and production build succeeds without console errors.

- [ ] **Step 5: Commit**

Commit: `git commit -am "test: verify core desktop finance flows"`

### Task 15: Build and verify the Windows installer lifecycle

**Files:**
- Create: `scripts/verify-installer.ps1`
- Create: `docs/INSTALLER-VERIFICATION.md`
- Modify: `README.md`

- [ ] **Step 1: Write installer verification script**

The PowerShell script must resolve exact installer paths, install silently into a test location, verify executable and shortcuts, launch the app, and report each stage without deleting user data directories.

- [ ] **Step 2: Build the release installer**

Run:

```powershell
npm run build
npx tauri build --bundles nsis
```

Expected: `src-tauri/target/release/bundle/nsis/MiroraTrack_<version>_x64-setup.exe`.

- [ ] **Step 3: Verify clean install and persistence**

Install, launch from the desktop shortcut, create an account and transaction, close, reopen from Start menu, and verify the same ledger-derived balance.

- [ ] **Step 4: Verify upgrade, repair/reinstall, and uninstall**

Install over a prior test version and verify finance data and backups. Run repair/reinstall and verify again. Uninstall and verify the IndexedDB/local app-data directory and `Documents\MiroraTrack\Backups` remain. Reinstall and verify preserved records reconnect.

- [ ] **Step 5: Document signing and lifecycle behavior**

README must explain prerequisites, build commands, output path, unsigned Windows warning, optional signing variables, default/alternative backup locations, update preservation, and uninstall data preservation.

- [ ] **Step 6: Final verification and commit**

Run:

```powershell
npm test -- --run
npm run test:e2e
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npx tauri build --bundles nsis
```

Expected: all tests PASS and the x64 `.exe` installer exists.

Commit: `git commit -am "build: package MiroraTrack Windows installer"`
