# Task 03 checkpoint: authoritative ledger engine

## Files

- Created `work/checkpoints/task-03-before/manifest.md`.
- Created `src/finance/ledger.ts`.
- Created `src/finance/ledger.test.ts`.
- Created `src/finance/budgets.ts`.
- Created `src/finance/budgets.test.ts`.
- Created `docs/checkpoints/task-03.md`.

## RED

Command:

`npm test -- --run src/finance/ledger.test.ts src/finance/budgets.test.ts`

Observed result: exit code 1. Both suites failed during import because
`./ledger` and `./budgets` did not exist. No tests were collected. This was the
expected feature-missing failure before production code was introduced.

A later strict-calendar regression test was added for
`2026-02-30T00:00:00Z`.

Command:

`npm test -- --run src/finance/ledger.test.ts`

Observed result: exit code 1, 1 failed and 10 passed. The invalid calendar date
was incorrectly accepted because `Date.parse` normalized it. Timestamp parsing
was then tightened with explicit calendar and clock validation.

## GREEN

Command:

`npm test -- --run src/finance/ledger.test.ts src/finance/budgets.test.ts`

Observed result: exit code 0, 2 test files passed, 15 tests passed.

Command:

`npm test`

Observed result: exit code 0, 4 test files passed, 55 tests passed.

Command:

`npm run typecheck`

Observed result: exit code 0; `tsc -b --noEmit` completed without diagnostics.

Command:

`npm run build`

Observed result: exit code 0; `tsc -b && vite build` completed and Vite built
17 modules.

## Decisions and limitations

- All calculations are pure rebuilds over readonly inputs; there are no
  mutation, edit, or delete APIs.
- Amount arithmetic uses `bigint`, with a safe-integer bounds check after every
  applied effect and before branded `MinorAmount` conversion.
- Ranges are inclusive parsed instants. Application timestamps use the
  interoperable desktop-input subset: Gregorian years `0001` through `9999`,
  seconds `00` through `59`, an explicit `Z` or `±HH:mm` offset, valid calendar
  components, and an instant parseable by JavaScript `Date`.
- Leap-second and year-zero normalization are intentionally unsupported. This
  avoids platform-specific parsing behavior that is unnecessary for desktop
  finance inputs.
- Calendar components are validated before `Date.parse` to prevent normalized
  invalid dates from being accepted.
- Transfers never contribute to summaries or budget usage.
- Budget month membership is derived from the transaction instant in UTC.
- Budget months are runtime-validated as `YYYY-MM`, with years `0001` through
  `9999` and months `01` through `12`.
- Currency mismatches are errors for known account effects, but non-budget
  currencies are intentionally ignored by budget usage.
- No Git command or repository metadata access was used.

## Review follow-up RED/GREEN

Tests were added before the review production changes for:

- leap-second and year-zero timestamp rejection;
- `deriveBalances` status exclusion, overflow, and input nonmutation;
- summary exact boundaries, input nonmutation, and negative fixture rejection;
- budget exact end boundary and runtime month validation.

RED command:

`npm test -- --run src/finance/ledger.test.ts src/finance/budgets.test.ts`

Observed result: exit code 1, 20 tests total, 18 passed and 2 failed. The
failures showed that `0000-01-01T00:00:00Z` and malformed `budget.month` values
were accepted. The requested leap-second and `0000-02-29` fixtures were already
rejected by existing seconds/calendar checks; the additional valid-calendar
year-zero fixture exposed the missing explicit year contract.

GREEN command:

`npm test -- --run src/finance/ledger.test.ts src/finance/budgets.test.ts`

Observed result: exit code 0, 2 test files passed, 20 tests passed.

Full-suite command:

`npm test`

Observed result: exit code 0, 4 test files passed, 60 tests passed.

Typecheck command:

`npm run typecheck`

Observed result: exit code 0; `tsc -b --noEmit` completed without diagnostics.

Build command:

`npm run build`

Observed result: exit code 0; `tsc -b && vite build` completed successfully,
with 17 modules transformed.
