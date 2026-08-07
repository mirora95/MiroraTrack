# Task 09A — transaction and activity application/data foundation

Completed: 2026-07-29

## Implementation summary

Task 09A adds an application-facing transaction read/query/export service, a
fixed transaction category catalog, safe activity projections, and Dexie read
adapters. The finance mutation service now accepts exact major-unit text,
derives currency from the selected active account, persists strict UTC
calendar dates at midnight, validates bounded notes and categories, and
enforces distinct same-currency active accounts for transfers.

Transaction edit and delete operations now carry the complete record observed
by the service into the unit of work. The Dexie transaction reloads the record
inside the write transaction and compares every persisted field. A missing or
changed record produces typed `CONCURRENT_MODIFICATION`; no retry or partial
write occurs. Both the expected and transaction-current records are protected
against ordinary modification when they represent an opening balance.

The transaction query supports safe text search, type/status/account/category/
currency/date filters, deterministic sorting, closed pagination sizes,
per-currency summaries, and facets. Summaries include only completed standard
income and expenses. Opening balances and unavailable accounts receive fixed
safe labels. Filtered CSV export serializes every matching row independently
of the visible page through the existing hardened CSV serializer and
`BackupPort`.

Activity records are projected from a closed action-to-message map. Persisted
descriptions, entity IDs, and paths are never reflected into messages.
Unknown actions and malformed timestamps are omitted safely. Transaction audit
writes accept only the fixed message and a canonical UTC timestamp.

## Created files

- `src/application/transactionCategories.ts`
- `src/application/transactionService.ts`
- `src/application/transactionService.test.ts`
- `src/application/activityService.ts`
- `src/application/activityService.test.ts`
- `src/database/transactionReadRepository.ts`
- `tests/integration/transactionConcurrency.test.ts`
- `work/checkpoints/task-09a-before/manifest.md`
- `docs/checkpoints/task-09a.md`

## Modified files

- `src/application/ports.ts`
- `src/application/financeService.ts`
- `src/application/financeService.test.ts`
- `src/application/validation.ts`
- `src/database/unitOfWork.ts`
- `tests/integration/unitOfWork.test.ts`

## Verification

- Focused Task 09A suite:
  `npm test -- --run src/application/financeService.test.ts src/application/transactionService.test.ts src/application/activityService.test.ts tests/integration/unitOfWork.test.ts tests/integration/transactionConcurrency.test.ts`
  — passed, 84 tests across 5 files.
- Type check: `npm run typecheck` — passed.
- Complete suite: `npm test -- --run` — passed, 304 tests across 24 files.
- Production build: `npm run build` — passed; Vite emitted the offline
  frontend into `dist`.
- Lint: not run because `package.json` has no lint script or lint
  configuration.

## Coverage and interruption guarantees

- Exact major-unit parsing and account-derived currency.
- Strict `YYYY-MM-DD` UTC persistence and invalid-calendar rejection.
- Category length/system-prefix rules and transfer category rejection.
- Note trimming, 240-character bound, and NUL rejection.
- Active-account, transfer inequality, and currency validation.
- Create collision behavior through IndexedDB `add`.
- Transaction-local stale-record detection for edit/delete.
- Two simultaneous service edits: exactly one commits, the other receives
  `CONCURRENT_MODIFICATION`.
- Direct unit-of-work opening-balance protection.
- Rollback at ledger-mutation and pre-commit interruption stages.
- Atomic ledger, audit, revision, and calculation-cache updates.
- Inclusive date filtering, safe-label search, deterministic sorting,
  pagination, facets, and multi-currency summaries.
- CSV export of all filtered records independent of page, including
  multi-currency rows and cancellation/failure outcomes.
- Malicious audit descriptions/timestamps and path-like content.

## Scope and safety

- No React feature, Tauri/native command, database schema, or migration was
  changed.
- No Git command or Git metadata operation was used.
- The file-based before checkpoint preserves each pre-existing production and
  test file modified by this task.

## Independent-review follow-up

Completed: 2026-07-29

All three review findings were addressed:

1. `FinanceService` now enforces the fixed category catalog and its
   income/expense ownership for new transactions and category changes.
   An imported or legacy standard category may be retained unchanged during an
   edit, but it cannot be assigned to a new transaction or changed to another
   unknown value. System-prefixed categories remain prohibited.
2. Opening-balance rows retain their fixed “Opening balance” display label,
   while the internal `system:opening-balance` category is omitted from
   selectable facets. Catalog and imported legacy standard categories remain
   filterable.
3. Deterministic edit/delete and delete/edit race tests now prove the losing
   stale command receives `CONCURRENT_MODIFICATION`. Exactly one mutation
   audit persists, the ledger revision advances once, calculation caches clear
   once, and no loser state partially commits.

Follow-up files:

- Modified `src/application/financeService.ts`
- Modified `src/application/financeService.test.ts`
- Modified `src/application/transactionService.ts`
- Modified `src/application/transactionService.test.ts`
- Modified `tests/integration/transactionConcurrency.test.ts`
- Modified `docs/checkpoints/task-09a.md`

Follow-up verification:

- Focused Task 09A suite passed, 88 tests across 5 files.
- `npm run typecheck` passed.
- `npm test -- --run` passed, 308 tests across 24 files.
- `npm run build` passed and emitted the offline frontend to `dist`.
- No lint script exists.
