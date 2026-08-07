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
| `0.0.9` | `work/artifacts/task15/unaccepted/0.0.9/MiroraTrack_0.0.9_x64-setup.exe` | `214,689,107` | `2F820DB676CFDC8906F4A8C4761E9EC335196530E25802E59C800F4D0C1D448C` | `NotSigned` |
| `0.1.0` | `work/artifacts/task15/unaccepted/0.1.0/MiroraTrack_0.1.0_x64-setup.exe` | `214,686,623` | `426AA75C45862891A7A6A3A7A144EEF6E2871E84A81656D0F02B6957A85CCA34` | `NotSigned` |

Fresh extraction of both copied installers found exactly one embedded
`MicrosoftEdgeWebView2RuntimeInstaller.exe` in each. Each payload is
209,567,440 bytes, has SHA-256
`7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`,
and has a `Valid` Authenticode signature from Microsoft Corporation. Generated
NSIS evidence records x64, current-user scope, offline WebView2, disabled
downgrades, Desktop and Start menu shortcut creation, and ARP `NoModify=1` and
`NoRepair=1`. These are static build facts only; Task 15B must still exercise
the lifecycle. Both installers remain **UNACCEPTED**.

## Required lifecycle sequence

Task 15B must use exact, hash-verified 0.0.9 and 0.1.0 installers and perform
this sequence with networking disabled:

1. Install 0.0.9 for the sandbox/dedicated current user.
2. Verify the MiroraTrack executable, Desktop shortcut, and Start menu
   shortcut; launch from the Desktop shortcut.
3. Create a known ledger, preferences, and a backup; close and reopen from the
   Start menu and verify the exact derived balance.
4. Upgrade to 0.1.0 and verify the same IndexedDB records, localStorage
   preferences, selected backup location, and backup bytes.
5. Confirm the generated NSIS manifest contains `NoRepair=1`, then run a
   same-version reinstall and verify persistence again. This is a reinstall
   test, not a Windows Installer "Repair" claim.
6. Uninstall and prove that the WebView application-data directory and backup
   files remain. The test must not delete either location.
7. Reinstall 0.1.0 and verify the preserved finance records reconnect.

Manual confirmation of the known account, transactions, and ledger-derived
balance is required before acceptance. A process exit code alone is not enough.

## Input preflight

`scripts/verify-installer.ps1` intentionally refuses to run outside Windows
Sandbox. Task 15B uses it only to resolve exact installer paths and record input
size, SHA-256, and Authenticode status before the lifecycle controller begins:

```powershell
powershell -NoProfile -File scripts/verify-installer.ps1 `
  -PreviousInstaller C:\MTInput\MiroraTrack_0.0.9_x64-setup.exe `
  -CurrentInstaller C:\MTInput\MiroraTrack_0.1.0_x64-setup.exe `
  -EvidenceDirectory C:\MTEvidence
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
