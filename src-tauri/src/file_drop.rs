use std::{collections::HashSet, fs::File, io::Read, path::PathBuf, sync::Mutex};
use tauri::Manager;
const MAX_BYTES: u64 = 25 * 1024 * 1024;
#[derive(Default)]
pub struct DroppedFiles(Mutex<HashSet<PathBuf>>);
pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {paths, ..}) = event {
        if let Ok(mut allowed) = window.state::<DroppedFiles>().0.lock() {
            if allowed.len() + paths.len() > 100 { allowed.clear(); }
            allowed.extend(paths.iter().take(100).cloned());
        }
    }
}
fn read_file(state: &DroppedFiles, path: PathBuf) -> Result<Vec<u8>, String> {
    if !state.0.lock().map_err(|_| "Le dépôt de fichiers est occupé.")?.remove(&path) {
        return Err("Déposez ce fichier dans Notes pour l’envoyer.".into());
    }
    let file = File::open(path).map_err(|_| "Impossible de lire le fichier déposé.".to_string())?;
    let metadata = file.metadata().map_err(|_| "Impossible de lire le fichier déposé.".to_string())?;
    if !metadata.is_file() { return Err("Déposez des fichiers, pas des dossiers.".into()); }
    if metadata.len() > MAX_BYTES { return Err("25 Mio maximum par fichier.".into()); }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| "Lecture du fichier interrompue.".to_string())?;
    if bytes.len() as u64 > MAX_BYTES { return Err("25 Mio maximum par fichier.".into()); }
    Ok(bytes)
}
#[tauri::command]
pub async fn read_dropped_file(app: tauri::AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read_file(&app.state::<DroppedFiles>(), PathBuf::from(path)).map(tauri::ipc::Response::new))
        .await.map_err(|_| "Lecture du fichier interrompue.".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_actual_drops_can_be_read_once_and_large_files_are_rejected() {
        let dir = std::env::temp_dir().join(format!("notes-drop-{}", crate::oauth::test_random_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.txt"); std::fs::write(&path, b"ma note").unwrap();
        let state = DroppedFiles::default();
        assert!(read_file(&state, path.clone()).is_err());
        state.0.lock().unwrap().insert(path.clone());
        assert_eq!(read_file(&state, path.clone()).unwrap(), b"ma note");
        assert!(read_file(&state, path.clone()).is_err());
        File::create(&path).unwrap().set_len(MAX_BYTES + 1).unwrap();
        state.0.lock().unwrap().insert(path.clone());
        assert!(read_file(&state, path).unwrap_err().contains("25 Mio"));
        state.0.lock().unwrap().insert(dir.clone());
        assert!(read_file(&state, dir.clone()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
