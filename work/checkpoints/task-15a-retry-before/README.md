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

