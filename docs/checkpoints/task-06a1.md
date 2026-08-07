# Task 06A1 checkpoint

## Scope

Implemented browser-independent backup envelope validation, canonical JSON
serialization, transaction CSV serialization, and the concrete application
backup payload contract. Restore, platform file operations, and Rust work remain
out of scope.

## Changes

- Added a strict version 1 `MiroraTrack` envelope containing exactly the eight
  persisted collections in fixed order.
- Added stable discriminator errors for wrong applications, newer versions, and
  older versions, plus identity migration for version 1.
- Validated real ISO timestamps, uppercase currency codes, safe integer amounts,
  positive transaction/budget amounts, unique collection identifiers, singleton
  schema-2 metadata/settings, transaction/default-account references, transfer
  shape, account currency consistency, and JSON-compatible cache values.
- Kept audit entries independent of current transactions so deletion audits
  remain restorable.
- Added canonical recursive object-key serialization and validation before
  serialization.
- Added exact transaction CSV headers and ordering, RFC 4180 quoting, CRLF
  records with a final newline, spreadsheet-formula hardening for user-controlled
  cells, and integer-only 0/2/3 fraction-digit formatting.
- Replaced the generic application `BackupPayload` with a type-only alias to the
  concrete envelope, avoiding a runtime layer dependency.

## TDD evidence

- The first focused run failed because `src/backup/schema.ts` and
  `src/export/csv.ts` did not exist.
- After the minimal implementation, both focused files passed: 20 tests total.
- A subsequent typecheck exposed erasable-syntax and optional fraction-scale
  compiler issues; small corrections resolved them before full verification.

## Verification

- `npm run typecheck` — passed.
- `npm test -- --run` — 151 tests passed across 11 files.
- `npm run build` — TypeScript compilation and Vite production build passed.

## Boundaries

- No restore service, platform backup port, Tauri/Rust code, or persistence code
  was added.
- No dependency restore was run.
- No Git command or `.git` metadata access was used.

## Review follow-up

- Added a regression for user-controlled CSV text beginning with LF followed by
  formula text. It failed against the previous dangerous-prefix predicate, then
  passed after LF was included alongside CR, tab, `=`, `+`, `-`, and `@`.
- The hardened LF-leading field retains RFC 4180 quoting and receives the
  apostrophe prefix inside the quoted field.
