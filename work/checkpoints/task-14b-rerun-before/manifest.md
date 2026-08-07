# Task 14B Rerun Before-Checkpoint

Captured 2026-08-03 after the approved harness-remediation specification was received and before the fresh rerun. This checkpoint is additive; it does not replace or alter the preserved failed-attempt evidence under `work/logs/task-14b/`.

## Root-cause boundary

The prior outer Windows PowerShell used `$ErrorActionPreference = Stop` around native invocation. Ordinary Cargo progress written to stderr was promoted to a terminating `NativeCommandError` before the harness captured the actual process exit code. The remediation is confined to a new harness under `work/logs/task-14b-rerun/`: it starts each native process with `Start-Process -Wait -PassThru`, redirects stdout and stderr to distinct files, captures `Process.ExitCode`, and only then rejects unexpected nonzero exits.

## Protected hashes before rerun

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `package.json` | 1,744 | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | 120,664 | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | 789 | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | 111,243 | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | 1,661 | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `work/toolchain/Invoke-Task13bNative.ps1` | 1,693 | `92F9591956493A291CCF645E975EE2D90ED1E29A909EABB7147CC62CF771841E` |

## System state before rerun

- Windows last boot: `2026-08-03T08:59:44.5000000+05:00`
- No repository-attributable process was running.
- The pending-file-rename queue was read only and contained the same six strings (three delete pairs) already recorded in `work/checkpoints/task-14b-before/manifest.md`, all below `C:\Program Files (x86)\Microsoft\Edge\Temp`.
- No queue entry named MiroraTrack, WebView2 installer/build tooling, Cargo, Rust, MSVC, Windows SDK, Node, npm, Vite, or Tauri.
- No Git command or Git metadata access was performed.

