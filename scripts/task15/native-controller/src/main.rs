use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::{c_void, OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};
use windows_sys::Win32::System::JobObjects::*;
use windows_sys::Win32::System::Threading::*;

const KILL_ON_CLOSE: u32 = 0x0000_2000;
const BREAKAWAY_OK: u32 = 0x0000_0800;
const SILENT_BREAKAWAY_OK: u32 = 0x0000_1000;
const TERMINATION_EXIT: u32 = 0xE000_0015;

#[derive(Default)]
struct Options {
    evidence: PathBuf,
    stdout: PathBuf,
    stderr: PathBuf,
    cwd: PathBuf,
    timeout_ms: u64,
    no_progress_ms: u64,
    cancel_file: Option<PathBuf>,
    environment: Vec<(OsString, OsString)>,
    command: Vec<OsString>,
    test_force_assignment_failure: bool,
    test_crash_after_resume: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "PascalCase")]
struct Accounting {
    total_user_time_100ns: i64,
    total_kernel_time_100ns: i64,
    total_page_fault_count: u32,
    total_processes: u32,
    active_processes: u32,
    total_terminated_processes: u32,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "PascalCase")]
struct CompletionEvent {
    message: u32,
    process_id: usize,
    observed_at_unix_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
struct Evidence {
    schema_version: u32,
    status: String,
    controller_process_id: u32,
    controller_creation_filetime: Option<u64>,
    root_process_id: Option<u32>,
    root_creation_filetime: Option<u64>,
    requested_limit_flags: u32,
    effective_limit_flags: Option<u32>,
    breakaway_flags_absent: bool,
    completion_port_associated: bool,
    process_created_suspended: bool,
    assignment_attempted: bool,
    assignment_succeeded: bool,
    membership_verified: bool,
    resumed: bool,
    root_exit_code: Option<u32>,
    timed_out: bool,
    cancelled: bool,
    termination_reason: Option<String>,
    terminate_job_attempted: bool,
    terminate_job_succeeded: bool,
    final_accounting: Accounting,
    pid_list_queries: Vec<Vec<usize>>,
    final_pid_list_empty: bool,
    completion_events_diagnostic: Vec<CompletionEvent>,
    stdout_path: String,
    stderr_path: String,
    started_at_unix_ms: u128,
    completed_at_unix_ms: Option<u128>,
    errors: Vec<String>,
}

fn unix_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

fn quote_windows_arg(value: &OsStr) -> OsString {
    let text = value.to_string_lossy();
    if !text.is_empty() && !text.chars().any(|c| c == ' ' || c == '\t' || c == '"') {
        return value.to_os_string();
    }
    let mut result = String::from("\"");
    let mut slashes = 0usize;
    for ch in text.chars() {
        if ch == '\\' {
            slashes += 1;
        } else if ch == '"' {
            result.push_str(&"\\".repeat(slashes * 2 + 1));
            result.push('"');
            slashes = 0;
        } else {
            result.push_str(&"\\".repeat(slashes));
            slashes = 0;
            result.push(ch);
        }
    }
    result.push_str(&"\\".repeat(slashes * 2));
    result.push('"');
    OsString::from(result)
}

fn command_line(args: &[OsString]) -> Vec<u16> {
    let mut line = OsString::new();
    for (index, arg) in args.iter().enumerate() {
        if index != 0 { line.push(" "); }
        line.push(quote_windows_arg(arg));
    }
    wide(&line)
}

fn environment_block(overrides: &[(OsString, OsString)]) -> Vec<u16> {
    let mut values = BTreeMap::<String, (OsString, OsString)>::new();
    for (key, value) in std::env::vars_os() {
        values.insert(key.to_string_lossy().to_uppercase(), (key, value));
    }
    for (key, value) in overrides {
        values.insert(key.to_string_lossy().to_uppercase(), (key.clone(), value.clone()));
    }
    let mut block = Vec::new();
    for (_, (key, value)) in values {
        let mut pair = key;
        pair.push("=");
        pair.push(value);
        block.extend(pair.encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

fn parse_options() -> Result<Options, String> {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let mut result = Options { timeout_ms: 3_600_000, ..Default::default() };
    let mut index = 0usize;
    while index < args.len() {
        let flag = args[index].to_string_lossy();
        if flag == "--" {
            result.command = args[index + 1..].to_vec();
            break;
        }
        if flag == "--test-force-assignment-failure" { result.test_force_assignment_failure = true; index += 1; continue; }
        if flag == "--test-crash-after-resume" { result.test_crash_after_resume = true; index += 1; continue; }
        let value = args.get(index + 1).ok_or_else(|| format!("missing value for {flag}"))?.clone();
        match flag.as_ref() {
            "--evidence" => result.evidence = PathBuf::from(value),
            "--stdout" => result.stdout = PathBuf::from(value),
            "--stderr" => result.stderr = PathBuf::from(value),
            "--cwd" => result.cwd = PathBuf::from(value),
            "--timeout-ms" => result.timeout_ms = value.to_string_lossy().parse().map_err(|_| "invalid --timeout-ms")?,
            "--no-progress-ms" => result.no_progress_ms = value.to_string_lossy().parse().map_err(|_| "invalid --no-progress-ms")?,
            "--cancel-file" => result.cancel_file = Some(PathBuf::from(value)),
            "--env" => {
                let text = value.to_string_lossy();
                let (key, val) = text.split_once('=').ok_or("--env requires KEY=VALUE")?;
                if key.is_empty() || key.contains('\0') || val.contains('\0') { return Err("invalid --env value".into()); }
                result.environment.push((OsString::from(key), OsString::from(val)));
            }
            _ => return Err(format!("unknown argument: {flag}")),
        }
        index += 2;
    }
    if result.evidence.as_os_str().is_empty() || result.stdout.as_os_str().is_empty() || result.stderr.as_os_str().is_empty() || result.cwd.as_os_str().is_empty() || result.command.is_empty() {
        return Err("--evidence, --stdout, --stderr, --cwd, and a command after -- are required".into());
    }
    Ok(result)
}

fn filetime_value(value: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

unsafe fn process_creation_filetime(handle: HANDLE) -> Result<u64, String> {
    let (mut creation, mut exit, mut kernel, mut user) = (zeroed(), zeroed(), zeroed(), zeroed());
    if GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) == 0 {
        return Err(format!("GetProcessTimes failed: {}", GetLastError()));
    }
    Ok(filetime_value(creation))
}

unsafe fn query_accounting(job: HANDLE) -> Result<Accounting, String> {
    let mut value: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = zeroed();
    if QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &mut value as *mut _ as *mut c_void, size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32, null_mut()) == 0 {
        return Err(format!("QueryInformationJobObject(accounting) failed: {}", GetLastError()));
    }
    Ok(Accounting {
        total_user_time_100ns: value.TotalUserTime,
        total_kernel_time_100ns: value.TotalKernelTime,
        total_page_fault_count: value.TotalPageFaultCount,
        total_processes: value.TotalProcesses,
        active_processes: value.ActiveProcesses,
        total_terminated_processes: value.TotalTerminatedProcesses,
    })
}

unsafe fn query_pids(job: HANDLE) -> Result<Vec<usize>, String> {
    let capacity = 16_384usize;
    let header = size_of::<JOBOBJECT_BASIC_PROCESS_ID_LIST>() - size_of::<usize>();
    let mut buffer = vec![0u8; header + capacity * size_of::<usize>()];
    if QueryInformationJobObject(job, JobObjectBasicProcessIdList, buffer.as_mut_ptr() as *mut c_void, buffer.len() as u32, null_mut()) == 0 {
        return Err(format!("QueryInformationJobObject(pid list) failed: {}", GetLastError()));
    }
    let list = &*(buffer.as_ptr() as *const JOBOBJECT_BASIC_PROCESS_ID_LIST);
    let count = list.NumberOfProcessIdsInList as usize;
    let first = std::ptr::addr_of!(list.ProcessIdList) as *const usize;
    Ok(std::slice::from_raw_parts(first, count).to_vec())
}

unsafe fn drain_events(port: HANDLE, events: &mut Vec<CompletionEvent>) {
    loop {
        let (mut message, mut key, mut overlapped) = (0u32, 0usize, null_mut());
        if GetQueuedCompletionStatus(port, &mut message, &mut key, &mut overlapped, 0) == 0 { break; }
        events.push(CompletionEvent { message, process_id: overlapped as usize, observed_at_unix_ms: unix_ms() });
    }
}

fn file_lengths(paths: [&Path; 2]) -> u64 {
    paths.iter().filter_map(|p| fs::metadata(p).ok()).map(|m| m.len()).sum()
}

unsafe fn execute(options: &Options, evidence: &mut Evidence) -> i32 {
    let job = CreateJobObjectW(null(), null());
    if job.is_null() { evidence.errors.push(format!("CreateJobObjectW failed: {}", GetLastError())); return 1; }
    let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1);
    let mut process: HANDLE = null_mut();
    let mut thread_handle: HANDLE = null_mut();

    let operation = (|| -> Result<(), String> {
        if port.is_null() { return Err(format!("CreateIoCompletionPort failed: {}", GetLastError())); }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = KILL_ON_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const c_void, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0 {
            return Err(format!("SetInformationJobObject(limits) failed: {}", GetLastError()));
        }
        let mut effective: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        if QueryInformationJobObject(job, JobObjectExtendedLimitInformation, &mut effective as *mut _ as *mut c_void, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32, null_mut()) == 0 {
            return Err(format!("QueryInformationJobObject(limits) failed: {}", GetLastError()));
        }
        evidence.effective_limit_flags = Some(effective.BasicLimitInformation.LimitFlags);
        evidence.breakaway_flags_absent = effective.BasicLimitInformation.LimitFlags & (BREAKAWAY_OK | SILENT_BREAKAWAY_OK) == 0;
        if effective.BasicLimitInformation.LimitFlags & KILL_ON_CLOSE == 0 || !evidence.breakaway_flags_absent {
            return Err(format!("effective job flags violate policy: 0x{:08X}", effective.BasicLimitInformation.LimitFlags));
        }
        let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT { CompletionKey: 1usize as *mut c_void, CompletionPort: port };
        if SetInformationJobObject(job, JobObjectAssociateCompletionPortInformation, &association as *const _ as *const c_void, size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32) == 0 {
            return Err(format!("SetInformationJobObject(completion port) failed: {}", GetLastError()));
        }
        evidence.completion_port_associated = true;

        if let Some(parent) = options.stdout.parent() { fs::create_dir_all(parent).map_err(|e| format!("create stdout directory: {e}"))?; }
        if let Some(parent) = options.stderr.parent() { fs::create_dir_all(parent).map_err(|e| format!("create stderr directory: {e}"))?; }
        let stdout: File = OpenOptions::new().create(true).truncate(true).write(true).open(&options.stdout).map_err(|e| format!("open stdout: {e}"))?;
        let stderr: File = OpenOptions::new().create(true).truncate(true).write(true).open(&options.stderr).map_err(|e| format!("open stderr: {e}"))?;
        let stdout_handle = stdout.as_raw_handle() as HANDLE;
        let stderr_handle = stderr.as_raw_handle() as HANDLE;
        if SetHandleInformation(stdout_handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) == 0 || SetHandleInformation(stderr_handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) == 0 {
            return Err(format!("SetHandleInformation(redirection) failed: {}", GetLastError()));
        }
        let mut startup: STARTUPINFOW = zeroed();
        startup.cb = size_of::<STARTUPINFOW>() as u32;
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = null_mut();
        startup.hStdOutput = stdout_handle;
        startup.hStdError = stderr_handle;
        let mut process_info: PROCESS_INFORMATION = zeroed();
        let mut command = command_line(&options.command);
        let environment = environment_block(&options.environment);
        let cwd = wide(options.cwd.as_os_str());
        if CreateProcessW(null(), command.as_mut_ptr(), null(), null(), 1, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW, environment.as_ptr() as *const c_void, cwd.as_ptr(), &startup, &mut process_info) == 0 {
            return Err(format!("CreateProcessW failed: {}", GetLastError()));
        }
        process = process_info.hProcess;
        thread_handle = process_info.hThread;
        evidence.process_created_suspended = true;
        evidence.root_process_id = Some(process_info.dwProcessId);
        evidence.root_creation_filetime = Some(process_creation_filetime(process)?);
        evidence.assignment_attempted = true;
        if options.test_force_assignment_failure {
            return Err("test-forced assignment failure before AssignProcessToJobObject".into());
        }
        if AssignProcessToJobObject(job, process) == 0 { return Err(format!("AssignProcessToJobObject failed: {}", GetLastError())); }
        evidence.assignment_succeeded = true;
        let mut in_job = 0;
        if IsProcessInJob(process, job, &mut in_job) == 0 { return Err(format!("IsProcessInJob failed: {}", GetLastError())); }
        if in_job == 0 { return Err("IsProcessInJob returned false".into()); }
        evidence.membership_verified = true;
        if ResumeThread(thread_handle) == u32::MAX { return Err(format!("ResumeThread failed: {}", GetLastError())); }
        evidence.resumed = true;
        if options.test_crash_after_resume {
            thread::sleep(Duration::from_millis(500));
            CloseHandle(thread_handle);
            CloseHandle(process);
            std::process::exit(86);
        }

        let started = Instant::now();
        let mut progress_at = Instant::now();
        let mut length = file_lengths([&options.stdout, &options.stderr]);
        loop {
            drain_events(port, &mut evidence.completion_events_diagnostic);
            if WaitForSingleObject(process, 100) == WAIT_OBJECT_0 { break; }
            let new_length = file_lengths([&options.stdout, &options.stderr]);
            if new_length != length { length = new_length; progress_at = Instant::now(); }
            if started.elapsed() >= Duration::from_millis(options.timeout_ms) {
                evidence.timed_out = true;
                evidence.termination_reason = Some(format!("wall-clock timeout after {} ms", options.timeout_ms));
                break;
            }
            if options.no_progress_ms > 0 && progress_at.elapsed() >= Duration::from_millis(options.no_progress_ms) {
                evidence.timed_out = true;
                evidence.termination_reason = Some(format!("no stdout/stderr progress for {} ms", options.no_progress_ms));
                break;
            }
            if options.cancel_file.as_ref().is_some_and(|p| p.exists()) {
                evidence.cancelled = true;
                evidence.termination_reason = Some("cancel file observed".into());
                break;
            }
        }
        if WaitForSingleObject(process, 0) == WAIT_OBJECT_0 {
            let mut code = 0u32;
            if GetExitCodeProcess(process, &mut code) == 0 { return Err(format!("GetExitCodeProcess failed: {}", GetLastError())); }
            evidence.root_exit_code = Some(code);
        }
        Ok(())
    })();

    if let Err(error) = operation { evidence.errors.push(error); }
    evidence.terminate_job_attempted = true;
    evidence.terminate_job_succeeded = TerminateJobObject(job, TERMINATION_EXIT) != 0;
    if !evidence.terminate_job_succeeded { evidence.errors.push(format!("TerminateJobObject failed: {}", GetLastError())); }
    if !process.is_null() {
        if !evidence.assignment_succeeded { TerminateProcess(process, TERMINATION_EXIT); }
        WaitForSingleObject(process, 30_000);
        if evidence.root_exit_code.is_none() {
            let mut code = 0u32;
            if GetExitCodeProcess(process, &mut code) != 0 { evidence.root_exit_code = Some(code); }
        }
    }
    let drain_deadline = Instant::now() + Duration::from_secs(30);
    loop {
        drain_events(port, &mut evidence.completion_events_diagnostic);
        match (query_accounting(job), query_pids(job)) {
            (Ok(accounting), Ok(pids)) => {
                let empty = accounting.active_processes == 0 && pids.is_empty();
                evidence.final_accounting = accounting;
                evidence.pid_list_queries.push(pids);
                if empty { evidence.final_pid_list_empty = true; break; }
            }
            (Err(e), _) | (_, Err(e)) => { evidence.errors.push(e); break; }
        }
        if Instant::now() >= drain_deadline { evidence.errors.push("job did not drain to zero within 30 seconds".into()); break; }
        thread::sleep(Duration::from_millis(25));
    }
    drain_events(port, &mut evidence.completion_events_diagnostic);
    if !thread_handle.is_null() { CloseHandle(thread_handle); }
    if !process.is_null() { CloseHandle(process); }
    if !port.is_null() { CloseHandle(port); }
    CloseHandle(job);
    if evidence.errors.is_empty() && evidence.final_pid_list_empty && !evidence.timed_out && !evidence.cancelled && evidence.root_exit_code == Some(0) {
        evidence.status = "PASS".into();
        0
    } else { 1 }
}

fn write_evidence(path: &Path, evidence: &Evidence) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(evidence).map_err(|e| e.to_string())?;
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

fn main() {
    let options = match parse_options() { Ok(value) => value, Err(error) => { eprintln!("{error}"); std::process::exit(2); } };
    let mut evidence = Evidence {
        schema_version: 1,
        status: "FAIL".into(),
        controller_process_id: std::process::id(),
        controller_creation_filetime: unsafe { process_creation_filetime(GetCurrentProcess()).ok() },
        root_process_id: None,
        root_creation_filetime: None,
        requested_limit_flags: KILL_ON_CLOSE,
        effective_limit_flags: None,
        breakaway_flags_absent: false,
        completion_port_associated: false,
        process_created_suspended: false,
        assignment_attempted: false,
        assignment_succeeded: false,
        membership_verified: false,
        resumed: false,
        root_exit_code: None,
        timed_out: false,
        cancelled: false,
        termination_reason: None,
        terminate_job_attempted: false,
        terminate_job_succeeded: false,
        final_accounting: Accounting::default(),
        pid_list_queries: Vec::new(),
        final_pid_list_empty: false,
        completion_events_diagnostic: Vec::new(),
        stdout_path: options.stdout.to_string_lossy().into_owned(),
        stderr_path: options.stderr.to_string_lossy().into_owned(),
        started_at_unix_ms: unix_ms(),
        completed_at_unix_ms: None,
        errors: Vec::new(),
    };
    let exit_code = unsafe { execute(&options, &mut evidence) };
    evidence.completed_at_unix_ms = Some(unix_ms());
    if let Err(error) = write_evidence(&options.evidence, &evidence) {
        eprintln!("failed to write controller evidence: {error}");
        std::process::exit(3);
    }
    std::process::exit(exit_code);
}
