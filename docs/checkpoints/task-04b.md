# Task 04B checkpoint: repositories and atomic unit of work

## Files

- Created `src/database/repositories.ts`.
- Created `src/database/unitOfWork.ts`.
- Created `tests/integration/repositories.test.ts`.
- Created `tests/integration/unitOfWork.test.ts`.
- Created `work/checkpoints/task-04b-before/manifest.md` before source edits.
- Created `docs/checkpoints/task-04b.md`.

No Task 4A, port, or finance-type file was modified.

## RED

Repository command:

`npm test -- tests/integration/repositories.test.ts`

Observed result: exit code 1, one failed suite and no tests collected. Vite
could not resolve the missing `src/database/repositories.ts` import. This was
the expected feature-missing failure.

Unit-of-work command:

`npm test -- tests/integration/unitOfWork.test.ts`

Observed result: exit code 1, one failed suite and no tests collected. Vite
could not resolve the missing `src/database/unitOfWork.ts` import. This was the
expected feature-missing failure.

## GREEN

Repository focused command:

`npm test -- tests/integration/repositories.test.ts`

Observed result: exit code 0, one test file passed and one test passed.

Unit-of-work focused command:

`npm test -- tests/integration/unitOfWork.test.ts`

Observed result: exit code 0, one test file passed and 26 tests passed.

Combined focused command:

`npm test -- tests/integration/repositories.test.ts tests/integration/unitOfWork.test.ts`

Observed result: exit code 0, two test files passed and 27 tests passed.

Full-suite command:

`npm test`

Observed result: exit code 0, seven test files passed and 95 tests passed.

Typecheck command:

`npm run typecheck`

Observed result: exit code 0; `tsc -b --noEmit` completed without diagnostics.

Build command:

`npm run build`

Observed result: exit code 0; `tsc -b && vite build` completed successfully,
with 17 modules transformed.

## Repository behavior

- `Repository<T, K>` exposes only `get`, `list`, `add`, `put`, and `delete`;
  write methods resolve to `void`.
- `FinanceRepositories` contains exactly the eight schema stores with their
  entity-specific key types.
- The integration test structurally round-trips every store through the public
  repository API.

## Unit-of-work behavior

- `DexieFinanceUnitOfWork` implements the existing application port.
- Its optional clock defaults to an ISO timestamp.
- Its optional `onStage` hook is synchronous-only and is invoked directly at
  `afterLedgerMutation` and `beforeCommit`.
- Audit action, entity type, entity id, independent audit id, and stable
  replacement identity are validated before writes.
- Each operation uses one awaited read-write transaction over exactly
  transactions, audit entries, metadata, and calculation caches.
- Metadata schema, calculation version, and safe nonnegative ledger revision
  are validated before mutation; revision overflow is rejected.
- Successful operations preserve metadata fields, increment revision once,
  set `updatedAt` from the injected clock, preserve the supplied audit
  timestamp, and clear derived caches.
- Replace and delete require an existing transaction.

## Atomicity coverage

- Exact positive state is asserted for create, replace, and delete.
- Deep-equal four-store rollback snapshots cover both hook stages for all three
  operations.
- Rollback is also covered for duplicate transaction creation, missing
  replace/delete, replacement identity mismatch, audit action/entity/id
  mismatches, non-independent audit id, audit collision, missing metadata,
  wrong schema/calculation versions, negative/noninteger/unsafe revisions, and
  revision overflow.
- Awaiting an operation is proven to expose committed state immediately.

## Notes

- No query, business-rule, clear, or asynchronous hook API was added.
- No `Dexie.waitFor` or promise-aware stage handling is present.
- No Git command or `.git` metadata access was used.
