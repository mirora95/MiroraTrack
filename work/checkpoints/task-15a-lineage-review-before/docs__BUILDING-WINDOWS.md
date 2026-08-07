# Building MiroraTrack for Windows

MiroraTrack is a React, TypeScript, Vite, and Tauri 2 application. The release
artifact is a native Windows application; end users do not run Vite, Node.js, a
local web server, or a terminal after installation.

## Supported target

The initial release target is:

```text
x86_64-pc-windows-msvc
```

The application and finance engine contain no CPU-specific branches. A future
Windows on ARM release uses the existing `desktop:build:arm64` script after
adding the Rust `aarch64-pc-windows-msvc` target and the corresponding Visual
Studio ARM64 tools.

## Prerequisites

Install:

1. Node.js 22 or newer, including npm.
2. Visual Studio Community or Visual Studio Build Tools with:
   - **Desktop development with C++**
   - the workload's recommended components
   - MSVC x64/x86 build tools
   - a Windows 10 or Windows 11 SDK
3. Rustup with the stable x64 MSVC toolchain, rustfmt, and clippy.

From an elevated PowerShell prompt, an existing Visual Studio installation can
be updated with:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" modify `
  --installPath "C:\Program Files\Microsoft Visual Studio\18\Community" `
  --add Microsoft.VisualStudio.Workload.NativeDesktop `
  --includeRecommended `
  --passive `
  --norestart
```

Adjust the Visual Studio path when a different edition or version is installed.
If setup returns `3010` or reports a pending restart, restart Windows before
building.

Install Rustup with winget:

```powershell
winget install --id Rustlang.Rustup --exact --silent `
  --accept-package-agreements --accept-source-agreements
```

Open a new shell, then configure the requested toolchain:

```powershell
rustup set profile minimal
rustup toolchain install stable-x86_64-pc-windows-msvc `
  --profile minimal `
  --component rustfmt `
  --component clippy `
  --target x86_64-pc-windows-msvc
rustup default stable-x86_64-pc-windows-msvc
```

## Restore dependencies

Use a Visual Studio **Developer PowerShell for VS** or a shell initialized with
`VsDevCmd.bat`, then run:

```powershell
npm ci
```

The checked-in `src-tauri/Cargo.lock` is authoritative for native dependency
resolution. Do not delete or regenerate it during a normal build.

## Verify the application

Run the web and native verification gates:

```powershell
npm run typecheck
npm test -- --run
npm run build

cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml `
  --all-targets --all-features -- -D warnings

npm run desktop:check
npm run desktop:test
```

All commands must exit successfully before packaging.

## Build an unbundled debug executable

```powershell
npx tauri build --debug `
  --target x86_64-pc-windows-msvc `
  --no-bundle `
  --ci
```

Output:

```text
src-tauri\target\x86_64-pc-windows-msvc\debug\miroratrack.exe
```

Launching this executable directly must open MiroraTrack in its own desktop
window. It does not require `npm run dev` or a local server.

## Build the Windows installer

```powershell
npm run desktop:build:x64
```

The configured bundle target is NSIS with a current-user installation, offline
WebView2 installer, MiroraTrack application icon, and no downgrade support. The
installer output is written below:

```text
src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\
```

The installer and shortcut lifecycle must be verified with the release
checklist before distribution. Application updates must preserve IndexedDB,
localStorage, and backup files. Uninstall handling must never remove finance
records or backups without explicit user confirmation.

### Quarantined two-version acceptance build

The release-acceptance build uses separate Cargo target directories so a
previous-version fixture cannot overwrite the current artifact. It does not
edit the live package, Cargo, Tauri configuration, or lockfiles:

```powershell
powershell -NoProfile -File scripts/Build-Task15Installers.ps1 -Phase All
```

Each version uses a merge-only file below its isolated build directory. The
override sets only that version and `bundle.useLocalToolsDir = true`; it does
not edit the live Tauri configuration. The driver verifies exact Tauri CLI
`2.11.4`, validates the pinned NSIS assets from official GitHub REST metadata,
and exposes only those two hash-verified files through an ephemeral
`127.0.0.1` mirror while Tauri bundles. Exact installers are copied immediately
to:

```text
work\artifacts\task15\unaccepted\0.0.9\
work\artifacts\task15\unaccepted\0.1.0\
```

These paths are deliberately named `unaccepted`. Do not distribute an artifact
until `docs/INSTALLER-VERIFICATION.md` is completed in an isolated Windows
environment. Acceptance must prove that the bundle includes Tauri's offline
WebView2 installer payload, so an end user's first launch does not require a
WebView2 download. It must also prove the NSIS installer is current-user
scoped, creates Desktop and Start menu shortcuts, and contains `NoRepair=1`;
verification therefore tests same-version reinstall rather than claiming
Windows Installer Repair support.

Local installers may be unsigned. Record Authenticode as `NotSigned` rather
than weakening the check. Future signing changes artifact bytes and requires a
new hash plus full host, payload, and lifecycle re-verification.

The completed Task 15A build used `tauri-cli 2.11.4` with
`tauri-bundler 2.9.4`. The loopback request log contains exactly the pinned
NSIS 3.11 archive and `nsis_tauri_utils` 0.5.3 DLL once per installer; no large
WebView2 GET appears in either Tauri build log. Instead, the build driver
pre-acquired the official 209,567,440-byte WebView2 offline installer,
validated SHA-256
`7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`
and its Microsoft signature, then staged the exact bytes in each isolated
target. The resulting installer inputs and their exact hashes are recorded in
`docs/INSTALLER-VERIFICATION.md` and `docs/checkpoints/task-15a.md`; their
location under `unaccepted` is intentional.

The build validates both versioned outputs as same-directory candidates before
publishing either final path. If any copy, metadata check, hash check, or
publication step fails, the previous two-file final set is restored. After a
successful pair publication it writes
`work\artifacts\task15\unaccepted\manifest.json` atomically. Task 15B preflight
must use that manifest rather than copied values from prose documentation.

The reusable static integrity audit is
`scripts\task15\Invoke-Task15FinalIntegrityAudit.ps1`. Supply fresh output and
extraction paths inside a new evidence directory plus the Task 15 log root; the
script refuses to overwrite an existing result or extraction tree.

## Windows on ARM preparation

On an ARM64 build host with the Visual Studio ARM64 tools:

```powershell
rustup target add aarch64-pc-windows-msvc
npm run desktop:build:arm64
```

No React, finance-engine, database, or Tauri command changes are required.
