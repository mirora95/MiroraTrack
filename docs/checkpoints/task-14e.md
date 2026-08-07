# Task 14E — Windows Sandbox functional-offline harness

## Status

**BLOCKED** on 2026-08-03 at the binding guest preflight. The stock Windows
Sandbox image on this machine does not contain a local Microsoft WebView2
runtime. The harness did not download a runtime and did not launch MiroraTrack,
Node, Playwright, CDP, or any functional test after that condition was proven.

This is verification of the staged x64 debug executable. It is not Task 15
installer lifecycle verification.

## File-based checkpoint and scope

`work/checkpoints/task14e-before/manifest.md` was created before implementation.
The Task 14E script, run, log, and checkpoint paths did not previously exist.

No production application source, application test, configuration, dependency,
manifest, lockfile, or native wrapper was edited. Generated `dist/` and
`src-tauri/target/` output refreshed during the required builds. No Git command
was run and Git metadata was not accessed.

The six protected hashes remain exactly equal to the before-checkpoint:

| Path | SHA-256 |
| --- | --- |
| `package.json` | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `work/toolchain/Invoke-Task13bNative.ps1` | `92F9591956493A291CCF645E975EE2D90ED1E29A909EABB7147CC62CF771841E` |

## Test-first harness validation

The first static-validator run was RED because the controller, WSB template,
guest controller, guest JavaScript, and dialog watcher did not exist. The clean
RED is `work/logs/task14e/tdd-red-static-validator.log`.

After implementation, the validator passed its XML, exact mapping, prohibited
mutation, PowerShell parser, required controller-control, and `node --check`
gates. Two runner defects discovered during execution also received explicit
RED/GREEN cycles:

- `tdd-red-sandbox-session-tracking.log` / `tdd-green-sandbox-session-tracking.log`:
  replaced GUI-process lifetime assumptions with exact `wsb.exe` environment-ID
  start/list/stop tracking;
- `tdd-red-connect-user-session.log` / `tdd-green-connect-user-session.log`:
  requires `ConnectToSandbox` so the user session exists and `LogonCommand`
  executes.

The final fresh static invocation exited `0` with:

```text
Task 14E static harness validation: PASS
```

## Isolation configuration

The generated `.wsb` has exactly two run-specific host mappings:

- `<run>/input` to `C:\MTInput`, read-only;
- `<run>/evidence` to `C:\MTEvidence`, writable.

Networking, vGPU, audio input, video input, printer redirection, and clipboard
redirection are all disabled. No repository, user profile, Documents directory,
or native toolchain directory is mapped. `LogonCommand` is a fixed invocation of
`C:\MTInput\guest.ps1`.

The controller stages only the fresh `miroratrack.exe`, host `node.exe`, the
local Playwright Core package, the guest/controller dialog scripts, and a hash
manifest. The latest input manifest contains 116 files. The application binary
is 14,027,264 bytes with SHA-256
`0AC2DF39A9A1269B4A0B20047E19136206A66210E441604D802D4FC20D0A99AC`.

## Fresh host build and audit

Run `20260803-144909-2d937f0e` performed:

- `npm run build`: exit `0`; Vite production output completed;
- encoded-argument, kill-on-close Job Object invocation of
  `npx tauri build --debug --target x86_64-pc-windows-msvc --no-bundle --ci`:
  exit `0`; x64 debug executable built;
- host offline audit: PASS; 39 URL literals were retained and classified, with
  zero unclassified remote literals, zero executable remote network sinks, and
  no hosting configuration.

An initial host-audit attempt stopped before staging because it treated
standards namespaces and dependency diagnostic-documentation strings as
endpoints. The corrected audit preserves every literal in evidence while
separately and strictly rejecting hard-coded remote `fetch`, WebSocket,
EventSource, HTML `src`/`href`, or unclassified remote URL sinks.

## Guest preflight evidence

The authoritative guest result is:

`work/sandbox/task14e/20260803-144909-2d937f0e/evidence/result.json`

Before blocking, it proved:

- writes, renames, and deletes in `C:\MTInput` were denied;
- atomic write-and-promote in `C:\MTEvidence` succeeded;
- every staged file matched its manifest SHA-256;
- usable IPv4 default routes: `0`;
- `example.com` DNS resolution failed;
- external HTTPS failed in `0.167` seconds;
- public TCP failed;
- pre-existing Node/Vite processes: `0`;
- no local WebView2 runtime executable could be found.

The exact terminal message is:

```text
BLOCKED: local Microsoft WebView2 runtime is absent; the guest must never download it.
```

The stop occurred before debug application launch, so no claim is made for
native UI flows, automatic backup behavior, JSON/CSV dialogs, restore safety,
persistence, canary containment, CDP, or the final normal-mode smoke.

## Diagnostic history and cleanup

The first `.wsb` launch exposed a Windows 11 24H2 lifecycle detail: the
`WindowsSandbox.exe` remote-session window exited while the sandbox environment
remained alive. A read-only `wsb.exe` diagnostic against that exact run ID
confirmed both mappings, the guest script, and the already-written BLOCKED
result. It wrote only `diagnostic.json` into that run's evidence folder. The
controller was then corrected through the RED/GREEN cycle above.

The confirmation run proved that `StartSandbox` alone creates the environment
but `ConnectToSandbox` is needed to establish the active user session that runs
`LogonCommand`; this also received a RED/GREEN validator cycle. Both disposable
environments were terminated by their exact IDs after evidence preservation.
Final `wsb list --raw` returned an empty environment list.

## Created files

Source-like harness files:

- `scripts/windows-sandbox/task14e/Test-HarnessStatic.ps1`
- `scripts/windows-sandbox/task14e/Invoke-Task14E.ps1`
- `scripts/windows-sandbox/task14e/sandbox.wsb.template`
- `scripts/windows-sandbox/task14e/guest.ps1`
- `scripts/windows-sandbox/task14e/guest.js`
- `scripts/windows-sandbox/task14e/dialog-watcher.ps1`
- `docs/checkpoints/task-14e.md`

Evidence and generated run files are confined to:

- `work/checkpoints/task14e-before/`
- `work/logs/task14e/`
- `work/sandbox/task14e/`

No files outside the approved Task 14E scope were intentionally changed apart
from the allowed generated `dist/` and `src-tauri/target/` outputs.

## Harness hashes

| File | SHA-256 |
| --- | --- |
| `dialog-watcher.ps1` | `C0C2C3DEFB4FB1FA68DB8D46BA04315CB7609A3D4D14D7E0D412965C38F97388` |
| `guest.js` | `BA0D721DF4E7CDA4E33EC201EA9695B0730711816A72DAD3578F3B6F273D17A4` |
| `guest.ps1` | `210163C99B5FEE50E5F5717F65B30C2C1F2DC7A4D25CB0BD52B00FC950FBBF3A` |
| `Invoke-Task14E.ps1` | `0E04118974B4B1551DA21CC60F356EFDA556FA8D76D0E88342E9EF36890706E6` |
| `sandbox.wsb.template` | `1EAF16A0980D2C2711AE524BA5E105434941D25CE92B1BCF0F94F10F2D4068E4` |
| `Test-HarnessStatic.ps1` | `F4B0CB815EFBE11B47C5F3D9C1202FE5B970E67CEF00A4F6D00A4E349DBEF272` |
