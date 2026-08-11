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
| `0.2.0` | `214,723,086` bytes | `77C6CD06459AB222D14E045D175536EE07878E48FD42B4187E43A8C04A58FC4A` |
| `0.3.0` | `214,776,076` bytes | `35FD59ACFB48BC30472DC5B07184B41B392904B7696E83C05128079483334EA8` |

`0.3.0` is the current build and the one to install; `0.2.0` exists only to
exercise the upgrade path, and is the installer built from genuine 0.2.0 source
rather than a relabelled rebuild, so the upgrade step tests a real change of
persisted data format. The superseded `0.0.9`, `0.1.0`, and `0.1.9` directories
are retained for reference but are no longer described by the manifest and must
not be released.

Both are unsigned and remain **UNACCEPTED** under
`work/artifacts/task15/unaccepted/`. For `0.2.0`, independent extraction found
the 209,567,440-byte Microsoft-signed WebView2 offline installer embedded in the
artifact (SHA-256
`7D1ED8BD94B3FDB196FC39FCC02361FF977867B2B376BDD52E9B2A691A153190`).
The `0.3.0` build staged that same verified payload, and its size is consistent
with the payload being embedded, but `0.3.0` has not yet been extracted and
inspected independently; that check is still outstanding.
The machine-readable authority for installer names, roles, versions, sizes,
hashes, architecture, and signature status is
`work/artifacts/task15/unaccepted/manifest.json`.
Task 15B must still prove install, shortcut, persistence, upgrade, reinstall,
uninstall-preservation, and reinstall-after-uninstall behavior in isolation.
