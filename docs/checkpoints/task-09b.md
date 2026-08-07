# Task 09B — Transactions, Activity, and global Quick Add

Completed: 2026-07-29

## Implementation summary

Task 09B replaces the Transactions and Activity placeholders with production
React workflows that depend only on application-facing runtime interfaces.
The initialized desktop shell now owns a global transaction dialog, so Quick
Add is available from every initialized route. The form defaults to Expense
and supports income, expenses, and same-currency transfers. It uses active
accounts, account-derived currency precision, the fixed category catalog,
legacy category retention during edits, typed concurrency feedback, accessible
field errors, and synchronous repeat-action guards. While a save is pending,
type changes and every dismissal path are disabled. Failed saves preserve all
entered values; successful commits close the dialog, restore trigger focus,
increment a shared refresh revision, and refresh the ledger.

The Transactions page provides search; type, status, account, category,
currency, and date filters; deterministic sorting; closed page sizes;
pagination; clear-filters; per-currency summaries; semantic responsive rows;
opening-balance protection; edit/delete controls; deletion confirmation; and
CSV export using all current filters. Request tokens prevent stale responses
from replacing newer results, and a failed refresh retains the prior successful
page. Explicit loading, error, empty, no-match, export-success, export-cancel,
and export-failure states are included.

The Activity page renders the fixed safe application projection as a timeline,
with search and closed pagination. It never renders persisted entity IDs,
descriptions, or filesystem paths. Production composition wires the existing
FinanceService, TransactionService, ActivityService, Dexie adapters, atomic
finance unit of work, and native CSV port behind the runtime boundary.

## Created files

- `src/features/transactions/TransactionDialogProvider.tsx`
- `src/features/transactions/TransactionForm.tsx`
- `src/features/transactions/TransactionTable.tsx`
- `src/features/transactions/TransactionsPage.tsx`
- `src/features/transactions/TransactionsPage.test.tsx`
- `src/features/activity/ActivityPage.tsx`
- `src/features/activity/ActivityPage.test.tsx`
- `tests/architecture/featureArchitecture.test.ts`
- `work/checkpoints/task-09b-before/manifest.md`
- `docs/checkpoints/task-09b.md`

## Modified files

- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/app/AppShell.tsx`
- `src/app/AppShell.test.tsx`
- `src/app/Header.tsx`
- `src/app/runtime.tsx`
- `src/app/productionRuntime.ts`
- `src/app/productionRuntime.test.ts`
- `src/features/onboarding/OnboardingPage.test.tsx`
- `src/i18n/en.ts`
- `src/styles/index.css`

## Verification

- Focused Task 09B and shell suite:
  `npm test -- --run src/features/transactions/TransactionsPage.test.tsx src/features/activity/ActivityPage.test.tsx tests/architecture/featureArchitecture.test.ts src/app/AppShell.test.tsx src/app/productionRuntime.test.ts`
  — passed, 20 tests across 5 files.
- Complete suite: `npm test -- --run` — passed, 313 tests across 27 files.
- Type check: `npm run typecheck` — passed.
- Production build: `npm run build` — passed and emitted the offline frontend
  to `dist`.
- Vite reported the existing advisory that the main minified JavaScript chunk
  is larger than 500 kB; this is non-blocking and should be addressed by route
  splitting in the later performance task.
- Lint was not run because `package.json` has no lint script or lint
  configuration.
- Visual QA was attempted against the local preview, but no in-app or connected
  browser surface was available to the automation runtime. Automated semantic,
  responsive-markup, keyboard, focus-restoration, and theme-shell coverage
  passed; a screenshot-based pass remains for the later end-to-end task.

## Safety and scope

- Feature components import no database, Dexie, IndexedDB, Tauri, or platform
  adapter module; this is enforced by an architecture test.
- All writes continue through the approved application services and atomic
  finance unit of work.
- No database schema, migration, native Rust command, budget, chart, settings,
  or packaging file was changed.
- No Git command or Git metadata operation was used.

## Independent-review follow-up

Completed: 2026-07-29

All three review findings were corrected with regressions:

1. Custom transaction type radios now expose a clear tokenized focus-visible
   ring on their visible labels. Search-field wrappers now use `:focus-within`
   to retain an equally clear focus ring when their intentionally borderless
   inner input receives keyboard focus.
2. The responsive transaction table no longer removes its `<thead>` from the
   accessibility tree. At widths up to 700px, column headers use the standard
   visually-hidden clipping technique while the mobile row layout keeps its
   visible `data-label` annotations. Header cells retain `scope="col"`.
3. New transactions now derive their default `YYYY-MM-DD` from local calendar
   getters rather than converting the current instant to UTC. A helper
   regression covers both positive- and negative-offset rollover-shaped local
   date parts. The FinanceService remains responsible for normalizing the
   submitted calendar date to canonical UTC midnight.

Follow-up files:

- Modified `src/features/transactions/TransactionForm.tsx`
- Modified `src/features/transactions/TransactionsPage.test.tsx`
- Modified `src/styles/index.css`
- Modified `tests/architecture/featureArchitecture.test.ts`
- Modified `docs/checkpoints/task-09b.md`

Follow-up verification:

- Focused review suite passed, 6 tests across 2 files.
- `npm run typecheck` passed.
- `npm test -- --run` passed, 315 tests across 27 files.
- `npm run build` passed and emitted the offline frontend to `dist`.
- The existing non-blocking 500 kB chunk-size advisory remains documented for
  the later route-splitting/performance task.
