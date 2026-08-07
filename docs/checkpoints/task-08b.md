# Task 08B — Onboarding and accounts UI

## Implementation summary

Added the production dependency composition, initialization route guard, a
full-window four-step first-run experience, and the Accounts workspace. React
components depend only on application-facing interfaces. Production creates
one database connection, read repository, unit of work, initialization service,
and account service.

The initialization guard derives first-run state exclusively from
`InitializationService`. It displays loading and protected recovery states,
keeps onboarding outside `AppShell`, and replaces navigation when redirecting
between onboarding and the initialized workspace.

Onboarding supports base currency, date format, a first account in an
independent currency, type/icon/color, credit limit, and signed opening balance.
Values survive Back/Continue navigation, invalid money is announced inline,
submissions cannot be duplicated, and no demo data is created.

Accounts displays ledger-derived balances in each account's own currency
without cross-currency totals. It covers loading, retry, empty, all-archived,
active/archived groups, create, edit, archive confirmation, reactivation,
operation feedback, and accessible dialog behavior.

## Created files

- `src/app/runtime.tsx`
- `src/app/productionRuntime.ts`
- `src/features/onboarding/OnboardingPage.tsx`
- `src/features/onboarding/OnboardingPage.test.tsx`
- `src/features/accounts/AccountForm.tsx`
- `src/features/accounts/AccountsPage.tsx`
- `src/features/accounts/AccountsPage.test.tsx`
- `work/checkpoints/task-08b-before/manifest.md`
- `work/checkpoints/task-08b-before/src/app/App.tsx`
- `work/checkpoints/task-08b-before/src/i18n/en.ts`
- `work/checkpoints/task-08b-before/src/styles/index.css`

## Modified files

- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/app/AppShell.test.tsx`
- `src/i18n/en.ts`
- `src/styles/index.css`

## Verification

- Focused UI tests: onboarding, accounts, App routing, and AppShell
- TypeScript strict typecheck
- Complete Vitest suite
- Production Vite build

There is no lint script in `package.json`, so no separate lint command exists.
The in-app browser was unavailable during visual QA; responsive and
accessibility behavior is covered by Testing Library and CSS contract tests,
but installed-window visual inspection remains for the later desktop/E2E task.

## Scope boundaries

No transaction form persistence, quick-add implementation, dashboard charts,
budgets, settings backup workflows, Tauri native code, installer code, or Git
metadata was changed.

## Review follow-up

The independent code-quality review identified and the implementation now
addresses three asynchronous-state gaps:

- A rejected production runtime boot clears only that failed cached promise, so
  the recovery action starts a fresh boot while concurrent and successful boots
  remain shared.
- Account create/edit dialogs become non-dismissible for the full pending save:
  Escape, backdrop, close control, and Cancel are blocked. A later failure
  restores dismissal, retains the entered values, and keeps the dialog open.
- Reactivation has a per-account synchronous in-flight guard and disabled busy
  state, preventing rapid clicks from producing duplicate service calls or
  audits.

Regression coverage was added in:

- `src/app/productionRuntime.test.ts`
- `src/features/accounts/AccountsPage.test.tsx`

The shared `Dialog` primitive gained a backward-compatible `dismissible`
property; existing dialogs remain dismissible by default.
