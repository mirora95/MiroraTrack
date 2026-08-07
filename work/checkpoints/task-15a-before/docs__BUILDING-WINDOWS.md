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

## Windows on ARM preparation

On an ARM64 build host with the Visual Studio ARM64 tools:

```powershell
rustup target add aarch64-pc-windows-msvc
npm run desktop:build:arm64
```

No React, finance-engine, database, or Tauri command changes are required.

