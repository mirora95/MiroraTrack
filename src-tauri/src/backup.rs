use std::{
    cmp::Ordering,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const APP_DIRECTORY: &str = "MiroraTrack";
const BACKUP_DIRECTORY: &str = "Backups";
const AUTOMATIC_PREFIX: &str = "MiroraTrack-Auto-";
const SAFETY_PREFIX: &str = "MiroraTrack-Safety-";
const IMPORT_LIMIT_BYTES: u64 = 100 * 1024 * 1024;
const AUTOMATIC_RETENTION: usize = 10;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupPurpose {
    Automatic,
    Safety,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BackupErrorCode {
    DocumentsUnavailable,
    DirectoryUnavailable,
    PermissionDenied,
    InvalidPath,
    TargetExists,
    FileTooLarge,
    ReadFailed,
    WriteFailed,
    SyncFailed,
    PromotionFailed,
    RetentionWarning,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCommandError {
    code: BackupErrorCode,
    message: &'static str,
}

impl BackupCommandError {
    fn new(code: BackupErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupWarning {
    code: BackupErrorCode,
    message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileResult {
    path: String,
    directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<BackupWarning>,
}

#[derive(Debug, Serialize)]
pub struct ImportedJson {
    content: String,
}

#[tauri::command]
pub async fn choose_backup_directory(app: AppHandle) -> Result<Option<String>, BackupCommandError> {
    let selected = app
        .dialog()
        .file()
        .blocking_pick_folder()
        .map(file_path_into_path)
        .transpose()?;
    selected
        .map(|path| resolve_existing_directory(&path).map(path_to_string))
        .transpose()
}

#[tauri::command]
pub async fn create_backup(
    app: AppHandle,
    payload: String,
    configured_directory: Option<String>,
    purpose: BackupPurpose,
) -> Result<BackupFileResult, BackupCommandError> {
    let directory = resolve_backup_directory(&app, configured_directory.as_deref())?;
    let basename = generated_backup_filename(purpose);
    let final_path = directory.join(basename);
    atomic_create(&final_path, payload.as_bytes())?;

    let warning = if purpose == BackupPurpose::Automatic {
        retain_automatic_backups(&directory)
            .err()
            .map(|_| BackupWarning {
                code: BackupErrorCode::RetentionWarning,
                message: "The backup was saved, but older automatic backups could not be removed",
            })
    } else {
        None
    };

    Ok(file_result(final_path, directory, warning))
}

#[tauri::command]
pub async fn export_json(
    app: AppHandle,
    payload: String,
) -> Result<Option<BackupFileResult>, BackupCommandError> {
    export_with_dialog(
        &app,
        payload.as_bytes(),
        "JSON backup",
        &["json"],
        "MiroraTrack-Export.json",
    )
}

#[tauri::command]
pub async fn export_csv(
    app: AppHandle,
    csv: String,
) -> Result<Option<BackupFileResult>, BackupCommandError> {
    export_with_dialog(
        &app,
        csv.as_bytes(),
        "CSV export",
        &["csv"],
        "MiroraTrack-Transactions.csv",
    )
}

#[tauri::command]
pub async fn import_json(app: AppHandle) -> Result<Option<ImportedJson>, BackupCommandError> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("JSON backup", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file_path_into_path(selected)?;
    validate_import_path(&path)?;
    let metadata = fs::symlink_metadata(&path).map_err(|error| {
        io_error(
            error,
            BackupErrorCode::ReadFailed,
            "The selected backup could not be read",
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The selected backup is not a regular JSON file",
        ));
    }
    if metadata.len() > IMPORT_LIMIT_BYTES {
        return Err(BackupCommandError::new(
            BackupErrorCode::FileTooLarge,
            "The selected file exceeds the 100 MiB limit",
        ));
    }

    let capacity = usize::try_from(metadata.len()).map_err(|_| {
        BackupCommandError::new(
            BackupErrorCode::FileTooLarge,
            "The selected file exceeds the 100 MiB limit",
        )
    })?;
    let file = File::open(&path).map_err(|error| {
        io_error(
            error,
            BackupErrorCode::ReadFailed,
            "The selected backup could not be opened",
        )
    })?;
    let mut content = String::with_capacity(capacity);
    file.take(IMPORT_LIMIT_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| {
            io_error(
                error,
                BackupErrorCode::ReadFailed,
                "The selected backup is not valid UTF-8",
            )
        })?;
    if content.len() as u64 > IMPORT_LIMIT_BYTES {
        return Err(BackupCommandError::new(
            BackupErrorCode::FileTooLarge,
            "The selected file exceeds the 100 MiB limit",
        ));
    }
    Ok(Some(ImportedJson { content }))
}

fn export_with_dialog(
    app: &AppHandle,
    contents: &[u8],
    filter_name: &str,
    extensions: &[&str],
    default_name: &str,
) -> Result<Option<BackupFileResult>, BackupCommandError> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter(filter_name, extensions)
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file_path_into_path(selected)?;
    validate_export_path(&path, extensions)?;
    let file_name = path.file_name().ok_or_else(|| {
        BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The export filename is invalid",
        )
    })?;
    let parent = path.parent().ok_or_else(|| {
        BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The export location is invalid",
        )
    })?;
    let directory = resolve_existing_directory(parent)?;
    let final_path = directory.join(file_name);
    atomic_create(&final_path, contents)?;
    Ok(Some(file_result(final_path, directory, None)))
}

fn resolve_backup_directory(
    app: &AppHandle,
    configured_directory: Option<&str>,
) -> Result<PathBuf, BackupCommandError> {
    match configured_directory {
        Some(configured) => {
            let path = Path::new(configured);
            validate_absolute_path(path)?;
            resolve_existing_directory(path)
        }
        None => {
            let documents = app.path().document_dir().map_err(|_| {
                BackupCommandError::new(
                    BackupErrorCode::DocumentsUnavailable,
                    "The Documents folder is unavailable",
                )
            })?;
            let directory = documents.join(APP_DIRECTORY).join(BACKUP_DIRECTORY);
            fs::create_dir_all(&directory).map_err(|error| {
                io_error(
                    error,
                    BackupErrorCode::DirectoryUnavailable,
                    "The backup folder could not be created",
                )
            })?;
            resolve_existing_directory(&directory)
        }
    }
}

fn resolve_existing_directory(path: &Path) -> Result<PathBuf, BackupCommandError> {
    validate_absolute_path(path)?;
    let metadata = fs::metadata(path).map_err(|error| {
        io_error(
            error,
            BackupErrorCode::DirectoryUnavailable,
            "The selected backup folder is unavailable",
        )
    })?;
    if !metadata.is_dir() {
        return Err(BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The selected backup location is not a directory",
        ));
    }
    fs::canonicalize(path).map_err(|error| {
        io_error(
            error,
            BackupErrorCode::DirectoryUnavailable,
            "The selected backup folder is unavailable",
        )
    })
}

fn validate_absolute_path(path: &Path) -> Result<(), BackupCommandError> {
    if !path.is_absolute()
        || path.as_os_str().to_string_lossy().contains('\0')
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The selected location is invalid",
        ));
    }
    Ok(())
}

fn validate_export_path(path: &Path, extensions: &[&str]) -> Result<(), BackupCommandError> {
    validate_absolute_path(path)?;
    let extension = path.extension().and_then(|value| value.to_str());
    if !extensions
        .iter()
        .any(|allowed| extension.is_some_and(|actual| actual.eq_ignore_ascii_case(allowed)))
    {
        return Err(BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The export filename has an invalid extension",
        ));
    }
    if path.file_name().is_none() {
        return Err(BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The export filename is invalid",
        ));
    }
    Ok(())
}

fn validate_import_path(path: &Path) -> Result<(), BackupCommandError> {
    validate_export_path(path, &["json"])
}

fn generated_backup_filename(purpose: BackupPurpose) -> String {
    let prefix = match purpose {
        BackupPurpose::Automatic => AUTOMATIC_PREFIX,
        BackupPurpose::Safety => SAFETY_PREFIX,
    };
    format!(
        "{}{}-{}.json",
        prefix,
        Utc::now().format("%Y%m%dT%H%M%S%3fZ"),
        Uuid::new_v4().simple()
    )
}

fn atomic_create(final_path: &Path, contents: &[u8]) -> Result<(), BackupCommandError> {
    if final_path.exists() {
        return Err(BackupCommandError::new(
            BackupErrorCode::TargetExists,
            "The destination file already exists",
        ));
    }
    let file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            BackupCommandError::new(
                BackupErrorCode::InvalidPath,
                "The destination filename is invalid",
            )
        })?;
    let partial_path =
        final_path.with_file_name(format!(".{file_name}.{}.partial", Uuid::new_v4().simple()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial_path)
        .map_err(|error| {
            io_error(
                error,
                BackupErrorCode::WriteFailed,
                "The temporary file could not be created",
            )
        })?;

    let operation = (|| {
        file.write_all(contents).map_err(|error| {
            io_error(
                error,
                BackupErrorCode::WriteFailed,
                "The file could not be written",
            )
        })?;
        file.flush().map_err(|error| {
            io_error(
                error,
                BackupErrorCode::WriteFailed,
                "The file could not be flushed",
            )
        })?;
        file.sync_all().map_err(|error| {
            io_error(
                error,
                BackupErrorCode::SyncFailed,
                "The file could not be synchronized",
            )
        })?;
        drop(file);
        if final_path.exists() {
            return Err(BackupCommandError::new(
                BackupErrorCode::TargetExists,
                "The destination file already exists",
            ));
        }
        promote_partial(&partial_path, final_path)
    })();

    if operation.is_err() {
        let _ = fs::remove_file(&partial_path);
    }
    operation
}

fn promote_partial(partial_path: &Path, final_path: &Path) -> Result<(), BackupCommandError> {
    fs::rename(partial_path, final_path).map_err(|error| {
        io_error(
            error,
            BackupErrorCode::PromotionFailed,
            "The completed file could not be promoted",
        )
    })
}

#[derive(Debug, PartialEq, Eq)]
struct AutomaticName {
    timestamp: String,
    nonce: String,
}

impl Ord for AutomaticName {
    fn cmp(&self, other: &Self) -> Ordering {
        self.timestamp
            .cmp(&other.timestamp)
            .then_with(|| self.nonce.cmp(&other.nonce))
    }
}

impl PartialOrd for AutomaticName {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn parse_automatic_filename(name: &str) -> Option<AutomaticName> {
    let body = name.strip_prefix(AUTOMATIC_PREFIX)?.strip_suffix(".json")?;
    let (timestamp, nonce) = body.split_once('-')?;
    if timestamp.len() != 19
        || timestamp.as_bytes().get(8) != Some(&b'T')
        || timestamp.as_bytes().get(18) != Some(&b'Z')
        || !timestamp
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 8 || index == 18 || byte.is_ascii_digit())
        || nonce.len() != 32
        || !nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
        || chrono::NaiveDateTime::parse_from_str(timestamp, "%Y%m%dT%H%M%S%3fZ").is_err()
    {
        return None;
    }
    Some(AutomaticName {
        timestamp: timestamp.to_owned(),
        nonce: nonce.to_ascii_lowercase(),
    })
}

fn retain_automatic_backups(directory: &Path) -> Result<(), BackupCommandError> {
    let mut recognized = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| {
        io_error(
            error,
            BackupErrorCode::DirectoryUnavailable,
            "The backup folder could not be inspected",
        )
    })? {
        let entry = entry.map_err(|_| {
            BackupCommandError::new(
                BackupErrorCode::DirectoryUnavailable,
                "The backup folder could not be inspected",
            )
        })?;
        let file_type = entry.file_type().map_err(|_| {
            BackupCommandError::new(
                BackupErrorCode::DirectoryUnavailable,
                "A backup entry could not be inspected",
            )
        })?;
        if !file_type.is_file() || file_type.is_symlink() || is_reparse_point(&entry)? {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(key) = parse_automatic_filename(&name) {
            recognized.push((key, entry.path()));
        }
    }
    recognized.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in recognized.into_iter().skip(AUTOMATIC_RETENTION) {
        fs::remove_file(path).map_err(|error| {
            io_error(
                error,
                BackupErrorCode::RetentionWarning,
                "An older automatic backup could not be removed",
            )
        })?;
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(entry: &fs::DirEntry) -> Result<bool, BackupCommandError> {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    let metadata = fs::symlink_metadata(entry.path()).map_err(|_| {
        BackupCommandError::new(
            BackupErrorCode::DirectoryUnavailable,
            "A backup entry could not be inspected",
        )
    })?;
    Ok(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}

#[cfg(not(windows))]
fn is_reparse_point(_entry: &fs::DirEntry) -> Result<bool, BackupCommandError> {
    Ok(false)
}

fn file_result(
    path: PathBuf,
    directory: PathBuf,
    warning: Option<BackupWarning>,
) -> BackupFileResult {
    BackupFileResult {
        path: path_to_string(path),
        directory: path_to_string(directory),
        warning,
    }
}

fn file_path_into_path(
    selected: tauri_plugin_dialog::FilePath,
) -> Result<PathBuf, BackupCommandError> {
    selected.into_path().map_err(|_| {
        BackupCommandError::new(
            BackupErrorCode::InvalidPath,
            "The selected location is not a local filesystem path",
        )
    })
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn io_error(
    error: std::io::Error,
    fallback: BackupErrorCode,
    message: &'static str,
) -> BackupCommandError {
    let code = match error.kind() {
        std::io::ErrorKind::PermissionDenied => BackupErrorCode::PermissionDenied,
        std::io::ErrorKind::AlreadyExists => BackupErrorCode::TargetExists,
        _ => fallback,
    };
    BackupCommandError::new(code, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn automatic_name(timestamp: &str, nonce: char) -> String {
        format!(
            "{AUTOMATIC_PREFIX}{timestamp}-{}.json",
            nonce.to_string().repeat(32)
        )
    }

    #[test]
    fn automatic_filename_parser_is_exact_and_anchored() {
        let valid = automatic_name("20260729T083000000Z", 'a');
        assert!(parse_automatic_filename(&valid).is_some());
        assert!(parse_automatic_filename(&format!("{valid}.partial")).is_none());
        assert!(parse_automatic_filename(
            "MiroraTrack-Safety-20260729T083000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"
        )
        .is_none());
        assert!(parse_automatic_filename(
            "prefix-MiroraTrack-Auto-20260729T083000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"
        )
        .is_none());
        assert!(
            parse_automatic_filename("MiroraTrack-Auto-20260729T083000000Z-..\\secret.json")
                .is_none()
        );
    }

    #[test]
    fn retention_keeps_newest_ten_and_ignores_unrelated_entries() {
        let directory = test_directory("retention");
        for day in 1..=12 {
            let name = automatic_name(&format!("202607{day:02}T083000000Z"), 'a');
            fs::write(directory.join(name), b"backup").unwrap();
        }
        fs::write(
            directory.join(
                "MiroraTrack-Safety-20260729T083000000Z-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
            ),
            b"safety",
        )
        .unwrap();
        fs::write(directory.join("notes.json"), b"unrelated").unwrap();

        retain_automatic_backups(&directory).unwrap();

        let mut names = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names
                .iter()
                .filter(|name| parse_automatic_filename(name).is_some())
                .count(),
            10
        );
        assert!(!names.contains(&automatic_name("20260701T083000000Z", 'a')));
        assert!(!names.contains(&automatic_name("20260702T083000000Z", 'a')));
        assert!(names.contains(&"notes.json".to_owned()));
        assert!(names.iter().any(|name| name.starts_with(SAFETY_PREFIX)));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn configured_paths_reject_relative_and_traversal_components() {
        assert!(matches!(
            validate_absolute_path(Path::new("relative\\Backups")),
            Err(BackupCommandError {
                code: BackupErrorCode::InvalidPath,
                ..
            })
        ));
        let traversal = std::env::temp_dir().join("safe").join("..").join("outside");
        assert!(matches!(
            validate_absolute_path(&traversal),
            Err(BackupCommandError {
                code: BackupErrorCode::InvalidPath,
                ..
            })
        ));
    }

    #[test]
    fn collision_preserves_the_existing_final_file() {
        let directory = test_directory("collision");
        let final_path = directory.join("existing.json");
        fs::write(&final_path, b"prior valid backup").unwrap();

        let error = atomic_create(&final_path, b"replacement").unwrap_err();

        assert_eq!(error.code, BackupErrorCode::TargetExists);
        assert_eq!(fs::read(&final_path).unwrap(), b"prior valid backup");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_promotion_does_not_remove_other_valid_backups() {
        let directory = test_directory("promotion");
        let prior = directory.join("prior.json");
        fs::write(&prior, b"prior").unwrap();
        let partial = directory.join(".new.partial");
        fs::write(&partial, b"new").unwrap();
        let invalid_target = directory.join("occupied");
        fs::create_dir(&invalid_target).unwrap();

        assert!(promote_partial(&partial, &invalid_target).is_err());
        assert_eq!(fs::read(&prior).unwrap(), b"prior");
        fs::remove_dir_all(directory).unwrap();
    }

    fn test_directory(label: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("miroratrack-{label}-{}", Uuid::new_v4().simple()));
        fs::create_dir(&directory).unwrap();
        directory
    }
}
