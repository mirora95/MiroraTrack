# Task 14D — Privacy wording clarification

## Status

Implemented and verified on 2026-08-03.

## Scope

- Replaced the onboarding statement `No account. No cloud. No tracking.` with
  the approved exact copy: `No account. No cloud sync. No MiroraTrack analytics.`
- Added a concise privacy and connectivity document that distinguishes
  MiroraTrack application behavior from Microsoft WebView2 runtime diagnostics.
- Did not change finance behavior, UI layout, dependencies, lockfiles, Tauri
  configuration, installer configuration, or the Task 14C rollback.
- No Git command was run, and Git metadata was not accessed or changed.

## File-based checkpoint

Before editing, exact copies were saved under
`work/checkpoints/task-14d-before/`. `SHA256SUMS.txt` records their original
SHA-256 hashes. The checkpoint includes both pre-change files and these five
protected files:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

The five protected files were re-hashed after implementation and remain
byte-for-byte identical to their checkpoint copies.

## TDD evidence

### RED

The onboarding test was changed first to require the exact approved sentence
and reject the old absolute sentence. The clean focused command was:

```text
npx vitest run src/features/onboarding/OnboardingPage.test.tsx
```

Result: exit `1`; 1 test file, 1 expected failure and 4 passes. The failure was
`Unable to find an element with the text: No account. No cloud sync. No MiroraTrack analytics.`
while the rendered DOM contained the old sentence.

An initial RED invocation also discovered the exact checkpoint copy as a test
because its filename ended in `.test.tsx`. The copy was renamed to
`.test.tsx.checkpoint` without changing its bytes, and RED was rerun to produce
the clean result above.

### GREEN

Only `en.onboarding.privacy` was changed in production code. The same focused
command then exited `0`: 1 test file and 5/5 tests passed.

## Privacy-content verification

A focused PowerShell content check verified:

- the exact approved onboarding sentence is present;
- the old absolute sentence is absent from the live English dictionary;
- the privacy document states that MiroraTrack requires no Internet connection,
  backend, cloud database, or cloud synchronization;
- finance data is stored locally;
- backup files are written only to MiroraTrack's local backup folder or an
  alternative location selected by the user;
- there is no advertising analytics or application analytics;
- Microsoft WebView2 may process or send Microsoft-required diagnostics under
  Microsoft and Windows privacy controls; and
- no `zero telemetry`, `zero network`, or `never contacts internet` claim is
  present in the checked live content.

The first content check correctly failed because one required phrase was split
across a Markdown source line. The document formatting was adjusted, and the
repeat check passed all four reported checks.

## Fresh verification

| Check | Result |
| --- | --- |
| `npx vitest run src/features/onboarding/OnboardingPage.test.tsx` | exit `0`; 5/5 tests |
| focused privacy-content check | exit `0`; 4/4 checks |
| `npm run typecheck` | exit `0` |
| `npm test -- --run` | exit `0`; 49 files, 559/559 tests |
| `npm run build` | exit `0`; 2,306 modules transformed |

## Changed and created files

Modified:

- `src/features/onboarding/OnboardingPage.test.tsx`
- `src/i18n/en.ts`

Created:

- `docs/PRIVACY.md`
- `docs/checkpoints/task-14d.md`
- `work/checkpoints/task-14d-before/SHA256SUMS.txt`
- exact before-copies below `work/checkpoints/task-14d-before/`

Current content hashes before this checkpoint document was added:

| Path | SHA-256 |
| --- | --- |
| `src/features/onboarding/OnboardingPage.test.tsx` | `58A187FBEC554CA2FEB8AC6F65457EFFE753A67D533D84A428C9FEBF1E1237F9` |
| `src/i18n/en.ts` | `2D795C684A5B5E58281055F3E0C445BF09950B8B058CA045013A8C1DCE8441D4` |
| `docs/PRIVACY.md` | `5E72EFF040602DF966DE909242A15A50C8B1F0A2E665967F7F4EF78BCF83E773` |

`dist` was refreshed by the production build and is treated as generated output.

## Quality-review correction

The review noted that the initial privacy wording implied every backup location
was selected or configured by the user. Verification against
`src-tauri/src/backup.rs` confirmed that an absent configured directory resolves
to the Documents directory joined with `MiroraTrack` and `Backups`; settings can
instead provide an alternative directory. `docs/PRIVACY.md` now uses the exact
accurate sentence required by review. The 4/4 privacy-content audit, including
the exact backup-location sentence, and the focused 5/5 onboarding suite both
passed after this correction.
