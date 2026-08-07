# Task 05B checkpoint

## Scope

Implemented the dashboard application read service and rebuildable calculation
cache orchestration. No persistence implementation, UI, or database import was
added.

## Changes

- Added the narrow `DashboardReadPort` for accounts, transactions, budgets,
  application metadata, and calculation cache reads/writes.
- Added validated dashboard queries with inclusive ranges and a recent-item
  limit default of 5 and maximum of 50.
- Added a currency-isolated dashboard payload containing lifetime account
  balances and net worth, range summaries, savings rate, UTC daily cash flow,
  intersecting monthly budget usage, and deterministically sorted recent
  transactions.
- Reused `deriveBalances`, `summarize`, and `calculateBudgetUsage`; monetary
  aggregation uses safe-integer checks and BigInt intermediates.
- Added deterministic cache keys, concurrent reads, metadata version/revision
  checks, exhaustive runtime payload validation, rebuilds for corrupt or stale
  values, and injected-clock cache writes.

## TDD evidence

- Before production implementation, the focused test suite failed because
  `src/application/dashboardService.ts` did not exist.
- After the minimal implementation and corrections, 18 focused dashboard tests
  passed.
- Tests cover cache hits without writes, stale versions and revisions, corrupt
  and query-mismatched values, multi-currency/status/transfer behavior, UTC
  grouping, budgets, recent ordering, missing metadata, overflow, query
  validation, and cache-write rejection.

## Verification

- `npm test -- --run src/application/dashboardService.test.ts` — 18 tests passed.
- `npm run typecheck` — passed.
- `npm test -- --run` — 131 tests passed across 9 files.
- `npm run build` — TypeScript and the Vite production build passed.

## Boundaries

- No database or platform dependency was imported by the application service.
- No Git command or `.git` metadata access was used.

## Review follow-up

- Cache hits now require the stored cache key to equal the computed query key.
- Semantic validation now rejects impossible, duplicate, unsorted, or
  out-of-range UTC cash-flow days; unsorted or duplicate recent transactions;
  and invalid, duplicate, or nonintersecting budget rows.
- Cached arithmetic is cross-checked for summaries, account net worth, daily
  cash flow, savings rate, and budget remaining/percentage values.
- Four new regressions were observed failing against the previous predicate,
  then passing after the validation was tightened.
- Added an empty-budget regression for inconsistent global arithmetic and made
  the budget-row predicate an explicitly scoped boolean, keeping global
  arithmetic checks outside the row callback.
