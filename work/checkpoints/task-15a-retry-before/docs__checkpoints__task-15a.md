# Task 15A — quarantined Windows installer build

## Status

**BLOCKED** on 2026-08-03 during acquisition of Tauri's pinned NSIS 3.11
build tool. The complete host gate passed first. No NSIS installer was produced,
no artifact was copied into `work/artifacts/task15/unaccepted/`, and no release
or lifecycle acceptance is claimed.

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
