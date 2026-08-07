# Task 15 native Job Object controller architecture

## Decision

Every Task 15 Gate and Build step runs through a small precompiled x64 Windows controller that remains outside the Job Object it owns. The controller creates a new unnamed empty job, enables `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` with neither breakaway flag, reads the effective limit flags back, associates an I/O completion port, and only then creates the step root with `CreateProcessW(CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT)`.

The suspended root is assigned to the job and independently verified with `IsProcessInJob` before `ResumeThread`. Any create, assignment, membership, or resume failure is fail-before-resume: the job is terminated, an unassigned suspended root is terminated directly, and no workload instruction is allowed to run. This is covered by a sentinel test.

On normal exit, error, cancellation, and timeout, the controller calls `TerminateJobObject`. It then queries `JobObjectBasicAccountingInformation` and `JobObjectBasicProcessIdList` until both report no active process/PID, records the final accounting and diagnostics, and closes the job last. `JOB_OBJECT_MSG_*` completion-port messages are recorded as useful diagnostics but are not the containment authority and missing messages do not fail an otherwise conclusive accounting result.

## Evidence and acceptance boundary

Each step writes one controller JSON evidence file containing controller and root identities (PID plus creation filetime), requested and effective limit flags, assignment/membership/resume state, stdout/stderr paths, root exit/timeout state, completion events, job accounting totals and active count, queried PID lists, termination state, errors, timestamps, and controller binary/source/toolchain identity. Phase manifests bind the exact expected step names to hashes of these files.

The pass criterion is kernel Job Object membership plus an empty final job. It does not depend on per-child handles, process names, ancestry sampling, WMI snapshots, PID ledgers, or child `ExitTime`. The controller never kills any PID learned from a ledger, diagnostic event, name, or ancestry query. Existing lineage modules and evidence are retained only as historical incident material.

Processes deliberately launched through a broker or WMI outside the job are outside this guarantee and are never killed by Task 15. ETW, if collected separately, is diagnostic only. Ordinary descendants cannot request breakaway because neither `JOB_OBJECT_LIMIT_BREAKAWAY_OK` nor `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` is enabled. Invalid/incompatible nested-job assignment fails before resume.

## Incident and bootstrap scope

The retired PowerShell wrapper compiled its Job Object interop through `Add-Type` before `CreateJobObject`/assignment, so `csc.exe` could escape before containment existed. It also launched the root with `Start-Process`, which provided no suspended assign-before-run boundary, and it did not read limits back, verify membership, or prove final job accounting was empty. The historical `vctip.exe` escape cannot be repaired from the old lineage evidence.

The controller source is repository-backed under `scripts/task15/native-controller/`. Its first release build is a bootstrap action outside the claimed contained Gate/Build steps and is written only under ignored `work/toolchain/`. Bootstrap evidence records the source hash, Cargo lock hash, Rust/Cargo versions, target architecture, binary PE architecture, and binary SHA-256. After that binary exists and validates, every Gate/Build step must execute through it. The controller build is never listed as a contained Task 15 step.

