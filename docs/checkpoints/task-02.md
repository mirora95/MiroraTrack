# Task 02 checkpoint

## Status

DONE

No Git commands were run and `.git` was not accessed or modified.

## TDD evidence

### Initial RED

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 1
- Test files: 1 failed
- Tests: 34 failed
- The suite loaded successfully; every failure came from the intentional `Not implemented` money stubs.
- Representative behavior failure: parsing `"10.29"` called `parseMajor` and received `Error: Not implemented`.
- Validation assertions expected `RangeError` and instead received the intentional `Error: Not implemented`.
- There was no import, test discovery, or configuration error.

### Initial GREEN

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 0
- Test files: 1 passed
- Tests: 34 passed

### Currency factory RED

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 1
- Test files: 1 failed
- Tests: 2 failed, 34 passed
- Both new factory tests failed on the intentional `Not implemented` behavior.

### Currency factory GREEN

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 0
- Test files: 1 passed
- Tests: 36 passed

### Exact safe-integer formatting RED

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 1
- Test files: 1 failed
- Tests: 1 failed, 36 passed
- `formatMinor(Number.MAX_SAFE_INTEGER, "USD", "en-US")` returned
  `$90,071,992,547,409.90` instead of the exact
  `$90,071,992,547,409.91`.
- This directly demonstrated loss of the final cent during floating-point
  major-unit conversion.

### Exact safe-integer formatting GREEN

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 0
- Test files: 1 passed
- Tests: 37 passed
- Both positive and negative safe-integer boundaries preserve exact cents.
- Formatting now derives an exact BigInt quotient and remainder, then replaces
  Intl's fraction part while retaining locale-specific sign, currency, and
  grouping parts.

### Negative sub-unit sign RED

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 1
- Test files: 1 failed
- Tests: 1 failed, 38 passed
- `formatMinor(-1, "USD", "en-US")` returned `$0.01` instead of `-$0.01`.
- The regression test for `-$10.29` passed, isolating the defect to negative
  amounts whose whole-unit BigInt quotient truncates to zero.

### Negative sub-unit sign GREEN

Command:

`npm test -- --run src/finance/money.test.ts`

Observed result:

- Exit code: 0
- Test files: 1 passed
- Tests: 39 passed
- `-1` and `-99` minor units retain their sign, while larger negative values
  still contain exactly one sign.
- Sign and currency ordering remain locale-driven: Intl formats negative zero
  for negative sub-unit amounts and signed BigInts for nonzero whole units.

### Exact optional property compile-time check

- Enabled `exactOptionalPropertyTypes` in `tsconfig.app.json`.
- Added `src/finance/types.test-d.ts`.
- A valid income transaction omits `sourceAccountId`.
- A `@ts-expect-error` assertion proves that explicitly specifying
  `sourceAccountId: undefined` does not satisfy `IncomeTransaction`.
- `npm run typecheck` observed exit code 0 with the expected error consumed.

## Verification

The first full verification run observed:

- `npm test`: exit 0; 2 files passed; 35 tests passed.
- `npm run typecheck`: exit 1 with TS2322 at `src/finance/money.ts`, because TypeScript declares Intl's resolved `maximumFractionDigits` as possibly undefined.
- After adding a runtime guard, `npm run typecheck`: exit 0.
- `npm run build`: exit 0; TypeScript build and Vite production build completed.

Fresh final verification results are recorded below after the last source edit:

- `npm test`: exit 0; 2 test files passed; 40 tests passed.
- `npm run typecheck`: exit 0; `tsc -b --noEmit` reported no diagnostics.
- `npm run build`: exit 0; TypeScript and Vite completed, 17 modules transformed.

## Files created or changed

- Created `work/checkpoints/task-02-before/manifest.md`
- Created `src/finance/types.ts`
- Created `src/finance/money.ts`
- Created `src/finance/money.test.ts`
- Created `src/finance/types.test-d.ts` during review
- Created `src/application/ports.ts`
- Created `src/i18n/en.ts`
- Created `docs/checkpoints/task-02.md`
- Changed `tsconfig.app.json` during review

## Contract review

- Finance IDs, currency codes, cache keys, and minor amounts are branded.
- `minorAmount` accepts any safe integer, including signed values; positivity remains a service concern.
- `currencyCode` validates through the same Intl-backed rules used by formatting.
- Transactions are a discriminated union that makes invalid account/category combinations unrepresentable.
- Settings and UI preferences are separate.
- UI preferences include the localStorage-owned selected display currency.
- App metadata carries stable schema, calculation, and ledger revisions.
- Budgets include rollover behavior.
- Automatic backup metadata uses the branded
  `AUTOMATIC_BACKUP_METADATA_ID` constant and records schema version plus
  machine-readable and plain-language errors.
- Backup payloads are structural and readonly, and backup results are discriminated.
- Production ports contain no fault-injection surface.
- Calculation caches use `sourceRevision`, distinct from app metadata's
  authoritative `ledgerRevision`.
- English messages satisfy an independent exact nested dictionary schema and
  derive a dotted key union.

## Downstream requirements

- The finance service must later enforce transaction/account currency equality and same-currency transfers.
- Task 4 may add concrete test injection only; fault injection must not enter the production port.
- The Dexie transaction scope must include calculation caches.
- Downstream cache consumers must compare `CalculationCache.sourceRevision`
  against `AppMetadata.ledgerRevision`.
- Backup import validation must reject unsupported future schema versions before mutation.

## Limitations

- Domain timestamps and paths remain strings at this contract layer; parsing and platform validation belong at the application or adapter boundary.
- The backup import port returns unknown data intentionally; schema/version validation is a later service responsibility.
- The budget month type constrains the month to `01` through `12`; semantic year policy, if any, remains a service concern.
