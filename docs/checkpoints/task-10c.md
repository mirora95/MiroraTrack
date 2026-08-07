# Task 10C implementation checkpoint

## Outcome

Implemented the premium Budgets and ledger-derived Dashboard workspace:

- Extended the runtime boundary with narrow budget and dashboard application
  interfaces and composed them from the approved application/database adapters.
- Added monthly and currency-aware budget browsing, active-by-default and
  archived views, create/edit/archive/reactivate/delete workflows, retained
  failed forms, confirmation dialogs, duplicate-submit guards, stale-request
  protection, retry states, and last-successful-result retention.
- Added gold-accented budget cards with numeric progress bars and icon/text
  health semantics for on-track, warning, and over-budget states.
- Added dashboard currency and preset/custom UTC range controls, five financial
  KPIs, cash-flow and spending charts, budget health, account balances, and
  recent ledger activity.
- Added Recharts hover tooltips, visible table alternatives, keyboard links,
  pointer-click drill-down, and deterministic shared links into Transactions.
- Transactions now treat valid URL filter parameters as authoritative in both
  directions, including same-route Back/Forward navigation, while ignoring
  unknown values and impossible calendar dates.
- Failed archive/reactivate/delete operations retain their confirmation dialog
  with an inline retryable error. Budget progress accessibility values are
  clamped to the ARIA range while preserving the true percentage in text.
- Dashboard controls distinguish requested from last-applied queries. A failed
  request restores the controls to the retained payload, and stale failures
  cannot roll back a newer successful selection.
- Recharts renderers are lazy chunks so the chart implementation is not part of
  the synchronous Dashboard module.
- Added responsive, dark-theme-compatible, reduced-motion-compatible styling
  using the established concept color tokens.

## Created files

- `src/features/budgets/BudgetForm.tsx`
- `src/features/budgets/BudgetsPage.tsx`
- `src/features/budgets/BudgetsPage.test.tsx`
- `src/features/dashboard/CashFlowChart.tsx`
- `src/features/dashboard/CategoryBreakdownChart.tsx`
- `src/features/dashboard/DashboardPage.tsx`
- `src/features/dashboard/DashboardPage.test.tsx`
- `src/features/dashboard/drilldown.ts`
- `work/checkpoints/task-10c-before/manifest.md`
- `docs/checkpoints/task-10c.md`

## Modified files

- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/app/AppShell.test.tsx`
- `src/app/productionRuntime.ts`
- `src/app/productionRuntime.test.ts`
- `src/app/runtime.tsx`
- `src/features/onboarding/OnboardingPage.test.tsx`
- `src/features/transactions/TransactionsPage.tsx`
- `src/features/transactions/TransactionsPage.test.tsx`
- `src/i18n/en.ts`
- `src/styles/index.css`

## Verification

- Review regression tests: 15 tests passed in 3 files.
- TypeScript typecheck: passed.
- Full suite: 446 tests passed in 34 files.
- Production Vite build: passed.
- No lint script exists in `package.json`.
- The build still emits the pre-existing main-chunk advisory. Chart renderers
  are split into separate chunks, but broader application route/vendor
  splitting is intentionally deferred to the performance task.
- Browser visual QA could not run because no controllable browser was available
  to this task. Responsive, dark theme, focus, reduced-motion, and accessible
  table behavior are covered structurally and by React/architecture tests.
- Native Tauri files were unchanged.

No Git commands or Git metadata operations were used.
