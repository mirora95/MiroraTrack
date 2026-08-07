# Windows installer verification

## Acceptance state

Installer artifacts created by Task 15A are build outputs under
`work/artifacts/task15/unaccepted/`. They remain **UNACCEPTED** until the full
Task 15B lifecycle is run in Windows Sandbox, a disposable virtual machine, or
a dedicated empty Windows profile. Never run lifecycle tests against a primary
user profile.

Task 15A remains blocked before an NSIS installer was produced. The initial
pinned-NSIS download failure was remediated with official REST metadata and
hash validation plus a loopback-only exact-path mirror. The retry passed the
complete host gate and Tauri verified, hash-checked, and extracted both assets,
but the 209,567,440-byte Microsoft WebView2 offline runtime made no body
progress within the build's 900-second no-output bound. No file in the
`unaccepted` directory is a release artifact unless its version, hash,
embedded payloads, and signatures are recorded in
`docs/checkpoints/task-15a.md`.

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
