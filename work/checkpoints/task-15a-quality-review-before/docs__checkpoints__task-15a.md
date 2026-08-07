# Task 15A — quarantined Windows installer build

## Status

**DONE for the Task 15A build-and-inspection scope** on 2026-08-03. Two x64
NSIS installers were copied into `work/artifacts/task15/unaccepted/` and
independently inspected. They remain **UNACCEPTED** pending Task 15B; no release
or lifecycle acceptance is claimed. The initial NSIS and WebView2 transfer
blocks are preserved below as historical attempts.

## File-based checkpoint and constraints

Before modification, exact copies and hashes were recorded under
`work/checkpoints/task-15a-before/`. The checkpoint covers `package.json`,
`package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json`, `docs/BUILDING-WINDOWS.md`, and the previously
absent README and installer-verification script paths.

No application source, packaging configuration, manifest, or lockfile was
edited. No Git command was run and Git metadata was not accessed, initialized,
deleted, rewritten, or repaired.

The five protected live files remained byte-for-byte identical:

| Path | SHA-256 |
| --- | --- |
| `package.json` | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |

## Fresh complete host gate

`scripts/Build-Task15Installers.ps1 -Phase Gate` used compact JSON, UTF-8
Base64, UTF-16LE `-EncodedCommand`, the unchanged native-toolchain wrapper, a
non-inheritable kill-on-close Windows Job Object, distinct stdout/stderr files,
and `GetExitCodeProcess` numeric exit capture. It ran serially from a fresh
dependency restore and rechecked protected hashes after every step.

| Step | Numeric result | Evidence |
| --- | --- | --- |
| `npm ci --cache work/npm-cache` | exit `0`; 198 packages installed; npm reported two high-severity advisories and no audit fix was applied | `work/logs/task15a/01-npm-ci.*` |
| `npm run typecheck` | exit `0` | `02-typecheck.*` |
| `npm test -- --run` | exit `0`; 49 files, 559/559 tests | `03-vitest.*` |
| `npm run test:e2e` | exit `0`; 7/7 Chromium tests | `04-playwright.*` |
| `npm run build` | exit `0`; Vite production build completed; largest JavaScript chunk 303.93 kB | `05-vite-build.*` |
| Cargo formatting check | exit `0` | `06-cargo-fmt.*` |
| locked x64 Cargo test | exit `0`; 5/5 Rust tests | `07-cargo-test.*` |
| locked x64 Clippy, all targets/features, `-D warnings` | exit `0` | `08-cargo-clippy.*` |
| x64 Tauri debug no-bundle build | exit `0`; exact debug executable built | `09-tauri-native-build.*` |

The gate ended with zero repository-attributable orphan processes.

## Quarantined build attempt

The build runner created only the merge override
`work/build/task15/0.0.9/tauri-version-override.json` containing exactly:

```json
{"version":"0.0.9"}
```

It set `CARGO_TARGET_DIR` to
`work/build/task15/0.0.9/target` and invoked the exact logical command:

```text
npx.cmd tauri build --config <override> --bundles nsis --target x86_64-pc-windows-msvc --ci
```

The frontend and Rust release application completed. The intermediate bundled
application is not an installer and remains quarantined:

| Property | Value |
| --- | --- |
| Path | `work/build/task15/0.0.9/target/x86_64-pc-windows-msvc/release/miroratrack.exe` |
| Size | `9,631,744` bytes |
| SHA-256 | `C73A967A2F0602DE2B33BDD01D2E0A2CB9A8FEE0317B9EA145BFB807CAA0DC17` |
| File version | `0.0.9` |
| Product version | `0.0.9` |
| PE machine | `0x8664` (AMD64) |
| Authenticode | `NotSigned` |

Tauri then logged `Verifying NSIS package` and attempted to download:

```text
https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip
```

The last stderr write was 15:08:36 local time. The Tauri Node process remained
responsive with an established HTTPS connection to `185.199.110.133:443`, but
no Tauri/NSIS cache directory, discoverable partial file, result file, or
stdout/stderr advancement appeared for more than 15 minutes. A bounded
no-progress stop was therefore applied to the exact encoded build process and
its recorded descendants. The first job-close check found four descendants
still present, so only those exact recorded PIDs were terminated. Final
evidence confirms all five build-tree PIDs are gone.

The forced process exit surfaced as unsigned Windows code `4294967295`; the
initial evidence runner attempted to cast it directly to signed `Int32` and
recorded that harness conversion error in `99-status.json`. The retained runner
now converts the native code by bytes and includes a binding 900-second
stdout/stderr no-progress limit for future package builds. No retry was run.

Per stop-on-first-failure:

- no NSIS 0.0.9 installer exists;
- the 0.1.0 build was not started;
- no file was copied into either unaccepted artifact version directory;
- installer wrapper/version/signature inspection was not possible;
- embedded `MicrosoftEdgeWebView2RuntimeInstaller.exe` extraction, hash, and
  Microsoft signature verification were not possible; and
- Task 15B lifecycle verification was not started.

The live Tauri configuration still supplies the build-time evidence for an
offline WebView2 payload (`webviewInstallMode.type = offlineInstaller`), but
the payload is not claimed present until an actual installer is extracted and
verified.

## Documentation and safety tooling

Created:

- `scripts/Build-Task15Installers.ps1`
- `scripts/verify-installer.ps1`
- `docs/INSTALLER-VERIFICATION.md`
- `README.md`
- `docs/checkpoints/task-15a.md`

Modified:

- `docs/BUILDING-WINDOWS.md`

Generated evidence and output are confined to:

- `work/checkpoints/task-15a-before/`
- `work/logs/task15a/`
- `work/build/task15/`
- `work/artifacts/task15/unaccepted/` (directory only; no installer artifact)

The documentation labels all future installer outputs **UNACCEPTED**, records
the unsigned warning, offline WebView payload requirement, and the pending
verification requirements for current-user Desktop/Start menu shortcuts,
`NoRepair=1` same-version reinstall semantics, and data preservation in Task
15B. The input-preflight script refuses to run outside Windows Sandbox and
never deletes user data.

## Current source-like file hashes

| Path | SHA-256 |
| --- | --- |
| `scripts/Build-Task15Installers.ps1` | `095B2A22F73471D7906CC1FA3FF36C6E3C484886409F290408EDA8F153F0C6B8` |
| `scripts/verify-installer.ps1` | `5E8B3B763D1C721C381FC7FBB6776A2BBACD85DEB2C96D8DA487F22EE376DA3C` |
| `docs/BUILDING-WINDOWS.md` | `033053EE74FB13CF3E13399BCB4A423DCA84CF8C44BC50347F2EEF4DB273916F` |
| `docs/INSTALLER-VERIFICATION.md` | `E967D6110ACF68C7EC142A7C60B5BEF67E78F448BA2C3BBDD93654BD1602CC6E` |
| `README.md` | `E761D99951F9D864EA417CA59EB10FF596018F4232F5C50E991CEF6F5F12B25F` |

## Self-review

- Fresh PowerShell parsing passed for both retained scripts.
- The lifecycle-preflight negative test exited `1` with the expected refusal
  outside Windows Sandbox before resolving either deliberately missing input.
- The documentation-content audit found every required quarantine, offline
  payload, `NoRepair=1`/reinstall, uninstall-preservation, and unsigned-warning
  statement.
- The final integrity audit passed with unchanged protected hashes, zero `.exe`
  files in the unaccepted artifact tree, and zero repository-attributable
  processes. Evidence is in `work/logs/task15a/13-*` through `16-*`.
- Host-pass claims are backed only by result files containing numeric exit `0`.
- The intermediate 0.0.9 application is not described as an installer.
- No 0.1.0 build, WebView payload, installer signature, shortcut, upgrade,
  reinstall, uninstall, or persistence claim is made.
- The network/tool-acquisition blocker and evidence-runner signed-conversion
  defect are both recorded without disguising either as a product failure.
- No Git command was run and Git metadata was not accessed.

## Additive acquisition-remediation retry — 2026-08-03

**Result: BLOCKED at the Microsoft WebView2 offline-runtime transfer.** This
section preserves the complete first-attempt history above. The NSIS blocker
was fully remediated, the complete host gate passed, and Tauri consumed both
approved build assets through a loopback-only mirror. No installer was
produced, 0.1.0 was not started, Task 15B was not started, and no release or
lifecycle acceptance is claimed.

### File checkpoint and implementation

Before the retry, exact copies and hashes were recorded under
`work/checkpoints/task-15a-retry-before/`. Added:

- `scripts/task15/TauriBundlerMirror.psm1`
- `scripts/task15/Acquire-TauriBundlerTools.ps1`
- `scripts/task15/Start-TauriBundlerMirror.ps1`
- `scripts/task15/Test-TauriBundlerMirror.ps1`
- `scripts/task15/Test-Task15BuildIntegration.ps1`

Modified only `scripts/Build-Task15Installers.ps1`,
`docs/BUILDING-WINDOWS.md`, `docs/INSTALLER-VERIFICATION.md`, and this checkpoint.
No application source, application test, live Tauri configuration, manifest,
or lockfile changed. The five protected hashes remain exactly those recorded
in the first-attempt table above.

Current implementation hashes after the retry:

| Path | SHA-256 |
| --- | --- |
| `scripts/Build-Task15Installers.ps1` | `9A1B62ED68154F184046C5BBC811F4D6F9EC1D2C5497AAAFADEEFACB48000646` |
| `scripts/task15/TauriBundlerMirror.psm1` | `23678913D9E97CE914F968F6229585A6E065431B9487F84D23C70C5243933097` |
| `scripts/task15/Acquire-TauriBundlerTools.ps1` | `333E88F7FB6843BB129E18A7963D1E17315B40C97C29FC81AE513DB82B5A7190` |
| `scripts/task15/Start-TauriBundlerMirror.ps1` | `19E2E1B8C2D097A4E3D82E10135985A05F7D13E2A5BEF5B2430AA11E6D7731FA` |
| `scripts/task15/Test-TauriBundlerMirror.ps1` | `A823E99902D0F6AF34EBC9A7045191D4DF10BAAEE8529D039A33DE72E1C28EFF` |
| `scripts/task15/Test-Task15BuildIntegration.ps1` | `5FA635F5D4E9C7E723059A49BAC985F462D81F2E09EF7370C51BD59A5018B201` |

The strict test-first evidence is retained under `work/logs/task15a/retry/`.
It includes RED failures before the mirror module, REST streaming function,
and build integration existed, followed by GREEN suites. The mirror tests
cover exact pinned specifications, every binding metadata field, truncation,
tampering, atomic promotion, traversal/unknown rejection, loopback-only
binding, exact bytes, shutdown, and exact `tauri-cli 2.11.4`.

### Official asset acquisition

Both assets were acquired through their official GitHub asset REST endpoints
using `Accept: application/octet-stream`, an exact full-file `Range`, bounded
timeouts, `.partial` staging, exact metadata validation, and atomic promotion:

| Asset | Size | SHA-256 |
| --- | ---: | --- |
| `tauri-apps/binary-releases`, `nsis-3.11`, `nsis-3.11.zip` | 2,361,546 | `C7D27F780DDB6CFFB4730138CD1591E841F4B7EDB155856901CDF5F214394FA1` |
| `tauri-apps/nsis-tauri-utils`, `nsis_tauri_utils-v0.5.3`, `nsis_tauri_utils.dll` | 34,304 | `5BA143B5DB4A87D32D6E7802E033330AAE56CBCEABE0D1E3BA41948385AD4709` |

`acquisition.json` records the binding owner, repository, tag, asset ID, name,
size, SHA-256, SHA-1, state, timestamps, exact range, local path, and mirror
path. No invalid partial was promoted.

### Fresh complete gate

The retry reran the entire gate from dependency restore. Results were: npm
install exit 0; typecheck exit 0; Vitest 49 files and 559/559 tests; Playwright
7/7; Vite build exit 0; Cargo formatting exit 0; Cargo tests 5/5; Clippy all
targets/features with `-D warnings` exit 0; and the x64 native debug build exit
0. The first accessibility route sweep exceeded its original 30-second global
test budget twice while its captured snapshot already contained the expected
Settings heading. The quarantined driver reran the identical seven tests and
all assertions with only a bounded 60-second per-test timeout; the sweep passed
in 33.3 seconds. No application test or project test configuration was edited.

### Quarantined 0.0.9 build and binding failure

The driver wrote explicit 0.0.9 and 0.1.0 merge overrides containing their
version plus `bundle.useLocalToolsDir=true`, cleaned only each isolated target's
resolved `.tauri` directory, and passed the mirror environment only to each
Tauri child. The server bound exclusively to an ephemeral `127.0.0.1` port.

During 0.0.9, Tauri logged `Verifying NSIS package`, both exact loopback URLs,
`validating hash` for both, `extracting NSIS`, and `Target: x64`. The request
log contains only the two approved paths, both status 200, with exact served
sizes 2,361,546 and 34,304 bytes. The extracted local tools include the expected
NSIS tree and the utility DLL at its exact approved hash.

Tauri then requested Microsoft's official WebView2 offline-installer link. Its
redirect resolved to an official Microsoft delivery URL with
`Content-Length: 209567440`, but the Tauri process emitted no further output for
900 seconds. Active TLS connections remained established. The exact no-output
bound terminated the job tree at 16:24:58 +05. The mirror stopped in `finally`;
final checks found no mirror listener and no repository-attributable child.
A separate bounded diagnostic range request proved the endpoint responds, but
at a rate insufficient for the build bound; that partial remains evidence only
and was never promoted or used for packaging.

Consequently, no 0.0.9 installer exists, 0.1.0 was not started, the unaccepted
artifact tree contains no files, and wrapper/payload/signature/shortcut or
lifecycle inspection remains impossible. This is an upstream payload-transfer
blocker, not a product-pass or release-pass result.

## Additive WebView acquisition and completed build - 2026-08-03

**Result: DONE for Task 15A only.** The prior transfer block was remediated by
an independent resumable acquisition path. The official redirect binding was
captured and rechecked before both builds. The completed payload is
209,567,440 bytes with SHA-256
`7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`
and a `Valid` Authenticode signature whose subject is Microsoft Corporation.
No Task 15B lifecycle step was run, and neither artifact is release-accepted.

### Test-first remediation and acquisition

The WebView work added unit-style PowerShell coverage before implementation
for binding identity, range-resume rules, changed-binding quarantine,
truncation and tampering rejection, atomic promotion, Microsoft signer
enforcement, bounded isolated staging, rejection of a Tauri large WebView GET,
and embedded-payload equality. Static build-integration coverage requires the
official fwlink, `HEAD`, `Range`, `If-Range`, timeout bounds, pre-acquisition,
binding checks before both versions, the exact `.tauri\x64` stage, build-log
inspection, and the NSIS `/oname` extraction name. The retained RED evidence is
under `work/logs/task15a/retry/tdd-red-webview*`; the fresh final GREEN commands
are recorded in the self-review below.

The payload acquisition first validates the current official binding, resumes
only a partial file with identical URL GUID, asset name, ETag, Last-Modified,
and size, requires exact `206`/Content-Range responses, and promotes only after
the complete size, SHA-256, and Microsoft signature pass. The build copied the
validated payload into each isolated target's exact Tauri local-tools path and
rechecked the official binding immediately before each version.

### Extraction correction

Both initial post-acquisition NSIS builds exited `0`, but the first inspection
filter looked for the source name
`MicrosoftEdgeWebView2RuntimeInstallerX64.exe`. NSIS had deliberately renamed
the embedded file through `/oname` to
`MicrosoftEdgeWebView2RuntimeInstaller.exe`, so inspection failed safely before
copying any artifact. Those superseded source installers were 214,694,867
bytes for 0.0.9 (SHA-256 prefix `72FB61AC`, suffix `C762`) and 214,685,130
bytes for 0.1.0 (prefix `541008F5`, suffix `F58E`). A targeted RED/GREEN static
integration requirement corrected only the inspection filter. The corrected
Build phase then rebuilt, inspected, and copied both versions, ending `PASS` at
2026-08-03 17:17:45 +05:00. Evidence is in
`work/logs/task15a/99-status.json` and `13-copied-installers.json`.

### Exact unaccepted artifacts

| Version | Size | SHA-256 | Wrapper version | Wrapper signature |
| --- | ---: | --- | --- | --- |
| `0.0.9` | 214,689,107 | `2F820DB676CFDC8906F4A8C4761E9EC335196530E25802E59C800F4D0C1D448C` | `0.0.9` | `NotSigned` |
| `0.1.0` | 214,686,623 | `426AA75C45862891A7A6A3A7A144EEF6E2871E84A81656D0F02B6957A85CCA34` | `0.1.0` | `NotSigned` |

The copied hashes match the corresponding source installers byte-for-byte.
Their exact paths are:

- `work/artifacts/task15/unaccepted/0.0.9/MiroraTrack_0.0.9_x64-setup.exe`
- `work/artifacts/task15/unaccepted/0.1.0/MiroraTrack_0.1.0_x64-setup.exe`

Fresh independent extraction to
`work/build/task15/final-inspection-20260803-1730/` succeeded for both
installers. Each extraction contains exactly seven files and exactly one
`$TEMP/MicrosoftEdgeWebView2RuntimeInstaller.exe`; both payload copies have the
official 209,567,440-byte size, exact SHA-256 above, `Valid` Authenticode, and
the Microsoft Corporation signer. The extracted MiroraTrack executables are
PE machine `0x8664` (AMD64), 9,631,744 bytes, and carry the intended 0.0.9 and
0.1.0 file/product versions. Their respective SHA-256 values are
`502FAA53CF52BBCB8B5A581F1D567927E9911EE0F5B3BEDD84615E23D50C33A7`
and `12DC9C687D6F2579BB353C8BC3990F5D0DB08E3E64061D93AFB3AED37BE153FB`.

### Generated NSIS and tool evidence

Both generated `installer.nsi` files define the intended version, `ARCH
"x64"`, `INSTALLMODE "currentUser"`, `RequestExecutionLevel user`,
`INSTALLWEBVIEW2MODE "offlineInstaller"`, and `ALLOWDOWNGRADES "false"`.
They embed the staged payload as
`$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe`, write ARP `NoModify=1` and
`NoRepair=1`, create Start menu and Desktop shortcuts, use the per-user
`$LOCALAPPDATA\MiroraTrack` install directory, and delete the uninstall key
from HKCU for current-user uninstall. These are generated-script facts; actual
shortcut, ARP, reinstall, upgrade, and uninstall behavior remains for Task 15B.

The locked versions were `tauri-cli 2.11.4` and `tauri-bundler 2.9.4`. The
loopback mirror request log contains exactly four successful approved requests:
the 2,361,546-byte NSIS 3.11 archive and 34,304-byte utility DLL once for each
version, all with `tauri-bundler/2.9.4`. Neither Tauri stderr log contains the
Microsoft fwlink, Microsoft delivery URL, or a WebView2 download. Both report
`Target: x64`, `makensis`, and one completed bundle.

### Protected inputs and process cleanup

The protected before, runner-after, and fresh current hashes are identical for
all six paths:

| Path | SHA-256 |
| --- | --- |
| `package.json` | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |
| `work/toolchain/Invoke-Task13bNative.ps1` | `92F9591956493A291CCF645E975EE2D90ED1E29A909EABB7147CC62CF771841E` |

The build runner and the independent final check found zero
repository-attributable orphan processes and zero relevant listeners. Git
commands were not run and `.git` was not traversed or modified.

### Source-like files created or modified

Created during Task 15A:

- `scripts/Build-Task15Installers.ps1`
- `scripts/verify-installer.ps1`
- `scripts/task15/TauriBundlerMirror.psm1`
- `scripts/task15/Acquire-TauriBundlerTools.ps1`
- `scripts/task15/Start-TauriBundlerMirror.ps1`
- `scripts/task15/Test-TauriBundlerMirror.ps1`
- `scripts/task15/Test-Task15BuildIntegration.ps1`
- `scripts/task15/WebViewAcquisition.psm1`
- `scripts/task15/Acquire-WebViewOfflineInstaller.ps1`
- `scripts/task15/Test-WebViewAcquisition.ps1`
- `scripts/task15/Test-WebViewBuildIntegration.ps1`
- `docs/INSTALLER-VERIFICATION.md`
- `docs/checkpoints/task-15a.md`
- `README.md`

Modified during Task 15A:

- `docs/BUILDING-WINDOWS.md`

The build script and Task 15A documentation were subsequently updated within
the task as each blocked attempt was remediated. Generated evidence and
quarantined outputs remain confined to `work/checkpoints/task-15a-*`,
`work/logs/task15a`, `work/toolchain`, `work/build/task15`, and
`work/artifacts/task15/unaccepted`.

### Final self-review

- All four Task 15 PowerShell suites passed fresh: bundler mirror, build
  integration, WebView acquisition, and WebView build integration.
- PowerShell parsing passed for all 11 retained Task 15 scripts.
- Documentation assertions passed for exact artifact paths and hashes,
  `UNACCEPTED`, locked tool versions, `NoRepair=1`, historical blockers, and
  pending Task 15B lifecycle acceptance.
- All 15 recorded gate/build result files contain numeric exit `0` and no
  termination reason. This includes npm restore, typecheck, Vitest 559/559,
  Playwright 7/7, Vite, rustfmt, Rust 5/5, Clippy, native build, both
  acquisitions, both binding checks, and both NSIS builds.
- A post-documentation recheck passed both full installer hashes, both embedded
  payload hashes and signatures, all six protected hashes, the exact four
  mirror requests, absence of a Tauri large WebView GET, exact
  `tauri-cli 2.11.4`, and zero repository executables or mirror listeners.
- The installer wrappers remain honestly recorded as `NotSigned`. No Task 15B
  install was attempted and no acceptance or distribution claim is made.

## Final evidence-retention review - 2026-08-03

The state before this documentation-only correction is checkpointed at
`work/checkpoints/task-15a-final-review-before/manifest.json`. Its exact backup
of this document is `docs__checkpoints__task-15a.md`, length 21,970 bytes,
SHA-256
`7728E4FCDC99DBA29D922E3F805F097A3ED89C3D06097589A4CB19A40DB9A622`.

The authoritative retained review root is:

```text
work/logs/task15a/final-review-20260803-1812/
```

### Four current-file suites

The exact synchronous commands below were rerun from the repository root.
Each has numeric `$LASTEXITCODE` `0`, its expected PASS line in the named
stdout file, and an empty stderr file. Per-command timestamps, arguments,
working directory, numeric exit, and output paths are in the corresponding
`*.result.json` files. The authoritative aggregate is
`00-suite-summary-final.json`.

| Exact command | Result evidence |
| --- | --- |
| `powershell.exe -NoLogo -NoProfile -NonInteractive -File scripts\task15\Test-TauriBundlerMirror.ps1` | `01-test-tauri-bundler-mirror.result.json`, `.stdout.log`, `.stderr.log` |
| `powershell.exe -NoLogo -NoProfile -NonInteractive -File scripts\task15\Test-Task15BuildIntegration.ps1` | `02-test-task15-build-integration.result.json`, `.stdout.log`, `.stderr.log` |
| `powershell.exe -NoLogo -NoProfile -NonInteractive -File scripts\task15\Test-WebViewAcquisition.ps1` | `03-test-webview-acquisition.result.json`, `.stdout.log`, `.stderr.log` |
| `powershell.exe -NoLogo -NoProfile -NonInteractive -File scripts\task15\Test-WebViewBuildIntegration.ps1` | `04-test-webview-build-integration.result.json`, `.stdout.log`, `.stderr.log` |

### Per-file parser evidence

`parser/00-parser-summary.json` records `PASS`, count `11`, and numeric exit
`0` for every retained Task 15 `.ps1`/`.psm1` file. Each parse used the logical
command form:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "[void][scriptblock]::Create([IO.File]::ReadAllText('<relative-path>'))"
```

The per-file result records contain that logical command, the exact executed
UTF-16LE `-EncodedCommand`, timestamps, synchronous `$LASTEXITCODE`, stdout,
and stderr. All 11 stdout files say `Parser PASS`; all 11 stderr files are
empty.

### Reproducible final integrity audit

The retained audit script is `05-final-integrity-audit.ps1` and its exact
command was:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -File work\logs\task15a\final-review-20260803-1812\05-final-integrity-audit.ps1
```

`05-final-integrity-audit.process.json` records numeric exit `0`, stdout and
empty stderr paths, and audit-script SHA-256
`4025CC6F6F21EB35095F41CD604B8D518BCBE66774471DF306548A02280AD112`.
`05-final-integrity-audit.json` records `PASS` and preserves:

- both copied and source installer paths, exact sizes and SHA-256 values, with
  byte identity between each copied/source pair;
- both exact Visual Studio 7-Zip commands and numeric exit `0`, with separate
  stdout/stderr logs and fresh extracted trees under `integrity-extraction/`;
- exactly one embedded WebView payload per installer, each 209,567,440 bytes,
  exact expected SHA-256, `Valid` Authenticode, and Microsoft Corporation
  signer;
- embedded application PE machine `0x8664`, exact 0.0.9/0.1.0 file and product
  versions, plus wrapper versions and wrapper `NotSigned` status;
- all generated NSIS assertions, all six protected before/after/current hashes
  equal, the exact four approved `tauri-bundler/2.9.4` mirror requests, and
  absence of a Tauri large WebView GET; and
- the recorded mirror PID absent, listener count `0`, exact audit-descendant
  count `0`, and repository-executable count `0`.

### Historical and superseded evidence labels

`06-evidence-supersession.json` is the machine-readable authority map. The
following older files remain retained unchanged but are explicitly historical
and **superseded for final-state claims**:

- `work/logs/task15a/16-final-integrity.log` is the initial-attempt audit whose
  zero-installer statement predates the corrected completed build. Its SHA-256
  is `82EB459BD55CDC44816BD39C990A19BB1CD63AB3DC90B953BE555DFBA6DC5C46`.
- `work/logs/task15a/orphan-processes.json` is a historical false positive that
  captured the observing diagnostic PowerShell command itself with a null
  `ExecutablePath`. Its SHA-256 is
  `9A17CFD7A3D61B30C39EACB34CB815F64359170237721909536243BC4E7B7F0B`.

The intermediate `final-review-20260803-1802`, `-1805`, and `-1810`
directories are also retained as superseded evidence-harness attempts. Within
the authoritative `-1812` directory, `00-suite-summary.json` is a superseded
aggregate produced with regex syntax unsupported by `Get-ChildItem -Filter`;
the four per-command result files were valid, and
`00-suite-summary-final.json` is the authoritative recomputation.

No installer rebuild was needed because all four suites passed. This retention
correction modified only this checkpoint document among source-like files and
created the checkpoint/evidence paths described above. Both installers remain
**UNACCEPTED** pending Task 15B.
