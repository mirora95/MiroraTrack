# Task 07 — premium design system and desktop shell

Completed: 2026-07-29

## Implementation summary

Task 07 replaces the centered scaffold with an offline-safe, hash-routed
desktop shell. It adds a midnight gradient sidebar, route-aware header,
accessible theme and collapse preferences, polished neutral route
placeholders, and reusable UI primitives. The shell contains no finance,
onboarding, chart, backup, or persistence workflow logic.

The visual system uses local CSS only. Semantic design tokens provide layered
light and dark surfaces, status colors, action colors, 16/18/20 px panel
radii, three elevation levels, focus states, reduced-motion behavior, and the
Windows system font stack. No remote font, image, analytics, or network asset
was introduced.

Preferences are limited to theme and collapsed-sidebar state, stored under
`miroratrack.preferences.v1`. Storage and media-query failures fall back
without blocking render. System-theme changes are observed only in System
mode.

## Created files

- `src/styles/tokens.css`
- `src/styles/index.css`
- `src/components/Button.tsx`
- `src/components/Card.tsx`
- `src/components/EmptyState.tsx`
- `src/components/Dialog.tsx`
- `src/components/StatusState.tsx`
- `src/app/AppShell.tsx`
- `src/app/Sidebar.tsx`
- `src/app/Header.tsx`
- `src/stores/preferences.ts`
- `src/app/AppShell.test.tsx`
- `work/checkpoints/task-07-before/manifest.md`
- `docs/checkpoints/task-07.md`

## Modified files

- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/main.tsx`

## Removed files

- `src/app/App.css`
- `src/index.css`

## Verification

- Focused shell command:
  `npm test -- --run src/app/App.test.tsx src/app/AppShell.test.tsx`
  — passed, 12 tests across 3 discovered test files.
- Type check: `npm run typecheck` — passed.
- Full suite: `npm test -- --run` — passed, 184 tests across 15 files.
- Production build: `npm run build` — passed; Vite emitted static assets in
  `dist`.
- Lint: not run because the project has no lint script or lint configuration.

## Visual verification status

The local Vite preview started successfully on `127.0.0.1`, confirming the
development render harness was available. The approved browser-control
runtime reported no available browser, so the required 1440×920 light/dark,
1080×720, and narrow screenshots could not be captured or visually inspected
in this task session.

Responsive, collapsed, dark-theme, focus, and reduced-motion behavior is
implemented in CSS and covered semantically where possible, but screenshot
inspection remains an explicit verification item for the independent review
or a later environment with an available browser.

## Scope and safety

- No Git command or Git metadata access was used.
- No existing finance, database, application-service, or Tauri backup file was
  changed.
- The before checkpoint contains the replaced scaffold files.

## Independent-review follow-up

Completed: 2026-07-29

The four review findings were addressed:

1. The 640 px layout now presents all six destinations as a compact icon
   navigation row. The theme chooser remains visible, and quick add becomes an
   accessible icon-sized control.
2. Dialog initial focus now prefers a body control, then any dialog control,
   then the focusable panel. A dialog with no interactive body content focuses
   its close button and keeps Tab inside.
3. Light-theme status states now use separate, darker semantic foreground
   tokens. Automated contrast calculations cover each actual tinted
   background and require at least 4.5:1.
4. `index.html` now applies a stored or system-resolved theme before loading
   the application module. Invalid JSON, denied storage, and unavailable media
   queries fall back safely.

Follow-up files:

- Modified `index.html`
- Modified `src/app/Header.tsx`
- Modified `src/app/AppShell.test.tsx`
- Modified `src/components/Dialog.tsx`
- Modified `src/styles/index.css`
- Modified `src/styles/tokens.css`
- Modified `docs/checkpoints/task-07.md`

Follow-up verification:

- Focused command:
  `npm test -- --run src/app/App.test.tsx src/app/AppShell.test.tsx`
  — passed, 16 tests.
- `npm run typecheck` — passed.
- `npm test -- --run` — passed, 188 tests across 15 files.
- `npm run build` — passed; static assets emitted to `dist`.
