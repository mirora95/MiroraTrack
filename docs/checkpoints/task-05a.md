# Task 05A checkpoint

## Scope

Implemented the finance application command service only. Dashboard and cache
work remain outside this checkpoint.

## Changes

- Added `FinanceReadPort` for account and transaction lookup.
- Added field-addressable `ValidationError`.
- Added the discriminated `TransactionDraft` union and `FinanceService`.
- Implemented create, edit, and delete orchestration through exactly one unit
  of work method per successful command.
- Added validation for positive safe-integer amounts, currencies, timestamps,
  transaction status, category text, account existence/archive state/currency,
  transfer account distinctness, and generated IDs.
- Added deterministic, value-free audit descriptions.
- Added injected/default ID, audit ID, and clock providers.

## TDD evidence

- Before source implementation, the focused test failed because
  `src/application/financeService.ts` did not exist.
- After minimal implementation, 13 focused tests passed.
- A compiler verification exposed `erasableSyntaxOnly` parameter-property
  violations and a test fixture type; these were corrected without changing
  behavior.

## Verification

- `npm test -- --run src/application/financeService.test.ts` — 18 tests passed.
- `npm run typecheck` — passed.
- `npm test -- --run` — 113 tests passed across 8 files.
- `npm run build` — recorded after final build verification.

## Review follow-up

- Added a runtime malformed-draft regression test proving an unknown
  transaction type is rejected before reads or writes.
- Added the `ValidationErrorCode` union and explicit income, expense, and
  transfer branches; there is no transfer fallback.
- Added exact successful income and transfer record/audit assertions.
- Added edit/delete missing-target, exactly-once unit-of-work, clock, and
  rejection-propagation coverage.
- The new regression test was observed failing because `refund` was converted
  into a transfer, then passing after the explicit type guard was implemented.

## Boundaries

- No dashboard service, persistence implementation, UI, database, or Tauri
  dependency was added.
- No Git command or `.git` metadata access was used.
