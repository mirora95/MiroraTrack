# Task 15C — rebuilding the installer pair as 0.1.9 and 0.2.0

## Status

**Installers built on 2026-08-10.** They are build outputs and remain
**UNACCEPTED** until the Task 15B lifecycle harness passes against them.

| Role | Version | Size | SHA-256 | Signature |
| --- | --- | ---: | --- | --- |
| Previous | `0.1.9` | `214,722,224` | `739E63252FF59DF1F2CC0A7893AFA29B8A5C9246CF8E6E05AEDA7840EB41ED1F` | `NotSigned` |
| Current | `0.2.0` | `214,723,086` | `77C6CD06459AB222D14E045D175536EE07878E48FD42B4187E43A8C04A58FC4A` | `NotSigned` |

On-disk sizes and hashes were verified independently of the build and match
`manifest.json` exactly.

## Why a rebuild, and why a new version

The shipped `0.1.0` predates Tajikistani somoni support and the Vitest timeout
fix. Rebuilding under the same version would have produced two different
artifacts both calling themselves `0.1.0`, quietly invalidating the hashes
recorded in `README.md`, `INSTALLER-VERIFICATION.md` and `manifest.json`.

Adding a currency is a feature, so the application moved to `0.2.0`. The pair
follows the existing `0.0.9` to `0.1.0` convention and became `0.1.9` to
`0.2.0`; the lower version exists only to exercise the upgrade path and never
collides with a previously published hash.

Version consistency spans `package.json`, `package-lock.json`,
`tauri.conf.json`, `Cargo.toml` and `Cargo.lock`. `Cargo.lock` matters because
the build runs `--locked`. The existing `packagingConfig.test.ts` guard is what
caught `package-lock.json` being missed.

## The Task 15 orchestrator cannot run

`scripts/Build-Task15Installers.ps1` has been non-functional since Task 15A. An
unfinished `ControllerPhase` to `LineagePhase` rename left four independent
breaks, and the lineage gate contained two more defects:

| # | Break | Fixed in |
| --- | --- | --- |
| 1 | twelve call sites passed `-LineagePhase` to functions declaring `$ControllerPhase` | `a38433d` |
| 2 | `Complete-Task15PhaseLineageManifest` called but never defined | `a38433d` |
| 3 | `Task15ProcessLineage.psm1` never imported | `a38433d` |
| 4 | `[Task15ExitApi]` used but never defined in the controller | committed separately |
| 5 | short-lived Playwright children counted as exit-time assurance failures | `8cf46a3` |
| 6 | those same records then failed a second completion check for having no timestamp | committed separately |
| 7 | `$jobController` assigned and never used, so `.controller.json` evidence is verified but never produced | **not fixed** |

Break 1 also disabled the error handler, because the `catch` block called the
same broken function and destroyed the diagnostic for whatever had failed.

Breaks 1 to 6 are repaired and committed. Break 7 is a design question rather
than a typo: the step runner was migrated to an in-process Job Object while the
controller-manifest verification that consumes the native controller's evidence
was left in place. Repairing it means reconstructing the intended contract and
belongs with whoever owns that refactor.

**Consequence worth stating plainly:** the previously accepted `0.0.9` and
`0.1.0` artifacts came from a build path that no longer runs as committed.

## The minimal build path

`scripts/Build-InstallerPair.ps1` does only the work that yields artifacts: the
Vite build, a loopback mirror serving the two pinned NSIS bundler assets from
local disk, staging of the hash and Authenticode verified WebView2 offline
installer, one release NSIS build per version through the MSVC toolchain
wrapper, and an atomic manifest write after both versions succeed.

It reuses `TauriBundlerMirror.psm1` and `WebViewAcquisition.psm1` unchanged, so
asset pinning, hash verification, signature checking and the build-root
containment guard on staging all still apply. The build reaches no external
host: the pinned assets and the WebView2 runtime are already on disk, and
`LocalPath` is derived and hash-checked rather than re-fetched from the GitHub
release API.

**What it gives up:** process-lineage tracking and controller-manifest evidence.
That is a real reduction in build-time assurance. It is acceptable here only
because Task 15B is the acceptance gate, it verifies whatever `manifest.json`
describes by hash, and it works.

Four defects were found in this new script while bringing it up, all mine:

- `Start-Process -PassThru` can release the kernel object once the child exits,
  leaving `ExitCode` null. The Vite build succeeded in 374 ms and produced a
  complete `dist/`, yet the run reported failure because null compares unequal
  to zero. Now read through `GetExitCodeProcess` and widened to `Int64`.
- The mirror validates `specification.LocalPath` before listening, so
  specifications straight from `Get-TauriBundlerToolSpecifications` made it exit
  immediately and the build waited thirty seconds for a dead process.
- The failure message ran `-f` over text containing captured stderr. Build
  output with braces made the format operator throw, destroying the diagnostic
  for the real error, which is the same defect as break 1 above.
- The native build was not routed through
  `work/toolchain/Invoke-Task13bNative.ps1`, so a Unix-style `link` earlier in
  `PATH` shadowed MSVC's `link.exe` and every Rust build script failed with
  `link: extra operand`.

## Superseded artifacts

`work/artifacts/task15/unaccepted/0.0.9/` and `0.1.0/` remain on disk but are no
longer described by `manifest.json`. The Task 15B harness stages only what the
manifest lists, so it will not accept them, and their Task 15B evidence does not
transfer to the new pair. They are retained rather than deleted so the earlier
verification record stays auditable.

## Not yet done

- Task 15B has not been run against `0.1.9` and `0.2.0`; nothing about this pair
  is verified beyond its hashes;
- the manual confirmation in `docs/MANUAL-VERIFICATION.md` refers to the new
  pair once the harness passes;
- the artifacts are unsigned, so signing would change these hashes again and
  invalidate whatever verification follows;
- orchestrator break 7 remains open.
