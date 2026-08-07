# Task 14B Encoded-Argument Rerun Before-Checkpoint

Captured 2026-08-03 before the mandatory encoded-wrapper preflight and fresh contiguous gate. This checkpoint is additive and preserves both earlier blocked histories and their evidence.

## Scope controls

- The unchanged native wrapper is invoked only through an in-memory JSON/Base64 transport in the new evidence harness.
- No application source, test, configuration, manifest, lockfile, or native wrapper may change.
- No repository-attributable process was running at capture time.
- No Git command was run and Git metadata was not accessed.

## Protected hashes

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `package.json` | 1,744 | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | 120,664 | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | 789 | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | 111,243 | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | 1,661 | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `work/toolchain/Invoke-Task13bNative.ps1` | 1,693 | `92F9591956493A291CCF645E975EE2D90ED1E29A909EABB7147CC62CF771841E` |

## System and tool state

- Windows last boot: `2026-08-03T08:59:44.5000000+05:00`
- Node: `v24.14.1`
- npm: `11.13.0`
- Windows PowerShell: `5.1.26100.8875`
- rustc: `1.97.1 (8bab26f4f 2026-07-14)`
- Cargo: `1.97.1 (c980f4866 2026-06-30)`
- Tauri CLI: `2.11.4`

## Exact pending-file-rename queue

The read-only registry value contained this exact six-string array:

```json
["*1\\??\\C:\\Program Files (x86)\\Microsoft\\Edge\\Temp\\20396_455905472\\old_msedge.exe","","*1\\??\\C:\\Program Files (x86)\\Microsoft\\Edge\\Temp\\20396_455905472","","*1\\??\\C:\\Program Files (x86)\\Microsoft\\Edge\\Temp",""]
```

All three non-empty entries are Microsoft Edge temporary deletion entries. No entry names MiroraTrack, WebView2 installer/build tooling, Cargo, Rust, MSVC, Windows SDK, Node, npm, Vite, or Tauri.
