# Task 13B before checkpoint

Created before installing or repairing the Windows native toolchain.

## Binding constraints

- Work directly in `C:\Users\orasta\Documents\Projects\MiroraTrack`.
- Do not access or modify Git metadata.
- Preserve installer logs under `work/logs/task-13b/`.
- Stop and report accurately if installation reports that a restart is required.
- Do not build an installer in this task; only build and smoke-test the unbundled debug executable.

## Initial toolchain audit

- Visual Studio Community 2026 `18.8.2` is installed at
  `C:\Program Files\Microsoft Visual Studio\18\Community`.
- `vswhere` did not find the Native Desktop workload, x86/x64 VC tools, or a
  Windows 11 SDK requirement match.
- `rustup`, `rustc`, `cargo`, `cl`, `link`, and `rc` were not available on the
  ordinary process `PATH`.
- `winget` was available at
  `C:\Users\orasta\AppData\Local\Microsoft\WindowsApps\winget.exe`.
- Component Based Servicing and Windows Update did not report a pending reboot.
- `PendingFileRenameOperations` was absent.

## Pre-task file hashes

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `package.json` | 1,670 | `F89F24C129DA8BE193E7689E5FFD407CBBDE01C8F3947ABA4B1F3441BC6F7FF0` |
| `package-lock.json` | 119,791 | `2503A6C7C7050828FB73ECF1B4E993C4BAC9D4C3A3F9BF9882366542E1680B2C` |
| `src-tauri/Cargo.toml` | 775 | `1C27C377FB71BD719973E0CBAECAAF0A76C3E66EBD6616E3989CA7B3FD63E031` |
| `src-tauri/tauri.conf.json` | 1,661 | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `src-tauri/src/lib.rs` | 439 | `1440140DD99677B5A4DF6D3E67A40F227E0674E0EB784A0CA12DABF61743550D` |
| `src-tauri/src/main.rs` | 188 | `879D5569338D39C8DDFC91A12974EF670AAC5BA7FC40F1464832ED32618A9AA4` |
| `src-tauri/src/backup.rs` | 20,430 | `151574FCD0C44BC1217F3204055097861441691B13ADD4D479124696EBA5EC62` |

