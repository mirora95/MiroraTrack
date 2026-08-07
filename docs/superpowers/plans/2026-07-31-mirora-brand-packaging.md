# MiroraTrack Brand Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved original MiroraTrack logo consistently in the React interface, Windows executable, NSIS installer, Desktop shortcut, and Start menu shortcut.

**Architecture:** The approved 1024×1024 RGBA raster is the sole source for generated platform icons. React uses a deterministic code-native `LogoMark` that echoes the same mirrored blue/teal form and gold tracking accent without importing the large raster into the application shell. Tauri configuration owns installer branding, offline WebView2 packaging, CSP, versioning, and explicit x64/ARM64 build scripts.

**Tech Stack:** React, TypeScript, Vitest, CSS, Vite, Tauri 2, Cargo, NSIS

**Workflow constraint:** Do not access or modify Git metadata. Use file-based checkpoints and record exact verification output.

---

### Task 1: Validate the approved raster and generate platform icons

**Files:**
- Use: `assets/branding/miroratrack-icon-1024.png`
- Replace generated files under: `src-tauri/icons/`
- Create: `work/checkpoints/task-13a-before/manifest.md`

- [ ] **Step 1: Create the before-checkpoint manifest**

Record SHA-256, byte length, dimensions, and pixel format for the approved source and every current file in `src-tauri/icons/`. Copy every icon/config file that will be replaced into the checkpoint directory with a `.bak` suffix.

- [ ] **Step 2: Validate the approved source**

Run a PowerShell `System.Drawing` inspection and require:

```text
Width = 1024
Height = 1024
PixelFormat = Format32bppArgb
```

Fail without generating icons if any condition differs.

- [ ] **Step 3: Generate Tauri icons**

Run:

```powershell
npx tauri icon assets/branding/miroratrack-icon-1024.png
```

Expected: Windows `.ico`, PNG sizes, macOS `.icns`, and mobile icon assets are regenerated under `src-tauri/icons/`.

- [ ] **Step 4: Verify icon coverage**

Inspect `src-tauri/icons/icon.ico` and require embedded 16, 32, 48, and 256 pixel representations. Generate temporary 16, 32, and 48 pixel previews and verify the mirrored form and gold center remain recognizable.

- [ ] **Step 5: Verify no default Tauri asset remains**

Compare generated icon hashes against the checkpoint and inspect representative files. Record that every shipping icon derives from the approved source.

---

### Task 2: Add the code-native LogoMark

**Files:**
- Create: `src/components/LogoMark.tsx`
- Create: `src/components/LogoMark.test.tsx`
- Modify: `src/styles/index.css`

- [ ] **Step 1: Write the failing LogoMark tests**

Test:

```tsx
render(<LogoMark label="MiroraTrack" />)
expect(screen.getByRole("img", { name: "MiroraTrack" })).toBeVisible()
expect(screen.getByTestId("logo-mirrored-form")).toBeInTheDocument()
expect(screen.getByTestId("logo-track-accent")).toBeInTheDocument()
```

Also test decorative mode:

```tsx
render(<LogoMark decorative />)
expect(screen.queryByRole("img")).not.toBeInTheDocument()
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npm test -- --run src/components/LogoMark.test.tsx
```

Expected: failure because `LogoMark.tsx` does not exist.

- [ ] **Step 3: Implement the mark**

Create an inline SVG component with:

```ts
interface LogoMarkProps {
  label?: string
  decorative?: boolean
  className?: string
}
```

The SVG must use a midnight rounded tile, mirrored blue/teal paths, and one restrained gold track/highlight. Decorative mode sets `aria-hidden="true"`; named mode uses `role="img"` and the supplied label.

- [ ] **Step 4: Add semantic styles**

Use existing design tokens. The mark must size through `1em`, preserve aspect ratio, and remain legible at 24, 32, and 48 pixels. Do not embed remote assets or a raster data URL.

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run:

```powershell
npm test -- --run src/components/LogoMark.test.tsx
```

Expected: all LogoMark tests pass.

---

### Task 3: Apply approved branding throughout the interface

**Files:**
- Modify: `public/favicon.svg`
- Modify: `src/app/Sidebar.tsx`
- Modify: `src/features/onboarding/OnboardingPage.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/index.css`
- Modify tests beside the affected components

- [ ] **Step 1: Write failing branding integration assertions**

Assert that:

```tsx
expect(screen.getByText("MiroraTrack")).toBeVisible()
expect(screen.getByRole("img", { name: /MiroraTrack/ })).toBeVisible()
```

Cover expanded sidebar, collapsed decorative mark, onboarding, startup loading, and recovery-required states.

- [ ] **Step 2: Run focused integration tests and confirm RED**

Run:

```powershell
npm test -- --run src/app/App.test.tsx src/app/AppShell.test.tsx src/features/onboarding/OnboardingPage.test.tsx
```

Expected: new LogoMark assertions fail.

- [ ] **Step 3: Integrate LogoMark**

Use the approved mark plus `MiroraTrack` wordmark in expanded sidebar, onboarding, startup, and recovery. Collapsed navigation uses the mark alone with an accessible product name supplied by the surrounding link.

- [ ] **Step 4: Replace the favicon**

Create a compact SVG approximation of the same approved mark. Keep it local, text-free, and readable at browser favicon sizes.

- [ ] **Step 5: Run focused integration tests and confirm GREEN**

Run the command from Step 2 and require all tests to pass.

---

### Task 4: Configure Windows packaging and build scripts

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Add focused config tests if no existing config-validation test can express these assertions

- [ ] **Step 1: Write failing configuration assertions**

Load the three JSON/TOML manifests and assert:

```text
version = 0.1.0 everywhere
identifier = com.miroratrack.desktop
targets = ["nsis"]
installMode = currentUser
allowDowngrades = false
webviewInstallMode.type = offlineInstaller
installerIcon = icons/icon.ico
uninstallerIcon = icons/icon.ico
```

Assert the production CSP contains the approved directives and does not contain `*`.

- [ ] **Step 2: Run the config test and confirm RED**

Run the focused config test. Expected: current version/CSP/WebView2/icon assertions fail.

- [ ] **Step 3: Update packaging metadata**

Keep the identifier permanently unchanged. Synchronize version `0.1.0`, finance category, product descriptions, repository metadata, current-user NSIS target, downgrade prevention, offline WebView2 installer, and explicit installer/uninstaller icons.

- [ ] **Step 4: Add the restrictive CSP**

Configure:

```text
default-src 'self';
connect-src ipc: http://ipc.localhost;
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';
font-src 'self';
object-src 'none';
base-uri 'none';
frame-src 'none'
```

- [ ] **Step 5: Remove unused JavaScript Tauri plugins**

First run:

```powershell
rg -n "@tauri-apps/plugin-(fs|os|dialog)" src tests
```

Only remove unused JavaScript dependencies when the search returns no imports. Retain the Rust dialog plugin because native backup commands use it.

- [ ] **Step 6: Add explicit desktop scripts**

Add:

```json
"desktop:check": "cargo check --locked --manifest-path src-tauri/Cargo.toml",
"desktop:test": "cargo test --locked --manifest-path src-tauri/Cargo.toml",
"desktop:build:x64": "tauri build --target x86_64-pc-windows-msvc --bundles nsis --ci",
"desktop:build:arm64": "tauri build --target aarch64-pc-windows-msvc --bundles nsis --ci"
```

No application source may branch on CPU architecture.

- [ ] **Step 7: Run the complete Task 13A gate**

Run:

```powershell
npm test -- --run src/components/LogoMark.test.tsx
npm run typecheck
npm test -- --run
npm run build
```

Expected: all tests and typecheck pass; Vite production build succeeds. Record any existing chunk advisory for Task 14 rather than increasing its threshold.

- [ ] **Step 8: Record the implementation checkpoint**

Create `docs/checkpoints/task-13a.md` with:

- generated and modified files;
- source image dimensions/mode and SHA-256;
- final image-generation prompt summary;
- verification commands and exact counts;
- confirmation that rejected comparison mockups were not copied into shipping assets;
- confirmation that no Git metadata was accessed.
