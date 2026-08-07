# Task 14A — Browser quality, accessibility, and performance

## Scope

Browser-side verification only. No Tauri, Rust, installer, Visual Studio, or
restart-sensitive files were changed.

## Implemented

- Playwright Chromium harness whose isolated entry installs official Tauri JS
  mocks before dynamically importing the unchanged production entry.
- Real IndexedDB/Dexie and application services in every E2E flow; only native
  window and backup/file IPC is mocked.
- Network guard that aborts every non-loopback request.
- Core ledger flow coverage for onboarding, accounts, income, expense,
  transfer, budget, dashboard drill-down, Activity, JSON export/restore, CSV
  export, and backup-folder permission recovery.
- Reload persistence coverage for finance records, derived state, preferences,
  and themes.
- Axe WCAG A/AA moderate-or-higher checks across onboarding, every ready route,
  transaction/budget/restore dialogs, settings, and export states; page-error and
  console-error collection on every E2E test; keyboard dialog/focus containment, reduced-motion,
  forced-colors, offline-by-construction reload, and console-error checks.
- A deterministic 10,000-transaction fixture with cold dashboard, cache-hit
  no-recompute, and responsive filtering performance guardrails.
- Lazy feature routes and lazy chart chunks with intentional vendor splitting.
- Stronger light-theme tertiary text contrast plus Windows forced-colors and
  reduced-motion styles.

## Files created

- `e2e.html`
- `playwright.config.ts`
- `tests/e2e/coreFlows.spec.ts`
- `tests/e2e/persistence.spec.ts`
- `tests/e2e/accessibilityOffline.spec.ts`
- `tests/e2e/support/flows.ts`
- `tests/e2e/support/harness.ts`
- `tests/e2e/support/nativeMocks.ts`
- `tests/e2e/support/quality.ts`
- `tests/fixtures/ten-thousand-transactions.ts`
- `tests/performance/tenThousandTransactions.test.ts`

## Files modified

- `.gitignore`
- `package.json`
- `package-lock.json`
- `src/app/App.tsx`
- `src/features/onboarding/OnboardingPage.tsx`
- `src/styles/index.css`
- `src/styles/tokens.css`
- `tests/architecture/featureArchitecture.test.ts`
- `vite.config.ts`
- `vitest.config.ts`

## Checkpoint

The pre-edit copies and SHA-256 manifest are in
`work/checkpoints/task-14a-before/`. Git metadata was not accessed or changed.

## Verification

Fresh review-fix verification on 2026-07-31:

- `npm run test:e2e`: 7/7 passed in Chromium.
- `npm run typecheck`: passed.
- `npm test`: 49 files and 559/559 tests passed.
- `npm run build`: passed (Vite 8.1.5, 2,306 modules transformed).

Native verification remains outside this browser-only task.

## Review-fix verification additions

- Exact committed income, expense, and transfer rows plus ledger-derived account balances.
- Exact budget planned/spent/remaining/health and dashboard KPI/drill-down values.
- Restore round-trip proves destructive mutations disappear and the exported records return after reload.
- Permission denial recovery proves an alternative folder can successfully back up without changing finance data.
- Reload proves exact derived balances, theme, and selected display currency persistence.
- The stronger gate exposed and fixed two real product defects: onboarding progress now has
  progressbar semantics, and the light-theme income foreground meets normal-text contrast.
