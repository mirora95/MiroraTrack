# Task 10A before checkpoint

Created before the schema, persistence, and backup changes on 2026-07-29.
No Git commands or Git metadata operations were used.

Copied existing high-risk files:

- `src/finance/types.ts`
- `src/application/ports.ts`
- `src/database/schema.ts`
- `src/database/db.ts`
- `src/database/migrations.ts`
- `src/backup/schema.ts`
- `src/backup/serialize.ts`
- `tests/integration/migrations.test.ts`
- `tests/unit/backup.test.ts`

The checkpoint intentionally excludes generated output and the native Tauri
layer. Small follow-up compatibility edits outside these high-risk files are
listed in the implementation checkpoint.
