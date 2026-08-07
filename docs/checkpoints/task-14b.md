# Task 14B — Full Verification Gate

## Status

**BLOCKED** on 2026-08-03. The source-frozen acceptance gate stopped during the native-test evidence harness. No application source or protected manifest changed.

## Before-gate controls

- No repository-scoped Vite/dev-preview process was running.
- `work/checkpoints/task-14b-before/manifest.md` records the protected file hashes, reboot state, tool versions, and exact pending-file-rename queue.
- No `node_modules` backup was created.
- The pending queue was read only and never altered.
- The queue before and after was identical: six strings representing three delete pairs, all below `C:\Program Files (x86)\Microsoft\Edge\Temp`.

## Contiguous acceptance attempt

The following steps completed with exit code 0 in the fresh full attempt:

1. `npm ci --cache work/npm-cache` — installed 198 packages; npm reported two high-severity dependency advisories.
2. `npm run typecheck` — passed.
3. `npm test -- --run` — 49 files and 559/559 tests passed.
4. `npm run test:e2e` — 7/7 Playwright Chromium tests passed.
5. `npm run build` — passed; Vite 8.1.5 transformed 2,306 modules.
6. Through `work/toolchain/Invoke-Task13bNative.ps1`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` — passed.

The next intended command was:

```text
cargo test --locked --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
```

Cargo began and emitted the ordinary progress line `Compiling tauri v2.11.5` on stderr. The outer Windows PowerShell evidence harness had `$ErrorActionPreference = Stop` and classified that stderr record as a terminating `NativeCommandError`. The harness therefore stopped before it could capture Cargo's exit code or test result. This is an evidence-harness invocation failure, not evidence of a Rust compile/test failure.

An earlier wrapper attempt also stopped before Cargo executed because `powershell.exe -File` could not bind the forwarded remaining arguments. That attempt is preserved in `00-native-wrapper-invocation-failure.log`; the declared wrapper parameters were corrected before the full acceptance attempt.

Per the stop-on-failure rule, the following were not run after the interruption:

- Cargo test completion/result capture;
- Clippy with `-D warnings`;
- fresh Tauri debug build;
- native launch/window/TCP/exit/artifact evidence;
- offline configuration/source/dist endpoint audit.

No success is claimed for those unexecuted checks.

## Protected hashes after interruption

All match the before-gate manifest exactly:

| Path | SHA-256 |
| --- | --- |
| `package.json` | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |

No repository-scoped Cargo, Rust compiler, linker, npm, Vite, or application process remained after the interruption.

## Created files

- `docs/checkpoints/task-14b.md`
- `work/checkpoints/task-14b-before/manifest.md`
- `work/logs/task-14b/00-native-wrapper-invocation-failure.log`
- `work/logs/task-14b/01-npm-ci.log`
- `work/logs/task-14b/02-typecheck.log`
- `work/logs/task-14b/03-vitest.log`
- `work/logs/task-14b/04-playwright.log`
- `work/logs/task-14b/05-vite-build.log`
- `work/logs/task-14b/06-cargo-fmt.log`
- `work/logs/task-14b/07-cargo-test.log`

No existing application, configuration, manifest, lockfile, test, or documentation file was modified. Generated dependency/build directories are outside the recorded source-change set.

## Self-review

- Result counts and hashes above were copied from fresh command output.
- The checkpoint distinguishes completed checks from checks that were not executed.
- The npm audit advisory is reported without applying an unapproved dependency mutation.
- No Git command was run, and Git metadata was not accessed, initialized, repaired, or changed.

---

## 2026-08-03 harness-remediation rerun

**Result: BLOCKED.** This additive rerun preserved the original blocked history above. It used only the approved harness/evidence paths and stopped at the first unexpected nonzero process result. No Rust test, Clippy, Tauri debug build, native smoke, or offline audit acceptance result is claimed.

### Isolated harness and mandatory preflight

`work/logs/task-14b-rerun/Invoke-Task14bRerun.ps1` keeps `$ErrorActionPreference = "Stop"` for PowerShell errors but invokes each native program with `Start-Process -Wait -PassThru`, distinct stdout/stderr redirects, and numeric `Process.ExitCode` capture before checking success.

The required preflight passed:

- `cmd.exe /d /c "echo ordinary stderr progress 1>&2"`: exit `0`; stderr trimmed exactly to `ordinary stderr progress`; the harness continued.
- `cmd.exe /d /c "echo deliberate failure 1>&2 && exit /b 7"`: exit `7`; stderr trimmed exactly to `deliberate failure`; the checked-runner rejection was caught and recorded only after the streams and numeric exit were captured.

### Fresh contiguous attempt

The following checked processes started from a fresh `npm ci` and returned numeric exit `0`:

1. `npm ci --cache work/npm-cache` â€” installed 198 packages; npm reported two high-severity advisories. No audit fix was applied.
2. `npm run typecheck` â€” passed.
3. `npm test -- --run` â€” 49 files and 559/559 tests passed.
4. `npm run test:e2e` â€” 7/7 Playwright Chromium tests passed.
5. `npm run build` â€” passed; Vite transformed 2,306 modules, with a largest generated JavaScript chunk of 303.93 kB.

The next process used the required Windows PowerShell wrapper shape:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -File work/toolchain/Invoke-Task13bNative.ps1 cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

It returned numeric exit `1` before Cargo executed. Captured stderr is:

```text
Parameter cannot be processed because the parameter name '' is ambiguous. Possible matches include: -Executable -CommandArguments ...
FullyQualifiedErrorId : AmbiguousParameter,Invoke-Task13bNative.ps1
```

This is a second invocation-boundary failure, not a Rust formatting failure. Windows PowerShell 5.1's `-File` script binder interprets the literal `--` forwarded to a script with named parameters as an empty parameter name. Positional binding, explicit `-CommandArguments`, and adding `--%` were each probed and reproduced the same failure.

A harness-only candidate for separate specification review was proven safe without resuming the gate: place literal quote characters around the separator in the `Start-Process` argument value (`\"--\"`). The argument probe then received `"--"` as a string, and the unchanged native wrapper successfully ran `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` with numeric exit `0`. This candidate must be approved and used in a new fresh contiguous rerun; this stopped attempt is not retroactively valid.

Per the stop rule, no result files exist for:

- Cargo test;
- Clippy with `-D warnings`;
- Tauri debug build;
- native launch/window/network/exit/artifact smoke;
- offline endpoint audit.

### Post-stop integrity

All protected hashes remain identical to the before-checkpoint, including the unchanged wrapper:

| Path | SHA-256 |
| --- | --- |
| `package.json` | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `work/toolchain/Invoke-Task13bNative.ps1` | `92F9591956493A291CCF645E975EE2D90ED1E29A909EABB7147CC62CF771841E` |

The pending-file-rename queue remained byte-for-byte equivalent to the before state: six strings representing three Microsoft Edge temporary delete pairs. No MiroraTrack, WebView2 installer/build tool, Cargo, Rust, MSVC, Windows SDK, Node, npm, Vite, or Tauri queue entry appeared. No repository-attributable process remained after the stop.

### Rerun evidence created

- `work/checkpoints/task-14b-rerun-before/manifest.md`
- `work/logs/task-14b-rerun/Invoke-Task14bRerun.ps1`
- `work/logs/task-14b-rerun/Invoke-ArgumentProbe.ps1`
- `work/logs/task-14b-rerun/00-preflight-*`
- `work/logs/task-14b-rerun/01-npm-ci.*`
- `work/logs/task-14b-rerun/02-typecheck.*`
- `work/logs/task-14b-rerun/03-vitest.*`
- `work/logs/task-14b-rerun/04-playwright.*`
- `work/logs/task-14b-rerun/05-vite-build.*`
- `work/logs/task-14b-rerun/06-cargo-fmt.*`
- `work/logs/task-14b-rerun/diagnostic-*`
- `work/logs/task-14b-rerun/probe-*`
- `work/logs/task-14b-rerun/candidate-quoted-separator.*`

Generated `node_modules`, `dist`, and native target outputs may have refreshed as allowed. No application source, test, existing failed-attempt log, manifest, lockfile, Tauri configuration, or native toolchain wrapper was changed. No Git command was run and Git metadata was not accessed.

### Rerun self-review

- The harness logs capture stdout, stderr, and numeric exit independently for every checked process.
- The checkpoint distinguishes successful checks, the binder failure, diagnostic probes, and unexecuted acceptance checks.
- The candidate separator encoding was tested through the unchanged wrapper but is explicitly not counted as continuation of the stopped gate.
- Protected hashes, pending rename state, and process cleanliness were rechecked after all diagnostics.

---

## 2026-08-03 encoded-argument rerun

**Result: BLOCKED.** This third additive attempt preserves both earlier blocked histories above. The mandatory argument-transport remediation and all preflights succeeded, but the outer execution allowance terminated the contiguous gate while the Clippy wrapper process was still being awaited. No fresh Tauri debug-build result, native-smoke result, or offline-audit result is claimed, and no further acceptance run was started.

### Encoded wrapper transport and preflight

The new evidence harness is confined to `work/logs/task-14b-rerun-2/`. For every native-wrapper call it:

1. serializes `{ Wrapper, Executable, CommandArguments[] }` as compact JSON;
2. UTF-8/Base64 encodes that JSON;
3. substitutes the token into static child PowerShell code that decodes it in memory, explicitly casts `CommandArguments` to `string[]`, and invokes the unchanged wrapper with named `-Executable` and `-CommandArguments` parameters;
4. UTF-16LE/Base64 encodes the child code and launches `powershell.exe -NoLogo -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand <token>` through the separate-stream `Start-Process` runner;
5. records the unobscured logical invocation JSON beside stdout, stderr, timestamps, duration, and numeric exit evidence.

The first isolated deliberate-failure probe exposed Windows PowerShell's serialized `Preparing modules for first use` progress record on redirected stderr. No gate had started. Setting `$ProgressPreference = "SilentlyContinue"` in the child eliminated that PowerShell-only framing at its source; the complete mandatory preflight was then rerun and passed:

- direct runner known stderr with exit `0` was captured and remained non-terminating;
- direct runner known stderr with exit `7` was captured and rejected only after numeric-exit inspection;
- the encoded wrapper delivered the exact Node probe array `["alpha","value with spaces","--","-D","--check","x86_64-pc-windows-msvc"]`;
- encoded-wrapper known stderr with exit `7` was captured exactly and rejected only after numeric-exit inspection.

### Fresh contiguous gate evidence

The following checked processes have complete result files with numeric exit `0`:

| Step | Evidence | Result |
| --- | --- | --- |
| `npm ci --cache work/npm-cache` | `01-npm-ci.result.txt` | exit `0`; 198 packages installed; npm reported two high-severity advisories and no audit fix was applied |
| `npm run typecheck` | `02-typecheck.result.txt` | exit `0` |
| `npm test -- --run` | `03-vitest.result.txt` | exit `0`; 49 files and 559/559 tests passed |
| `npm run test:e2e` | `04-playwright.result.txt` | exit `0`; 7/7 Chromium tests passed |
| `npm run build` | `05-vite-build.result.txt` | exit `0`; Vite transformed 2,306 modules |
| encoded `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | `06-cargo-fmt.result.txt` and logical argv | exit `0` |
| encoded `cargo test --locked --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml` | `07-cargo-test.result.txt` and logical argv | exit `0`; 5/5 Rust tests passed |

Cargo test's wrapper process remained under `Start-Process -Wait` for `908.347` seconds although its captured Cargo output completed much earlier. Clippy then began through the same encoded transport. Its stderr log reaches `Finished dev profile ... in 53.14s`, but the outer command allowance expired while the wrapper process was still awaited. Consequently there is no `08-cargo-clippy.result.txt`, no captured numeric Clippy exit, and no Clippy acceptance claim. This is an evidence-runner timeout, not a captured Clippy diagnostic or warning failure.

Per the uninterrupted-gate contract, these checks were not executed or accepted after the timeout:

- encoded Tauri debug build;
- exact debug-executable artifact and native-window smoke;
- native title, no-local-server, TCP, and clean-close evidence;
- final source/config/dist offline endpoint audit.

### Post-timeout integrity and cleanliness

All protected hashes remained identical to the before-checkpoint and both earlier attempts:

| Path | SHA-256 |
| --- | --- |
| `package.json` | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `work/toolchain/Invoke-Task13bNative.ps1` | `92F9591956493A291CCF645E975EE2D90ED1E29A909EABB7147CC62CF771841E` |

The exact pending-file-rename queue remained the same six-string Microsoft Edge temporary-delete array recorded in `work/checkpoints/task-14b-rerun-2-before/manifest.md`. It gained no MiroraTrack, WebView2 installer/build tool, Cargo, Rust, MSVC, Windows SDK, Node, npm, Vite, or Tauri entry. No process with an executable path or command line attributable to the repository remained after the timeout.

### Evidence and file scope

Created for this attempt:

- `work/checkpoints/task-14b-rerun-2-before/manifest.md`
- `work/logs/task-14b-rerun-2/Invoke-Task14bRerun2.ps1`
- `work/logs/task-14b-rerun-2/argument-probe.js`
- `work/logs/task-14b-rerun-2/stderr-exit-probe.js`
- `work/logs/task-14b-rerun-2/00*` preflight evidence
- `work/logs/task-14b-rerun-2/01*` through `08*` gate evidence, with `08*` intentionally lacking a result file

Appended only this blocked history to `docs/checkpoints/task-14b.md`. Generated `node_modules`, `dist`, and `src-tauri/target` content may have refreshed as allowed. No application source, application test, configuration, manifest, lockfile, existing evidence, or native toolchain wrapper changed. No Git command was run and Git metadata was not accessed.

### Self-review

- Only result files containing captured numeric exit codes are classified as passing.
- The Clippy output tail is not promoted to acceptance without a numeric-exit result.
- Unexecuted Tauri build, native smoke, and offline audit checks are explicit.
- Protected hashes, the exact pending queue, and repository process cleanliness were freshly rechecked after the timeout.

---

## 2026-08-03 Job-Object acceptance rerun 3

**Result: BLOCKED at native smoke.** This additive attempt preserves every earlier Task 14B history and stopped at the first binding acceptance failure. It does not claim an offline-audit acceptance result and did not proceed to Task 15 packaging.

### Runner remediation and preflight

The final harness is `work/logs/task-14b-rerun-3/Invoke-Task14bRerun3.ps1`. It retains compact JSON -> UTF-8 Base64 -> UTF-16LE `-EncodedCommand` transport for `{ Wrapper, Executable, CommandArguments[] }` and invokes the unchanged `work/toolchain/Invoke-Task13bNative.ps1` synchronously.

`Start-Process -Wait` is absent. Each checked process is launched with `Start-Process -PassThru`; the controller then uses the direct process `WaitForExit(timeout)`, a final flush wait, a retained process handle, and `GetExitCodeProcess` for numeric exit capture. Redirected streams are stabilized before reading. Each encoded wrapper creates a non-inheritable Windows Job Object, sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assigns itself, checks every native result, and explicitly closes the job handle after the unchanged wrapper returns.

The repeated full-run preflight passed:

- ordinary known stderr with exit `0`;
- exact known stderr with exit `7`, followed by checked rejection;
- exact encoded argv `alpha`, `value with spaces`, `--`, `-D`, `--check`, `x86_64-pc-windows-msvc`;
- raw direct-parent `WaitForExit(500)` prompt result while its descendant remained alive, followed by explicit cleanup;
- non-inheritable kill-on-close Job Object proof: wrapper exit `0` in `0.704s`, lingering descendant automatically gone;
- forced one-second timeout proof with both encoded parent and descendant confirmed gone.

The harness computes a SHA-256 manifest over 212 application source, test, asset, native-source, configuration, manifest, and lock files plus the unchanged native wrapper. It revalidates that digest after every checked step and writes an ordered SHA-256 hash-chain ledger. Baseline and post-stop digest are both `A3F72C8662E37B82A8A8FBFF97435F8FC35D2B0BB9FDFCAC731D9CA306FD12C6`.

### Fresh serial gate

All results below were captured in the one fresh controller that began with the repeated preflight and `npm ci`:

| Step | Numeric result | Evidence |
| --- | --- | --- |
| `npm ci --cache work/npm-cache` | exit `0`, 11.776s | `01-npm-ci.*` |
| `npm run typecheck` | exit `0`, 6.029s | `02-typecheck.*` |
| `npm test -- --run` | exit `0`, 49 files and 559/559 tests | `03-vitest.*` |
| `npm run test:e2e` | exit `0`, 7/7 Chromium tests | `04-playwright.*` |
| `npm run build` | exit `0`; largest JavaScript chunk 303.93 kB | `05-vite-build.*` |
| encoded Cargo fmt check | exit `0`, 1.123s | `06-cargo-fmt.*` and logical argv |
| encoded locked x64 Cargo test | exit `0`, 5/5 Rust tests, 24.431s | `07-cargo-test.*` and logical argv |
| encoded locked x64 Clippy, all targets/features, `-D warnings` | exit `0`, 3.778s | `08-cargo-clippy.*` and logical argv |
| encoded x64 Tauri debug no-bundle CI build | exit `0`, 19.974s | `09-tauri-debug-build.*` and logical argv |

The ordered ledger contains 14 captured steps and ends after the Tauri build at chain hash `D3255D26830C917D02A245B3A0CA92F40A90E7AA346422438FF9B100F61FECAE`.

### Binding native-smoke failure

The exact debug artifact exists at `src-tauri/target/x86_64-pc-windows-msvc/debug/miroratrack.exe`:

- size: `14,027,264` bytes;
- SHA-256: `059535A060FFBF785CB56CA0890E88D2F13D1BFDA261B28DAF1C77DFD3492E59`;
- native window title observed: `MiroraTrack`;
- no TCP listener observed;
- clean close requested and confirmed with numeric exit `0`.

However, the new WebView2 process tree reproducibly opened app-attributable remote TCP. `10-native-smoke-failure-diagnostic.json` records an established connection from the MiroraTrack WebView2 root to `52.110.17.66:443` and six network-service connection attempts to the configured proxy `192.168.1.5:3128`. The WebView command lines are explicitly branded with `--webview-exe-name=miroratrack.exe`, version `0.1.0`, and the MiroraTrack user-data directory. This violates the approved no app-attributable remote-TCP smoke criterion, so the controller stopped before offline-audit acceptance.

A `vctip.exe` process from the native gate remained after the stop. It did not exit during a 45-second read-only natural-exit wait, so exact PID `40456` was terminated and confirmed gone. The final process audit reports zero repository, MiroraTrack WebView, Cargo/Rust/MSVC, or `vctip` processes.

### Integrity and scope

`12-post-stop-integrity.json` confirms:

- full protected manifest unchanged;
- package, Cargo, Tauri configuration, lockfile, and native-wrapper hashes unchanged from all earlier Task 14B attempts;
- pending-file-rename queue byte-equivalent before/after: the same six Microsoft Edge temporary-delete strings;
- zero related processes after exact orphan cleanup.

Created only under the approved additive evidence scope:

- `work/checkpoints/task-14b-rerun-3-before/*`;
- `work/logs/task-14b-rerun-3/*`, including controller, probes, result/stream/logical-argv files, hash-chain ledger, diagnostic smoke evidence, post-stop integrity evidence, and preserved diagnostic-attempt subdirectories.

App source, application tests, configuration, manifests, lockfiles, and `work/toolchain/Invoke-Task13bNative.ps1` were not edited. Generated `node_modules`, `dist`, and `src-tauri/target` content refreshed as allowed. No Git command was run and Git metadata was not accessed.

### Self-review

- Only result files with captured numeric exits are classified as passing.
- The deliberate preflight exit `7` remains represented as a rejected nonzero ledger entry, not a product failure.
- The successful build gates are not promoted to full Task 14B acceptance after the native-smoke failure.
- Offline audit is explicitly unexecuted for acceptance because the stop-first-failure rule fired.
- The reproducible remote-TCP evidence and forced orphan cleanup are reported without weakening or reinterpreting the approved acceptance contract.
