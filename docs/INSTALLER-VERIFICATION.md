# Windows installer verification

## Acceptance state

Installer artifacts created by Task 15A are build outputs under
`work/artifacts/task15/unaccepted/`. They remain **UNACCEPTED** until the full
Task 15B lifecycle is run in Windows Sandbox, a disposable virtual machine, or
a dedicated empty Windows profile. Never run lifecycle tests against a primary
user profile.

Task 15A completed its build-and-inspection scope after two historical network
blocks. The pinned NSIS assets were acquired from official GitHub REST asset
endpoints, validated, and served only through an exact-path loopback mirror.
The Microsoft WebView2 runtime was then acquired independently with resumable,
binding-aware range requests, exact hash validation, and Authenticode
validation before it was staged for Tauri. The locked tool versions were
`tauri-cli 2.11.4` and `tauri-bundler 2.9.4`.

The exact Task 15B inputs are:

| Version | Relative path | Size | SHA-256 | Installer signature |
| --- | --- | ---: | --- | --- |
| `0.2.0` | `work/artifacts/task15/unaccepted/0.2.0/MiroraTrack_0.2.0_x64-setup.exe` | `214,723,086` | `77C6CD06459AB222D14E045D175536EE07878E48FD42B4187E43A8C04A58FC4A` | `NotSigned` |
| `0.3.0` | `work/artifacts/task15/unaccepted/0.3.0/MiroraTrack_0.3.0_x64-setup.exe` | `214,776,076` | `35FD59ACFB48BC30472DC5B07184B41B392904B7696E83C05128079483334EA8` | `NotSigned` |

These supersede the `0.0.9`, `0.1.0`, and `0.1.9` artifacts. Those remain on
disk but are no longer described by `manifest.json`, so the Task 15B harness
will not accept them, and their earlier verification evidence does not transfer
to the build above. The pair was produced by `scripts/Build-InstallerPair.ps1`
rather than the Task 15 orchestrator; see `docs/checkpoints/task-15c.md`.

The `0.2.0` row is byte-identical to the artifact verified for the previous
release: it was carried forward with `-ReusePreviousInstaller`, which re-checks
its SHA-256 against the outgoing manifest before the build starts. Only `0.3.0`
was compiled in this run. Its loopback request log contains exactly the pinned
NSIS 3.11 archive and the `nsis_tauri_utils` 0.5.3 DLL, once each, and the
staged WebView2 payload was not rewritten during bundling, so no WebView2
download occurred despite the bundler logging a `go.microsoft.com` URL before
consulting its cache.

Extraction of the `0.2.0` installer found exactly one embedded
`MicrosoftEdgeWebView2RuntimeInstaller.exe`, 209,567,440 bytes, SHA-256
`7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`,
with a `Valid` Authenticode signature from Microsoft Corporation. Generated
NSIS evidence for that build records x64, current-user scope, offline WebView2,
disabled downgrades, Desktop and Start menu shortcut creation, and ARP
`NoModify=1` and `NoRepair=1`.

The equivalent extraction for `0.3.0` is **outstanding**. Its build staged the
same hash-and-signature-verified payload and its size is consistent with that
payload being embedded, but the bytes inside the installer have not been
independently inspected. `scripts/task15/Invoke-Task15FinalIntegrityAudit.ps1`
cannot supply this evidence for a `Build-InstallerPair.ps1` run, because it
requires the gate and build lineage manifests and phase status files that the
minimal build path deliberately does not produce. Extract and inspect `0.3.0`
before acceptance rather than inferring the payload from the file size.

These are static build facts only; Task 15B must still exercise the lifecycle.
Both installers remain **UNACCEPTED**.

## Required lifecycle sequence

Task 15B must use the exact, hash-verified installer pair named by
`manifest.json` and perform this sequence with networking disabled. The current
pair is 0.2.0 (Previous) and 0.3.0 (Current):

1. Install 0.2.0 for the sandbox/dedicated current user.
2. Verify the MiroraTrack executable, Desktop shortcut, and Start menu
   shortcut; launch from the Desktop shortcut.
3. Create a known ledger, preferences, and a backup; close and reopen from the
   Start menu and verify the exact derived balance.
4. Upgrade to 0.3.0 and verify the same IndexedDB records, localStorage
   preferences, selected backup location, and backup bytes.
5. Confirm the generated NSIS manifest contains `NoRepair=1`, then run a
   same-version reinstall and verify persistence again. This is a reinstall
   test, not a Windows Installer "Repair" claim.
6. Uninstall and prove that the WebView application-data directory and backup
   files remain. The test must not delete either location.
7. Reinstall 0.3.0 and verify the preserved finance records reconnect.

Step 4 carries extra weight for the 0.3.0 pair. Custom categories introduced a
new persisted category identifier form (`custom:expense:<name>`), so this is
the first upgrade where the previous version cannot read every identifier the
current version writes. The 0.2.0 baseline must therefore be the installer
built from genuine 0.2.0 source. `scripts/Build-InstallerPair.ps1` otherwise
builds both versions from the current working tree and only relabels the
version, which would leave both sides speaking the new format and make this
step prove nothing; `-ReusePreviousInstaller` keeps the real baseline instead.
Create at least one budget and one transaction under a built-in category on
0.2.0, then confirm after the upgrade that both still report the same amounts.

Manual confirmation of the known account, transactions, and ledger-derived
balance is required before acceptance. A process exit code alone is not enough.

## Input preflight

`work/artifacts/task15/unaccepted/manifest.json` is the authoritative input
manifest. `scripts/verify-installer.ps1` intentionally refuses to run outside
Windows Sandbox. Before it writes evidence, it fails closed unless the two
distinct paths exactly match the manifest's role, filename, x64 architecture,
version, size, SHA-256, and `NotSigned` status:

```powershell
powershell -NoProfile -File scripts/verify-installer.ps1 `
  -PreviousInstaller C:\MTInput\MiroraTrack_0.2.0_x64-setup.exe `
  -CurrentInstaller C:\MTInput\MiroraTrack_0.3.0_x64-setup.exe `
  -EvidenceDirectory C:\MTEvidence `
  -ExpectedManifestPath C:\MTInput\manifest.json
```

## Signing

Local development installers may be unsigned and can trigger Windows
reputation warnings. Record `NotSigned` honestly. A future signed build must be
treated as a new artifact and repeat the complete host gate, embedded-payload
inspection, and Task 15B lifecycle verification. Signing an already-tested
file changes its hash and invalidates the earlier evidence.

## Data preservation boundary

Application upgrades and reinstalls must preserve IndexedDB, localStorage,
backup-folder settings, and backup files. Uninstall must never remove finance
records or backups without separate explicit user confirmation. Acceptance is
pending until Task 15B proves these behaviors with an isolated real install.
