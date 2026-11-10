mod oauth;

#[tauri::command]
fn updater_enabled() -> bool {
    option_env!("FLION_UPDATER_PUBLIC_KEY").is_some_and(|key| !key.trim().is_empty())
}

pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_process::init());
    if let Some(key) = option_env!("FLION_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty()) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key).build());
    }
    builder
        .invoke_handler(tauri::generate_handler![oauth::native_authorize, updater_enabled])
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Flion");
}
