mod lifecycle;
mod file_drop;
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
    #[cfg(target_os = "macos")]
    { builder = builder.menu(lifecycle::mac_menu).on_menu_event(lifecycle::menu_event); }
    if let Some(key) = option_env!("FLION_UPDATER_PUBLIC_KEY").filter(|key| !key.trim().is_empty()) {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().pubkey(key.trim()).build());
    }
    builder
        .manage(lifecycle::PendingWork::default())
        .manage(file_drop::DroppedFiles::default())
        .on_window_event(file_drop::window_event)
        .invoke_handler(tauri::generate_handler![file_drop::read_dropped_file, session::native_google_profile, lifecycle::set_pending_work, lifecycle::finish_background_exit, links::open_external, links::fetch_link_resource, oauth::native_authorize, session::native_cached_session, session::native_refresh_google, session::native_clear_session, updater_enabled])
        .build(tauri::generate_context!())
        .expect("Impossible de démarrer Notes")
        .run(lifecycle::handle_exit);
}
