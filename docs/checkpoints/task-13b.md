# Task 13B — Windows native toolchain and debug executable

## Outcome

Task 13B generated and retained the Rust lockfile, brought the x64 MSVC Rust
toolchain online, compiled and tested the native backup layer, and built and
launched the unbundled Tauri debug executable.

Visual Studio Community 2026 `18.8.2` was already installed, but its registered
installation did not include the complete Native Desktop workload. The required
passive/no-restart repair was attempted through the installed setup engine:

```text
C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe
```

The first invocation returned `87` because this installer version does not
accept `--wait`; `Start-Process -Wait` already provided the wait behavior. The
corrected non-elevated invocation returned `5007` with the explicit diagnostic
that passive operations must begin elevated. The elevated invocation reached
the Windows UAC boundary and was canceled before setup began. No restart was
requested and Windows did not report a pending reboot.

The machine nevertheless contained the x64 compiler/linker and Microsoft's
Windows SDK BuildTools NuGet package. To finish verification without mutating
application architecture, matching official Microsoft
`Microsoft.Windows.SDK.CPP` and `Microsoft.Windows.SDK.CPP.x64`
`10.0.26100.7705` packages and the matching VC `14.50.35717` header payload
were unpacked under ignored `work/toolchain/` for this session. This fallback is
not a runtime dependency and is not part of the shipped application.

## Installed toolchain

- Rustup: `1.29.0`
- Rust: `rustc 1.97.1 (8bab26f4f 2026-07-14)`
- Cargo: `1.97.1 (c980f4866 2026-06-30)`
- rustfmt: `1.9.0-stable`
- clippy: `0.1.97`
- Rust host and target: `x86_64-pc-windows-msvc`
- Rust profile: minimal
- MSVC compiler: `19.51.36252`, x64
- MSVC linker: `14.51.36252.0`, x64
- Windows SDK tools and headers/libs: `10.0.26100.7705` package,
  `10.0.26100.0` SDK layout

Installed Rust components:

```text
cargo-x86_64-pc-windows-msvc
clippy-x86_64-pc-windows-msvc
rust-std-x86_64-pc-windows-msvc
rustc-x86_64-pc-windows-msvc
rustfmt-x86_64-pc-windows-msvc
```

## Created files

- `src-tauri/Cargo.lock`
- `docs/BUILDING-WINDOWS.md`
- `docs/checkpoints/task-13b.md`
- `work/checkpoints/task-13b-before/manifest.md`
- `work/toolchain/Invoke-Task13bNative.ps1` (ignored local verification helper)
- retained Visual Studio diagnostics under `work/logs/task-13b/`

## Modified files

- `.gitignore` now contains the exact repository-root rule
  `/work/toolchain/`, preventing the retained local SDK/MSVC verification
  fallback from being included accidentally without ignoring similarly named
  directories elsewhere.

Rustfmt normalized:

- `src-tauri/build.rs`
- `src-tauri/src/backup.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`

`src-tauri/src/backup.rs` also removed two impossible native enum variants,
`DialogFailed` and `Unknown`, after the required clippy gate proved they were
dead code. The TypeScript adapter boundary still retains both safe fallback
codes.

## Native test and build evidence

- Static ignore verification:
  `rg -n '^/work/toolchain/$' .gitignore` reports the exact root-only rule once.

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: pass.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 5 passed,
  0 failed.
- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets
  --all-features -- -D warnings`: pass with zero warnings.
- `npm run desktop:check`: pass.
- `npm run desktop:test`: 5 passed, 0 failed.
- `npx tauri build --debug --target x86_64-pc-windows-msvc --no-bundle
  --ci`: pass.

Built artifact:

```text
src-tauri\target\x86_64-pc-windows-msvc\debug\miroratrack.exe
```

- Size: `14,004,224` bytes.
- SHA-256:
  `AD08B10646A695830988036E51581A3A5348B512576C918BD529E2A1D561930D`.

## Desktop smoke evidence

The executable was launched directly, without Vite or another local server.

- Native process opened a main window titled `MiroraTrack`.
- The process opened no new listening TCP port.
- WebView2 created the application-scoped profile at
  `%LOCALAPPDATA%\com.miroratrack.desktop\EBWebView`.
- The profile contains both `Default\IndexedDB` and
  `Default\Local Storage`, confirming that the packaged origin has the local
  persistence facilities required by the application.
- A normal close-window request succeeded and the process exited with code `0`.

Automated TypeScript tests remain the binding coverage for CSP-safe startup,
hash routing, IndexedDB migrations, preference/theme restoration, window
settings, and native command adapters. Interactive file-dialog smoke remains
part of the installer lifecycle task.

## Restart-required stop

The final post-build audit found `PendingFileRenameOperations` entries that
were not present in the pre-task audit. Component Based Servicing and Windows
Update still report no reboot-pending keys. The queued paths belong to an
Office Click-to-Run update and a printer-driver update, not to the rejected
Visual Studio repair or Rustup, but Windows now has a restart-required signal.
No further native installation or packaging work was performed after detecting
it. Restart Windows before Task 14/15 native lifecycle verification.

## Known advisory

The production Vite build still reports the existing main-chunk size advisory
(`648.38 kB` minified). It is unchanged and remains assigned to the final
performance task.

## Git

No Git metadata was initialized, deleted, rewritten, repaired, or accessed.
