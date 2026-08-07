# Task 04B before manifest

Captured before Task 04B source edits on 2026-07-28.

## Requested scope

- `src/database/repositories.ts` — absent.
- `src/database/unitOfWork.ts` — absent.
- `tests/integration/repositories.test.ts` — absent.
- `tests/integration/unitOfWork.test.ts` — absent.
- `docs/checkpoints/task-04b.md` — absent.

## Existing dependencies inspected

- `src/application/ports.ts` defines the existing `FinanceUnitOfWork` port.
- `src/database/db.ts` defines all eight typed Dexie tables and current metadata seeding.
- `src/database/schema.ts` defines the exact eight store schemas.
- `src/finance/types.ts` defines the entity and branded-key types.

## Constraints

- Tests must be added and observed failing for missing features before production
  implementation.
- Production changes are limited to the two requested database files unless an
  explicitly approved targeted compiler fix becomes necessary.
- No Git commands or `.git` metadata access.
