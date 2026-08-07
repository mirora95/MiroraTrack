# Task 14C — WebView2 Offline Hardening

## Status

**BLOCKED** on 2026-08-03. All three specification-approved, one-variable WebView2 argument candidates failed the binding native offline criterion. The original Tauri configuration was restored byte-for-byte and the temporary regression test was removed. No product change from Task 14C is retained.

## Scope and controls

- Repository: `C:\Users\orasta\Documents\Projects\MiroraTrack`.
- No Git command was run and Git metadata was not accessed or changed.
- Product-file scope was limited to temporary changes in `src-tauri/tauri.conf.json` and temporary creation of `src-tauri/tests/webview_offline_config.rs`.
- The exact before-copy is `work/checkpoints/task-14c-before/tauri.conf.json`.
- Source and backup SHA-256 before work: `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E`.
- The real WebView2 user-data folder was never deleted, renamed, relocated, copied over, or used as an isolated test target.

## Baseline evidence

- Debug executable SHA-256: `059535A060FFBF785CB56CA0890E88D2F13D1BFDA261B28DAF1C77DFD3492E59`.
- WebView2 runtime: `150.0.4078.105`.
- Runtime executable SHA-256: `D0D22DF2B5DFA96AB82965FCFC2A9E42DF91AB0AAC3E1C5988D8B0016ADFF237`.
- Real UDF: `C:\Users\orasta\AppData\Local\com.miroratrack.desktop\EBWebView`.
- Before launches: 226 files, 16,245,201 bytes, zero hash-read errors.
- Three cold launches against the unchanged configuration reproduced the failure: 3/3 runs had non-loopback remote TCP, zero listeners, clean `MiroraTrack` windows and exits, and zero orphans across 50 full process-tree/TCP samples.

The complete before manifest, including protected hashes and a recursive UDF manifest, is `work/checkpoints/task-14c-before/baseline-manifest.json`.

## Strict RED/GREEN experiments

The integration test parsed the real `tauri.conf.json` with `serde_json` and required the exact full `additionalBrowserArgs` string. Exact-string retention matters because the local Tauri/Wry configuration contract replaces the default argument value when the property is configured.

### Candidate 1 — initial and only first experiment

Required exact value:

```text
--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required --disable-background-networking
```

- RED: 0 passed / 1 failed; actual value was `Null`.
- GREEN: 1 passed / 0 failed after the minimal configuration change.
- Rust formatting and Tauri x64 debug rebuild completed with exit 0.
- Native result: **failed**. 10/10 real-UDF cold launches had remote TCP across 139 full samples; zero listeners, unclean exits, orphans, or title failures.
- Candidate executable SHA-256: `B8902E41C346A03C1EECD93342F729A1B064185A48E86EAABDC5EEB145649758`.
- Candidate configuration SHA-256: `2994DAC3EA18D4BB43193E972226714C6B37A399609002897FAD3F8F4F27A940`.

### Candidate 2 — add only component-update suppression

Only `--disable-component-update` was appended.

- RED: 0 passed / 1 failed; the actual exact string lacked `--disable-component-update`.
- GREEN: 1 passed / 0 failed after the one-variable configuration change.
- Rust formatting and Tauri x64 debug rebuild completed with exit 0.
- Native result: **failed**. 10/10 real-UDF cold launches had remote TCP across 176 full samples; zero listeners, unclean exits, orphans, or title failures.
- Candidate executable SHA-256: `2EFDD2B259580EAC0A7C9901F548B5784862D865436B908AD7C6CAA424958F1B`.
- Candidate configuration SHA-256: `038C10449043422AD6B8AD56D82096D92921EC551F2B259ABA3FE6BFDC7EEE2E`.

### Candidate 3 — add only domain-reliability suppression

Only `--disable-domain-reliability` was appended to candidate 2.

- RED: 0 passed / 1 failed; the actual exact string lacked `--disable-domain-reliability`.
- GREEN: 1 passed / 0 failed after the one-variable configuration change.
- Rust formatting and Tauri x64 debug rebuild completed with exit 0.
- Native result: **failed**. 10/10 real-UDF cold launches had remote TCP across 181 full samples; zero listeners, unclean exits, orphans, or title failures.
- Candidate executable SHA-256: `1A5FE4A171E4B4410B13BEB2AE77D6FC0153332464DFF901D6E037EE4365DCF8`.
- Candidate configuration SHA-256: `1DCC18A51DFD30C8B9C8BA6AEBE7F7AF790BE2C5239BAD98955FFCC5FDBDFB37`.

Across baseline and all candidates, 33/33 cold launches had remote TCP across 546 captured full process-tree/TCP samples. All 33 had zero listeners, the expected `MiroraTrack` title, clean exit code 0, and zero related orphans. Observed remote targets included the configured proxy `192.168.1.5:3128`, Microsoft `52.110.*:443` addresses, and `204.79.197.203:80`. The candidate command-line records show that WebView2 received each exact requested flag set, so this is a runtime-specific limitation of the approved flag set on WebView2 `150.0.4078.105`, not lost configuration propagation.

## Required stop and restoration

Because the final approved candidate still failed, no speculative flags or policies were tried. In particular, Task 14C did not add `--no-proxy-server`, crashpad test flags, unsupported flags, or enterprise policies.

- Restored `src-tauri/tauri.conf.json` SHA-256: `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E`.
- Exact before-copy match: yes.
- Removed `src-tauri/tests/webview_offline_config.rs`: confirmed absent.
- A cleanup-only x64 debug rebuild completed with exit 0 after restoration so the generated executable reflects the restored source; resulting executable SHA-256: `92CA9EA23F38F439A577EF1936669551AF756B5028C918D6C389331C9E7AC59B`.
- Revalidated the prior 212-entry protected source/asset/configuration manifest: 0 mismatches.
- Related MiroraTrack/WebView2 processes after restoration: 0.
- Real UDF after evidence collection: still present, 231 files, zero hash-read errors.

The restored-state manifest is `work/logs/task-14c/post-restore-manifest.json`.

## Acceptance work intentionally not run

The stop-on-failure contract fired before disposable-profile testing, native persistence/functionality acceptance, the full npm/Rust/E2E verification gate, final passing native smoke, and offline endpoint audit. No acceptance claim is made for those unexecuted steps. Earlier Task 14B results are not promoted into Task 14C acceptance.

## Files

Final product files changed: none.

Created checkpoint/evidence files:

- `docs/checkpoints/task-14c.md`
- `work/checkpoints/task-14c-before/tauri.conf.json`
- `work/checkpoints/task-14c-before/baseline-manifest.json`
- `work/logs/task-14c/Write-BaselineManifest.ps1`
- `work/logs/task-14c/Invoke-NativeLaunchAudit.ps1`
- `work/logs/task-14c/tdd-red-cargo-test.log`
- `work/logs/task-14c/tdd-green-cargo-test.log`
- `work/logs/task-14c/experiment-2-tdd-red.log` (an incomplete pipeline-capture attempt; the immediately repeated direct checked invocation produced the expected exact-string RED described above)
- `work/logs/task-14c/baseline-cold-launches/*`
- `work/logs/task-14c/candidate-1-cold-launches/*`
- `work/logs/task-14c/candidate-2-component-update-cold-launches/*`
- `work/logs/task-14c/candidate-3-domain-reliability-cold-launches/*`
- `work/logs/task-14c/post-restore-manifest.json`

Generated `dist` and `src-tauri/target` outputs refreshed during candidate builds. They are build artifacts, not retained source changes.

## Self-review

- Every product configuration change followed a failing exact regression test and a passing rerun.
- Only one approved behavior variable changed per experiment.
- Native runs sampled the full dynamic process tree and TCP state repeatedly through every observation window.
- The failure criterion was not weakened after repeated clean window/exit results.
- The original configuration and protected repository manifest were freshly verified after restoration.
- No Git access occurred.
