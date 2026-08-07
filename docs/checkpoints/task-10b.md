# Task 10B implementation checkpoint

## Outcome

Implemented the application-layer budget workflows and ledger-derived dashboard
projections on the approved Task 10A persistence foundation:

- Budget create/update/archive/reactivate/delete commands validate the expense
  catalog, supported currency, exact positive major-unit input, and valid UTC
  month before constructing immutable records.
- Budget names are derived from the category catalog, rollover is always false,
  and mutable operations pass the complete previously read budget to the atomic
  unit of work for compare-and-swap protection.
- Generated budget IDs avoid existing records and audit IDs cannot equal their
  entity IDs; persistence remains the final atomic collision boundary.
- Budget lists support month, explicit/default base currency, and optional
  archived rows, with stable projections for budgeted, spent, remaining,
  percent used, health, totals, and drill-down transaction IDs.
- Budget usage includes only completed standard expenses matching the exact UTC
  month, category, and currency. Opening balances, transfers, planned,
  cancelled, cross-currency, cross-category, and cross-month records are
  excluded.
- Available currencies are derived without duplicates from settings, accounts,
  budgets, and transactions.
- Dashboard queries support this month, last month, last three months,
  year-to-date, and custom UTC ranges of at most 366 inclusive days.
- Dashboard currency defaults to settings and can be explicitly selected,
  without foreign-exchange conversion or currency mixing.
- Net worth includes active and archived accounts and all completed ledger
  effects, including opening balances. Flow metrics and recent activity exclude
  opening balances; flow metrics additionally exclude transfers, planned, and
  cancelled records.
- Cash flow, active budget health, and category breakdowns include stable
  labels, deterministic ordering, and drill-down transaction IDs. Legacy
  expense categories remain visible as deterministic trailing `Other` rows.
- Dashboard cache keys include every normalized query field and the calculation
  version. Cached nested structures are validated before use.
- Dashboard source reads are guarded by metadata revision/calculation checks
  before and after reads and again after cache storage. At most three rebuild
  attempts occur; repeated changes produce a typed retryable
  `DashboardSnapshotUnstableError`, and no unstable payload is returned.
- Duplicate IDs and duplicate active budget scopes fail closed instead of
  producing ambiguous projections.

## Created files

- `src/application/budgetService.ts`
- `src/application/budgetService.test.ts`
- `src/application/dashboardService.task10b.test.ts`
- `src/database/dashboardReadRepository.ts`
- `work/checkpoints/task-10b-before/manifest.md`
- `docs/checkpoints/task-10b.md`

## Modified files

- `src/application/ports.ts`
- `src/application/validation.ts`
- `src/application/dashboardService.ts`
- `src/application/dashboardService.test.ts`
- `src/database/budgetReadRepository.ts`
- `tests/integration/budgetUnitOfWork.test.ts`
- `tests/integration/repositories.test.ts`

## Verification

- Focused budget/dashboard/read-repository run: 71 tests passed in 5 files.
- TypeScript typecheck: passed.
- Full test suite: 412 tests passed in 32 files.
- Production Vite build: passed.
- No lint script exists in `package.json`, so linting was not available.
- Build emitted the existing advisory that the main minified JavaScript chunk
  exceeds 500 kB; it did not fail the build.
- React feature code, database schema/migrations, backup schema, and native
  Tauri files were unchanged.

The new behavior was developed with explicit red/green cycles for the service
module, dashboard expansion, UTC month handling, duplicate-scope handling, and
legacy-category caching. No Git commands or Git metadata operations were used.

## Independent review corrections

Two review findings were corrected with focused red/green regressions:

1. Direct `DateRange` instants are now parsed under the strict ledger timestamp
   contract and canonicalized with `toISOString()` before they enter the
   payload or cache key. Equivalent explicit-offset and UTC ranges therefore
   share the exact normalized range and cache entry while preserving inclusive
   ordering and the 366-day maximum.
2. Current dashboard-cache validation now requires actual canonical timestamp
   strings, positive transaction amounts, valid type/status/purpose/account and
   category semantics, supported sorted currencies, referentially known
   transaction accounts, consistent budget category labels/names/domain
   arithmetic, and unique drill-down IDs within each cash-flow, category, and
   budget projection. The same transaction ID remains valid across different
   projection types. Exact nested key validation remains fail closed.

The review correction has a before checkpoint at
`work/checkpoints/task-10b-review-before/manifest.md`.

Review-correction verification:

- Focused dashboard tests: 44 tests passed in 2 files.
- TypeScript typecheck: passed.
- Full test suite: 424 tests passed in 32 files.
- Production Vite build: passed with only the existing main-chunk size
  advisory.

### Remaining P2 correction

The follow-up review identified coercive discriminator checks and missing
canonical budget-row ordering. Deep cache validation now:

- requires primitive strings before every account, transaction, cash-flow,
  budget, category, status, purpose, type, timestamp, and date check;
- performs no `String(...)` coercion on cached nested values;
- requires budget rows in the same month/category-label/budget-ID order used by
  the projection builder; and
- verifies drill-down IDs are disjoint within each projection after all row
  arithmetic and domain checks pass.

Regression fixtures include boxed `String` values, reversed otherwise-valid
budget rows, and two nonzero arithmetically valid cash-flow rows sharing one
drill-down ID. The valid-cache fixture continues to reuse one transaction ID
across the cash-flow, category, and budget projections and remains a true hit.

Final P2 verification:

- Focused dashboard tests: 55 tests passed in 2 files.
- TypeScript typecheck: passed.
- Full test suite: 435 tests passed in 32 files.
- Production Vite build: passed with only the existing main-chunk size
  advisory.
