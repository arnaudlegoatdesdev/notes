use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct PendingWork(pub AtomicBool);

#[tauri::command]
pub fn set_pending_work(pending: bool, state: tauri::State<'_, PendingWork>) {
    state.0.store(pending, Ordering::Release);
}
#[tauri::command]
pub fn finish_background_exit(app: tauri::AppHandle, state: tauri::State<'_, PendingWork>) {
    state.0.store(false, Ordering::Release);
    app.exit(0);
}
fn should_defer_exit(pending: bool, code: Option<i32>, has_window: bool) -> bool {
    pending && code != Some(tauri::RESTART_EXIT_CODE) && has_window
}
// AppKit's predefined Quit item calls terminate: directly and bypasses Tauri's
// cancellable exit event. Route the menu and Cmd+Q through graceful window close.
#[cfg(target_os = "macos")]
pub fn mac_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let menu = Menu::default(app)?;
    menu.remove_at(0)?;
    let application = Submenu::with_items(app, "Notes", true, &[
        &PredefinedMenuItem::about(app, Some("À propos de Notes"), Some(AboutMetadata {
            name: Some("Notes".into()), version: Some(app.package_info().version.to_string()), ..Default::default()
        }))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::services(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, Some("Masquer Notes"))?,
        &PredefinedMenuItem::hide_others(app, Some("Masquer les autres"))?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "notes-quit", "Quitter Notes", true, Some("CmdOrCtrl+Q"))?,
    ])?;
    menu.insert(&application, 0)?;
    Ok(menu)
}
#[cfg(target_os = "macos")]
pub fn menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if event.id().as_ref() == "notes-quit" {
        if let Some(window) = app.get_webview_window("main") { let _ = window.close(); }
        else { app.exit(0); }
    }
}
pub fn handle_exit(app: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested {api, code, ..} = event {
        let pending = app.state::<PendingWork>().0.load(Ordering::Acquire);
        let window = app.get_webview_window("main");
        if should_defer_exit(pending, code, window.is_some()) {
            api.prevent_exit();
            if let Some(window) = window { let _ = window.emit("notes-quit-requested", ()); }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_quits_are_deferred_but_restart_clean_exit_and_windowless_exit_are_allowed() {
        assert!(should_defer_exit(true, None, true));
        assert!(!should_defer_exit(false, None, true));
        assert!(should_defer_exit(true, Some(0), true));
        assert!(!should_defer_exit(false, Some(0), true));
        assert!(!should_defer_exit(true, Some(tauri::RESTART_EXIT_CODE), true));
        assert!(!should_defer_exit(true, None, false));
    }
}
