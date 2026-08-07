# Task 15B — installer lifecycle verification

## Status

**PASS with a verified ledger** on 2026-08-07, run `20260807-105332-13e36f46`.
The complete installer lifecycle executed in an isolated, offline Windows
Sandbox against the exact quarantined Task 15A artifacts. A known account and
opening transaction were created through the shipped user interface, and the
ledger-derived balance was confirmed both machine-readably and visually after
the full upgrade, reinstall, uninstall, and reinstall cycle. All four
data-preservation gates passed with zero missing and zero altered files.

An earlier run, `20260807-104050-7b1f51ee`, proved the same lifecycle mechanics
before ledger entry existed.

**Caveat on the ledger evidence.** The harness that produced run
`20260807-105332-13e36f46` was later found to be timing-fragile; see the
reliability section below. The evidence from that run is genuine — the backup
envelope and both dashboard screenshots are unambiguous — but it was obtained by
an automation layer that succeeds only about half the time, and it was initially
reported with more confidence than that warranted. The harness has since been
changed so ledger claims are recorded rather than gating, which means a later
run may legitimately report `ledgerDataEntry: NOT-VERIFIED` while still passing
the lifecycle.

The last two verification runs were terminated externally before completion, so
the reworked recording behaviour has not yet been observed end to end. Both left
a sandbox environment running, which was stopped by exact ID; a process kill
bypasses the controller's cleanup, so check `wsb.exe ListRunningSandboxes` after
any interrupted run.

The installers remain **UNACCEPTED** pending the residual items at the end of
this document.

## Harness

Created under `scripts/task15b/`:

- `Test-Task15BHarnessStatic.ps1` — fail-closed static gate run before execution
- `Invoke-Task15B.ps1` — host controller, staging, sandbox lifecycle by exact ID
- `guest.ps1` — the in-guest lifecycle
- `sandbox.wsb.template` — two mappings, networking disabled

Test-first: RED `work/logs/task15b/tdd-red-harness-static.log` (exit 1, missing
harness files), GREEN `work/logs/task15b/tdd-green-harness-static.log` (exit 0).

The controller is forbidden by the validator from containing `tauri build`,
`npm run build`, or `cargo build`: 15B may only consume Task 15A output. Each
installer is staged only after its length and case-sensitive SHA-256 match
`work/artifacts/task15/unaccepted/manifest.json`. The validator also forbids the
guest from containing any deletion of the finance-data or backup roots.

## Verified lifecycle

| Step | Result |
| --- | --- |
| Sandbox guard (`WDAGUtilityAccount`) | PASS |
| Network isolation: 0 usable routes, DNS failed | PASS |
| Input preflight against the 15A manifest | PASS |
| Clean slate: no ARP entry, no data dir, no backups | PASS |
| Install `0.0.9` silently, offline | PASS, exit 0, 67.047 s |
| ARP `DisplayVersion=0.0.9`, `NoModify=1`, `NoRepair=1` | PASS |
| Desktop and Start menu shortcuts resolve to the executable | PASS |
| Launch from the Desktop shortcut | PASS, clean exit 0 |
| Reopen from the Start menu shortcut | PASS, clean exit 0 |
| Upgrade to `0.1.0` | PASS, exit 0, 17.956 s |
| Same-version reinstall of `0.1.0` | PASS |
| Uninstall | PASS, exit 0 |
| Reinstall after uninstall, then launch | PASS, clean exit 0 |

Install location `C:\Users\WDAGUtilityAccount\AppData\Local\MiroraTrack`, i.e.
current-user scope as configured. Both shortcuts targeted
`...\MiroraTrack\miroratrack.exe`.

## Data preservation

`Get-DataManifest` inventories every file under
`%LOCALAPPDATA%\com.miroratrack.desktop` and
`Documents\MiroraTrack\Backups` with SHA-256. `Assert-DataPreserved` requires
that no pre-existing file disappears or changes hash across an installer
transition. Additions are permitted.

| Gate | Files before | Files after | Missing | Altered |
| --- | ---: | ---: | ---: | ---: |
| `upgradePreservation` | 212 | 212 | 0 | 0 |
| `reinstallPreservation` | 213 | 213 | 0 | 0 |
| `uninstallPreservation` | 213 | 213 | 0 | 0 |
| `reinstallAfterUninstall` | 213 | 213 | 0 | 0 |

Per-gate detail is in `preservation-*.json` in the run evidence directory.
**Uninstall preserved all 213 finance-data files.** Both shortcuts were removed
by the uninstaller, recorded as `uninstallShortcutCleanup` rather than asserted,
because the specification requires preservation here and not cleanup.

## Defects found and fixed during bring-up

Three were in the harness, not the product:

1. **Leaked sandbox environment.** Windows Sandbox is single-instance. The
   Task 14E guest powers off only on PASS and its controller stopped the
   environment only on timeout, so the blocked 14F run left its environment
   alive and every later `StartSandbox` failed with
   `0x800401F6 CO_E_APPSINGLEUSE`. Both controllers now release their own
   sandbox by exact ID on every path and record the outcome. Foreign
   environments are never stopped automatically.
2. **Int32 overflow masked the real error.** `[int]$native` cannot hold an
   HRESULT-style exit code such as `2147746294`, so the genuine failure was
   replaced by a cast exception and the diagnostic stderr line went unread.
   Widened to `[int64]`, with the hex code and captured stderr folded into the
   thrown message.
3. **Preservation failures discarded their own evidence.**
   `Assert-DataPreserved` threw before recording, leaving only a count. It now
   writes `preservation-<label>.json` before asserting.

A fourth was a false positive that this fix chain resolved. Run
`20260807-103551-b47292ff` reported `reinstallPreservation failed: 2 file(s)
missing, 2 file(s) altered`. The snapshot was taken immediately after an
application session, while WebView2 browser and crashpad processes were still
flushing caches, so the application's own shutdown writes were attributed to the
installer. `Wait-ForQuiesce` now blocks until `miroratrack` and
`msedgewebview2` processes have exited before any snapshot. With that in place
the same transition passes cleanly. **No product defect was involved.**

## Reliability of the user-interface automation

**The keyboard automation is intermittent and must not be treated as a gate.**
Onboarding outcomes across runs: 4 pass, 6 pass, 7 pass, 8 fail, 9 fail, 10 fail,
11 pass, 12 fail, 13 pass. Runs 11 and 12 executed byte-identical code with
opposite results.

The cause is structural, not a tuning problem. Without CDP or a WebView2
accessibility tree there is no way to confirm that a keystroke was delivered.
`SendKeys` reports success whether or not the web content had keyboard focus, so
the automation is open-loop. Attempts to stabilise it made it worse and were all
reverted:

| Attempt | Runs | Result |
| --- | --- | --- |
| Longer settles between wizard steps | 8, 9 | worse; fewer steps advanced |
| `SW_MAXIMIZE` for stable geometry | 9, 10 | no effect on delivery |
| Synthetic click into inert page chrome | 10 | no keystrokes delivered at all |
| Type-ahead instead of arrow keys on selects | 11 | account select never left its placeholder, where arrow keys had worked in run 7 |

The proven configuration is the original cadence with arrow-key selection, plus
one evidence-backed fix: a settle after the account is chosen, because selecting
it re-renders the form and the re-render swallows the next Tab. Do not retry the
four attempts above without new information.

Because of this, `Test-LedgerClaim` records each ledger claim as verified or not
instead of aborting. The assertions remain strict, so a recorded pass still means
the exact account name, opening amount, transaction count and derived net all
matched. Only the installer lifecycle can fail the run. This keeps a genuine
installer regression distinguishable from an undelivered keystroke, which a
combined gate could not do.

## Ledger verification

Neither CDP nor a WebView2 accessibility tree is available in the shipped build,
and neither can be enabled without rebuilding, which would invalidate the
hash-locked Task 15A artifacts this task exists to verify. Two properties of the
product made automation possible anyway:

- every default in the onboarding wizard is already valid and step 3 autofocuses
  the account name, so the flow is drivable by keyboard alone through
  `SetForegroundWindow` and `SendKeys`;
- `notifyStructuredDataChanged()` debounces five seconds and writes an automatic
  backup, and that envelope is plain JSON. It is therefore the machine-readable
  ledger surface, replacing the unavailable UI-scraping route.

`initializationService.ts:128` creates a real opening transaction for a non-zero
opening balance, so there is a ledger record to assert against and not merely an
account row.

Created `Sandbox Checking`, USD, opening balance `1234.56`. Verified from
`ledger-verification.json`:

| Field | Value |
| --- | --- |
| envelope `app` | `MiroraTrack` |
| `schemaVersion` | 4 |
| accounts | exactly 1, named `Sandbox Checking`, `USD` |
| transactions | 1 |
| opening amount | `123456` minor units |

The envelope itself is copied to evidence as `ledger-backup-*.json` so the
authoritative artifact survives the disposable sandbox.

**Visual confirmation.** `onboarding-dashboard.png` shows `NET WORTH $1,234.56`
immediately after setup. `launch-final-0.1.0.png`, captured after upgrade,
same-version reinstall, uninstall, and reinstall, shows the same
`NET WORTH $1,234.56` and presents the dashboard rather than the onboarding
wizard, which means the reinstalled application reconnected to the preserved
records instead of creating a fresh workspace. `Assert-BackupLedger` is also
re-run at the end of the lifecycle against the same envelope.

This satisfies the derived-balance requirement in
`docs/INSTALLER-VERIFICATION.md` for a single account and its opening
transaction.

## WebView2 accessibility is not reachable

Each session captures the UI Automation tree. The capture succeeds but yields
only three named elements:

```text
Window: MiroraTrack
  Pane: MiroraTrack
    Pane: MiroraTrack - Web content
```

The WebView2 content is a black box to UI Automation, because Chromium builds
its accessibility tree lazily and the usual activation is a browser argument
such as `--force-renderer-accessibility`.

This is the same root cause recorded in `docs/checkpoints/task-14f.md` for the
CDP failure: Wry calls `set_additional_browser_arguments` unconditionally
(`wry-0.55.1/src/webview2/mod.rs:294-327`), so no browser flag reaches WebView2
unless `additionalBrowserArgs` is set in `src-tauri/tauri.conf.json`. Both the
14E CDP path and the 15B ledger-entry path are blocked by this single cause.

## Documentation discrepancy

The installer tables in `README.md` and `docs/INSTALLER-VERIFICATION.md` do not
match the artifacts on disk. The on-disk files match `manifest.json` exactly,
and both documents name `manifest.json` as the authority, so the prose tables
are the error.

| Version | Documented SHA-256 | Actual SHA-256 |
| --- | --- | --- |
| `0.0.9` | `6859D91405163FEA87E9EC73417F48A719A36CA5EF36796226D56F792A9E3D2D` | `113A55C9E7AAB9AA75CF0D70CC1BD0A1B7671C84FC11CA5693AAD4C2133F8627` |
| `0.1.0` | `0C93A2A728A173E32193836E1146391A9EE64C6DD02D5BBFD06D2002CB6EC96E` | `7D170C46751C5BC1D8993E7A2898DFA289ED57752E4DC551D0797870F6C7A05B` |

Documented sizes are also wrong (`214,683,648` and `214,687,058` against actual
`214,689,663` and `214,686,152`). Not corrected here: both are protected files.

## Correction to an earlier assessment

`docs/checkpoints/task-14f.md` states that a debug-only `additionalBrowserArgs`
overlay would unblock both harnesses. That is true for Task 14E only. Task 15B
verifies hash-locked artifacts, so any rebuild produces different installers and
voids the Task 15A evidence. 15B was therefore solved without a product change,
as described above.

## Transaction entry is not implemented

Income and expense entry through the quick-add dialog was attempted across runs
5 to 13 and **does not work**. The dialog opens reliably and Amount and Date are
filled correctly, but no run has saved a transaction: every backup contains only
the single opening-balance record.

Diagnosed and fixed along the way, each from screenshot evidence:

- the dialog's focus trap lands on the transaction type radio group, so the
  form's `autoFocus` on Amount never wins;
- Chromium renders `<input type="date">` as three separately focusable segments,
  so it is not one Tab stop; typing all eight digits fills it deterministically;
- choosing the account re-renders the form and swallows the following Tab, which
  left focus one control short and pressed Cancel instead of Add transaction.

What remains unresolved is the category select and the final submit landing,
under an automation layer that cannot confirm delivery. Transfers were never
attempted: they need two distinct accounts, and only one exists.

**Recommendation.** Do not extend the keyboard approach further. Either accept
the opening-balance ledger evidence as sufficient, or drive the interface
through CDP, which requires `additionalBrowserArgs` and therefore a rebuild —
and a rebuild produces different installers, so it cannot verify the hash-locked
Task 15A artifacts. Those two facts together mean full in-application ledger
verification and artifact-exact installer verification cannot be satisfied by the
same run.

## Remaining for acceptance

- transaction entry beyond the opening balance, per the section above;
- explicit preference persistence checks, for example theme and display
  currency, across the upgrade;
- alternative backup folder selection and manual JSON/CSV export, which exercise
  native file dialogs and need a dialog watcher like the Task 14E harness;
- human review of the captured screenshots before release sign-off; the
  automated visual evidence exists but a person has not yet accepted it;
- correct the two documentation tables;
- ARM64 remains unverified;
- the artifacts are still unsigned, so Windows reputation warnings apply.
