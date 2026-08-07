#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            backup::choose_backup_directory,
            backup::create_backup,
            backup::export_json,
            backup::export_csv,
            backup::import_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod backup;
