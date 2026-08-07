# Task 15B manual confirmation

This is the human confirmation that `docs/INSTALLER-VERIFICATION.md` requires
before the Task 15A installers can be accepted. It covers what the automated
harness cannot: transaction entry through the quick-add dialog, transfer
semantics, preference persistence, and native file dialogs.

Automated evidence already exists for the installer lifecycle and byte-level
data preservation; see `docs/checkpoints/task-15b.md`. Do not repeat that work
by hand. This document is only for the parts a person must judge.

## Before you start

Run the manual harness from the repository root on a machine with Windows
Sandbox enabled:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/task15b/Invoke-Task15BManual.ps1
```

It verifies both installers against
`work/artifacts/task15/unaccepted/manifest.json`, starts an isolated offline
sandbox, installs `0.0.9`, checks the shortcuts, and then **leaves the sandbox
running and hands control to you**. It does not shut the environment down.

Inside the sandbox you will find on the Desktop:

- `CHECKLIST.txt` — the steps below, so you do not need the host
- `Install-Current.cmd` — installs `0.1.0` over the top, for the upgrade step
- `Uninstall.cmd` — runs the uninstaller silently
- `Show-Data.cmd` — prints the finance data and backup folders with file counts

Everything you save to `C:\MTEvidence` is written back to the host run folder and
survives the sandbox. Screenshots belong there.

**Never run this on your own Windows profile.** The harness refuses to start
outside Windows Sandbox, and the manual steps install, upgrade, and uninstall a
real application.

## The test ledger

Enter exactly these values. The expected results below depend on them.

| Item | Value |
| --- | --- |
| Base currency | `USD` |
| Date format | `MM/DD/YYYY` |
| First account | `Manual Checking`, Checking, USD, opening balance `1234.56` |
| Second account | `Manual Savings`, Savings, USD, opening balance `0` |
| Expense | `50.25`, category `Food`, account `Manual Checking`, today, Completed |
| Income | `300.00`, category `Salary`, account `Manual Checking`, today, Completed |
| Transfer | `100.00`, from `Manual Checking` to `Manual Savings`, today, Completed |

## Expected results

Work these out once and check them at every later stage.

| Figure | Expected | Why |
| --- | ---: | --- |
| `Manual Checking` balance | `$1,384.31` | 1234.56 − 50.25 + 300.00 − 100.00 |
| `Manual Savings` balance | `$100.00` | transfer in |
| Net worth | `$1,484.31` | 1234.56 − 50.25 + 300.00 |
| Income, this month | `$300.00` | transfers are not income |
| Expenses, this month | `$50.25` | transfers are not expenses |

The critical check is that **the transfer moves money between accounts without
changing net worth, income, or expenses**. If net worth reads `$1,384.31` or
income reads `$400.00`, transfer handling is wrong. This is the single most
valuable thing in this document, because no automated evidence covers it.

## Steps

Record each row in the results table. A screenshot for any row you mark FAIL is
required; screenshots for PASS rows are welcome.

1. **Onboarding.** Launch from the Desktop shortcut. Complete the wizard with
   the base currency, date format, and first account above. Confirm no demo data
   appears and the dashboard shows net worth `$1,234.56`.
2. **Second account.** Accounts, then add `Manual Savings` as above.
3. **Expense.** Quick add transaction, Expense, values above. Confirm the
   Transactions list shows it and the amount is styled as an expense.
4. **Income.** Quick add transaction, Income, values above.
5. **Transfer.** Quick add transaction, Transfer, values above. Confirm the form
   refuses the same account for both sides.
6. **Derived figures.** On the Dashboard, check all five figures in the expected
   results table.
7. **Budget.** Create a monthly `Food` budget of `100.00`. Confirm usage reads
   `50.25` and the transfer is excluded.
8. **Preferences.** Set the theme to Dark and the display currency to `UZS`,
   then back to `USD`. Confirm the theme persists after closing and reopening
   from the Start menu.
9. **Backups and dialogs.** Settings, then confirm a successful automatic backup
   time and folder. Use Choose folder and pick `C:\MTEvidence\AltBackups`, then
   Export JSON and Export CSV into `C:\MTEvidence`. Confirm the native dialogs
   open and the files appear.
10. **Restore safety.** Start a restore with the exported JSON. Confirm it
    previews collection counts and refuses to proceed until you type
    `REPLACE MY DATA` exactly. You may cancel instead of completing it.
11. **Reopen.** Close the application and reopen from the Start menu. Confirm all
    five derived figures are unchanged.
12. **Upgrade.** Close the application, run `Install-Current.cmd`, reopen.
    Confirm the version is `0.1.0` in Settings and all five figures, the theme,
    and the backup folder are unchanged.
13. **Uninstall preservation.** Close the application, run `Show-Data.cmd` and
    note the file counts, then run `Uninstall.cmd`, then run `Show-Data.cmd`
    again. Confirm the finance data folder and `Documents\MiroraTrack\Backups`
    still exist with the same counts.
14. **Reinstall.** Run `Install-Current.cmd` again and reopen. Confirm the ledger
    reconnects, the onboarding wizard does **not** reappear, and all five
    derived figures are unchanged.

## Results

Fill this in, save it to `C:\MTEvidence\manual-results.md`, and record who ran
it and when.

```text
Verifier:
Date:
Installer manifest SHA-256 confirmed by the harness: yes / no

 1 Onboarding and first account ............ PASS / FAIL
 2 Second account .......................... PASS / FAIL
 3 Expense ................................. PASS / FAIL
 4 Income .................................. PASS / FAIL
 5 Transfer, distinct accounts enforced .... PASS / FAIL
 6 Five derived figures .................... PASS / FAIL
 7 Budget excludes transfers ............... PASS / FAIL
 8 Preferences persist ..................... PASS / FAIL
 9 Backup status, folder picker, exports ... PASS / FAIL
10 Restore requires REPLACE MY DATA ........ PASS / FAIL
11 Reopen unchanged ........................ PASS / FAIL
12 Upgrade to 0.1.0 preserves everything ... PASS / FAIL
13 Uninstall preserves data and backups .... PASS / FAIL
14 Reinstall reconnects the ledger ......... PASS / FAIL

Notes:
```

## After you finish

Close the sandbox window to discard the environment. The host keeps everything
under the run's `evidence` folder. Then update
`docs/checkpoints/task-15b.md` with the outcome and, if every row passed, record
the acceptance decision there. Acceptance also still requires a decision on code
signing, which changes the installer hashes and invalidates this evidence.
