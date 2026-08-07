# MiroraTrack

MiroraTrack is a private, local-first personal finance desktop application for
64-bit Windows 10/11. The installed application opens in its own native Tauri
window and requires no backend, cloud database, browser tab, local web server,
terminal, or Internet connection for normal use.

Structured finance data is stored in IndexedDB, small preferences are stored
in localStorage, and backups are written to `Documents\MiroraTrack\Backups` or
an alternative local folder selected by the user.

## Build and test

Windows prerequisites, verification commands, and x64/ARM64 build guidance are
documented in [docs/BUILDING-WINDOWS.md](docs/BUILDING-WINDOWS.md).

Installer artifacts are quarantined as **UNACCEPTED** until the isolated
lifecycle in [docs/INSTALLER-VERIFICATION.md](docs/INSTALLER-VERIFICATION.md)
passes. Unsigned local builds may display Windows reputation warnings.

Updates and same-version reinstalls are designed to preserve finance records,
preferences, and backups. Uninstall must not remove those files without
separate explicit user confirmation; this behavior requires real-installer
acceptance evidence before release.

## Task 15A installer inputs

Task 15A produced two quarantined x64 NSIS installers. They are build outputs,
not accepted releases:

| Version | Size | SHA-256 |
| --- | ---: | --- |
| `0.0.9` | `214,689,663` bytes | `113A55C9E7AAB9AA75CF0D70CC1BD0A1B7671C84FC11CA5693AAD4C2133F8627` |
| `0.1.0` | `214,686,152` bytes | `7D170C46751C5BC1D8993E7A2898DFA289ED57752E4DC551D0797870F6C7A05B` |

Both are unsigned and remain **UNACCEPTED** under
`work/artifacts/task15/unaccepted/`. Independent extraction found the exact
same 209,567,440-byte Microsoft-signed WebView2 offline installer in each
artifact (SHA-256
`7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`).
The machine-readable authority for installer names, roles, versions, sizes,
hashes, architecture, and signature status is
`work/artifacts/task15/unaccepted/manifest.json`.
Task 15B must still prove install, shortcut, persistence, upgrade, reinstall,
uninstall-preservation, and reinstall-after-uninstall behavior in isolation.
