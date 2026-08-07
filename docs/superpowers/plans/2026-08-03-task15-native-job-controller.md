# Task 15 Native Job Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:systematic-debugging while executing each task. No Git operation is permitted for this recovery task.

**Goal:** Replace Task 15's sampling/PID-ledger cleanup criterion with a precompiled Windows Job Object controller that proves assign-before-run containment and final kernel emptiness.

**Architecture:** A standalone Rust executable owns an unnamed kill-on-close job, starts each root suspended with redirected handles and a Unicode environment, assigns/verifies/resumes it, then terminates and drains the job on every outcome. PowerShell validates the source/toolchain/binary identity, invokes the controller for every phase step, and phase/final audits bind exact evidence hashes.

**Tech Stack:** Rust 2021, `windows-sys`, `serde`, `serde_json`, PowerShell 5.1, Windows Job Objects.

---

### Task 1: Controller contract and bootstrap validation

**Files:** create `scripts/task15/Test-Task15JobController.ps1`; create `scripts/task15/Task15JobController.psm1`; create `scripts/task15/native-controller/Cargo.toml`, `Cargo.lock`, and `src/main.rs`.

- [ ] Add a static/bootstrap test requiring source-backed locked Rust inputs, ignored `work/toolchain` output, x64 PE validation, and source/toolchain/binary hashes.
- [ ] Run it and retain the expected failure because the module/project is absent.
- [ ] Implement the locked project and bootstrap validator, build once outside containment, then rerun the test.

### Task 2: Assign-before-resume and cleanup behavior

**Files:** modify `scripts/task15/Test-Task15JobController.ps1`; modify `scripts/task15/native-controller/src/main.rs`.

- [ ] Add behavioral tests for assignment-failure sentinel, Unicode environment/output, root exit capture, timeout/error cleanup, many short-lived children, late long-lived descendants, same-name preexisting survival, PID churn, denied breakaway, and abrupt controller close.
- [ ] Run each test to observe the contract fail before implementation.
- [ ] Implement native create/configure/readback/port/create-suspended/assign/membership/resume/terminate/query/close logic and JSON evidence.
- [ ] Rerun until all supported host tests pass; emit explicit environment-limited records for genuinely unsupported nested-job/negative-control cases.

### Task 3: Task 15 phase integration

**Files:** modify `scripts/Build-Task15Installers.ps1`; replace acceptance logic in `scripts/task15/Task15LineageManifest.psm1`; modify `scripts/task15/Test-Task15BuildIntegration.ps1`.

- [ ] Change static integration assertions first so they reject `Start-Process`, `Add-Type`, PID-tree termination, and active lineage tracking.
- [ ] Run the integration test and retain the expected failure.
- [ ] Route `Invoke-Task15Step` through the validated controller and publish exact controller-evidence manifests.
- [ ] Rerun controller and integration tests.

### Task 4: Final audit and documentation

**Files:** modify `scripts/task15/Invoke-Task15FinalIntegrityAudit.ps1`, `docs/BUILDING-WINDOWS.md`, `docs/INSTALLER-VERIFICATION.md`, and `docs/checkpoints/task-15a.md`.

- [ ] Add failing audit/static assertions for exact phase evidence, effective flags, verified membership, termination, and empty final accounting.
- [ ] Replace lineage-ledger acceptance with controller evidence and document the incident, scoped guarantee, and honest bootstrap boundary.
- [ ] Run all Task 15 suites and PowerShell parser checks.
- [ ] Run exactly one `-Phase Gate` through the validated controller, preserve UNACCEPTED artifacts, and stop before Build.

