# Task 14F — offline WebView2 provisioning for the isolated guest

## Status

**Harness change implemented and statically verified on 2026-08-07.** The Task
14E blocker is removed in the harness: the isolated guest now provisions the
Microsoft WebView2 runtime from a host-staged, hash-verified, Microsoft-signed
offline installer instead of stopping. The full sandbox run has not yet been
executed, so no functional-offline, persistence, canary, or normal-smoke claim
is made or restored by this checkpoint.

## Blocker being resolved

Task 14E stopped at the binding guest preflight with:

```text
BLOCKED: local Microsoft WebView2 runtime is absent; the guest must never download it.
```

The stock Windows Sandbox image contains no WebView2 runtime, and the harness
correctly refused to acquire one from inside an isolated guest.

## Approach

The invariant was never "the guest must have a preinstalled runtime". It was
"the guest must never download". Those are separable. The host already holds the
exact runtime as a bound, verified artifact:

- `work/toolchain/webview-offline/binding.json`
- `work/toolchain/webview-offline/05320a5b-d0ef-46cd-b938-672f3258dc27/MicrosoftEdgeWebView2RuntimeInstallerX64.exe`
- 209,567,440 bytes, SHA-256 `7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`

This is byte-identical to the runtime the Task 15A NSIS installers embed, as
independently established in `docs/checkpoints/task-15a.md`. The guest therefore
installs the same runtime a real end user would receive, from a read-only
mapping, with networking already proven dead by the preceding preflight gates.

## File-based checkpoint

Before-copies and hashes are in `work/checkpoints/task14f-before/`. All six
harness files matched the Task 14E checkpoint table byte-for-byte before
modification, confirming no drift since that run.

No application source, application test, dependency, manifest, lockfile, or
native wrapper was edited. No Git command was run.

| File | Before | After |
| --- | --- | --- |
| `Invoke-Task14E.ps1` | `0E04118974B4B1551DA21CC60F356EFDA556FA8D76D0E88342E9EF36890706E6` | `E2135951F8625691E41010F8B31D82210E6645A9BFF180C3C071C6D772F595A3` |
| `guest.ps1` | `210163C99B5FEE50E5F5717F65B30C2C1F2DC7A4D25CB0BD52B00FC950FBBF3A` | `94DF8F3B70147E5CAF85ADB2F40651979E14E709AAD204CEE6257F2A49EBA6FA` |
| `Test-HarnessStatic.ps1` | `F4B0CB815EFBE11B47C5F3D9C1202FE5B970E67CEF00A4F6D00A4E349DBEF272` | `D0A2888E863FFD4300C08B7EAF930EC0A7AF2844EEAF9783B8D563DDB97A8C72` |
| `sandbox.wsb.template` | `1EAF16A0980D2C2711AE524BA5E105434941D25CE92B1BCF0F94F10F2D4068E4` | unchanged |
| `guest.js` | `BA0D721DF4E7CDA4E33EC201EA9695B0730711816A72DAD3578F3B6F273D17A4` | unchanged |
| `dialog-watcher.ps1` | `C0C2C3DEFB4FB1FA68DB8D46BA04315CB7609A3D4D14D7E0D412965C38F97388` | unchanged |

The sandbox template is deliberately unchanged: the runtime is delivered through
the existing read-only `C:\MTInput` mapping, so the isolation contract still has
exactly two mappings and networking stays disabled.

## Test-first cycle

RED — `work/logs/task14f/tdd-red-webview-provisioning.log`, exit `1`, failing on
exactly the eight new assertions and nothing else:

```text
missing required token: /install
missing required token: /silent
missing required token: CN=Microsoft
missing required token: Get-AuthenticodeSignature
missing required token: MicrosoftEdgeWebView2RuntimeInstallerX64.exe
missing required token: binding.json
missing required token: webView2Provisioning
missing required token: webview-offline
```

GREEN — `work/logs/task14f/tdd-green-webview-provisioning.log`, exit `0`:

```text
Task 14E static harness validation: PASS
```

## Static validator additions

- the controller must reference the bound offline artifact and verify it with
  `Get-AuthenticodeSignature` against `CN=Microsoft Corporation`;
- the guest must resolve the installer from `$inputRoot` specifically, so the
  payload can only come from the read-only staged mapping;
- the guest must retain the `the guest must never download it` failure path;
- new repository-wide forbidden tokens across every harness file:
  `Start-BitsTransfer`, `DownloadFile`, `DownloadString`, `curl.exe`,
  `wget.exe`, `msedge.sf.dl.delivery.mp.microsoft.com`, and
  `go.microsoft.com/fwlink`.

The pre-existing `Invoke-WebRequest` call is retained because it is the negative
network-isolation probe against `example.com` and must keep failing.

## Host staging gate

`Get-StagedWebView2Runtime` refuses to stage unless all four hold. Verified
against the real artifact on 2026-08-07:

| Gate | Result |
| --- | --- |
| length equals bound `Size` | PASS |
| SHA-256 equals bound `Sha256` (case-sensitive) | PASS |
| Authenticode status is `Valid` | PASS |
| signer subject is `CN=Microsoft Corporation, O=Microsoft Corporation...` | PASS |

The staging record is written into the input manifest under `webView2`, so the
runtime provenance is part of the same hash manifest the guest re-verifies.

## Guest provisioning behavior

Provisioning runs after the network-isolation gates, so it is structurally
impossible for it to reach the network. The guest re-verifies the Authenticode
signature of the staged file, copies it to guest-local `%TEMP%` because the
input mapping is read-only and the installer extracts beside itself, runs
`/silent /install`, requires exit `0`, then requires a real runtime executable
to exist. It records `webView2Provisioning` with `downloaded=false` in
`preflight.json`. If the image ever does ship a runtime, the preinstalled branch
is taken and nothing is installed.

## Consequence for Task 15B

Task 15B does not need this provisioning at all. `src-tauri/tauri.conf.json`
sets `bundle.windows.webviewInstallMode.type` to `offlineInstaller`, so the NSIS
installer already carries the same 209,567,440-byte runtime and installs it with
no network. Task 14E needed provisioning only because it stages a bare debug
executable with no installer. The absence of WebView2 in the sandbox image is
therefore not a Task 15B blocker, and 15B should deliberately **not**
pre-provision the runtime — installing it from the bundle is part of what 15B
must prove.

## Full run on 2026-08-07

Run `20260807-101703-8371adbd`. Controller exit `1`, guest status `BLOCKED`.
**The provisioning fix worked; a different, previously unreachable defect is now
exposed.**

Cleared for the first time:

- all input-mapping mutation, atomic-evidence, and staged-hash gates PASS;
- network isolation PASS: `usableDefaultRoutes=0`, DNS failed, HTTPS failed in
  `0.168` s, public TCP failed;
- WebView2 provisioning PASS from the staged offline installer — installer
  SHA-256 `7D1ED8BD…153190`, signer `CN=Microsoft Corporation`, exit `0`,
  `49.892` s, `downloaded=false`;
- runtime `151.0.4129.59` present at
  `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\151.0.4129.59\msedgewebview2.exe`;
- MiroraTrack launched and produced its exact `MiroraTrack` native window.

New blocker — the Chrome DevTools Protocol endpoint never opened:

```text
Error: CDP endpoint did not become available
    at waitFor (C:\MTInput\guest.js:24:9)
```

### Root cause

The harness requests CDP by setting the
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable before launch
(`guest.ps1:44`). That variable is honored by the WebView2 loader **only when
the host application does not supply AdditionalBrowserArguments itself**. Wry
always supplies them. Verified in
`wry-0.55.1/src/webview2/mod.rs:294-327`:

```rust
let additional_browser_args = pl_attrs.additional_browser_args.unwrap_or_else(|| {
  let default_args = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
  ...
});
...
options.set_additional_browser_arguments(additional_browser_args);
```

`set_additional_browser_arguments` is called unconditionally, with a default
string when `additionalBrowserArgs` is absent from `tauri.conf.json` — which is
the current state. The environment variable is therefore always ignored, and
`--remote-debugging-port=9222` never reaches the browser process. This is not a
regression from Task 14F and could not have been observed before, because the
run never previously reached launch.

This also explains the Task 14C observation that "the local Tauri/Wry
configuration contract replaces the default argument value when the property is
configured" — the same unconditional call.

### Two consequential reporting defects found

1. `guest.js:225` requests the application close only on the success path. When
   `connect()` throws, `browser` is undefined and the app is never closed, so
   the guest reports `MiroraTrack did not exit cleanly after full automation`
   instead of the actual CDP failure. The authoritative cause survives only in
   `guest-js-result.json`.
2. `guest.js:232` sets `process.exitCode = 1` on failure, yet `guest.ps1`
   passed its `nodeExit -eq 0` assertion and fell through to the app-exit
   check. The guest-side numeric exit capture does not agree with the Node exit
   code. Unexplained; the host controller already solved an equivalent problem
   with `GetExitCodeProcess`, and the guest may need the same treatment.

Both cause a real failure to be reported as the wrong failure, and should be
fixed before the CDP work so the next run is diagnosable.

## Not yet done

- CDP cannot work through the environment variable; enabling it requires
  `additionalBrowserArgs` to carry `--remote-debugging-port=9222`. This must not
  ship in a production bundle, so it needs a debug-only configuration overlay
  (`tauri build --debug --config <overlay>`) that leaves the protected
  `src-tauri/tauri.conf.json` byte-identical. Not attempted; it is a product
  configuration decision.
- no functional-offline, persistence, canary, or normal-smoke result is claimed;
- Task 15B installer lifecycle verification remains entirely outstanding, and
  per the section above it does not depend on any of this.
