mod links;
mod oauth;
mod session;
#[cfg(target_os = "macos")]
mod keychain;

#[tauri::command]
fn updater_enabled() -> bool {
    option_env!("FLION_UPDATER_PUBLIC_KEY").is_some_and(|key| !key.trim().is_empty())
}

pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_process::init());
    if let Some(key) = option_env!("FLION_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty()) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key.trim()).build());
    }
    builder
        .invoke_handler(tauri::generate_handler![links::open_external, links::fetch_link_resource, oauth::native_authorize, session::native_cached_session, session::native_refresh_google, session::native_clear_session, updater_enabled])
        .run(tauri::generate_context!())
        .expect("Impossible de démarrer Notes");
}
