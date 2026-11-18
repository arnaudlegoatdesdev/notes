use std::{io::Write, path::Path};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, WebviewWindow,
};
use tauri_plugin_dialog::DialogExt;

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    window: WebviewWindow,
    request: Request<'_>,
) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Le fichier à enregistrer est invalide.".into());
    };
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("25 Mio maximum par fichier.".into());
    }
    let name = request
        .headers()
        .get("x-notes-filename")
        .and_then(|header| header.to_str().ok())
        .and_then(|encoded| {
            url::form_urlencoded::parse(format!("name={encoded}").as_bytes())
                .next()
                .map(|(_, name)| name.into_owned())
        })
        .filter(|name| {
            !name.trim().is_empty()
                && name != "."
                && name != ".."
                && !name.contains(['/', '\\', ':'])
                && !name.chars().any(char::is_control)
        })
        .unwrap_or_else(|| "Fichier".into());

    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Enregistrer le fichier")
            .set_file_name(name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path
            .into_path()
            .map_err(|_| "L’emplacement sélectionné est invalide.")?;
        write_attachment(&path, &bytes)
            .map_err(|_| "Impossible d’enregistrer le fichier à cet emplacement.")?;
        Ok(true)
    })
    .await
    .map_err(|_| "L’enregistrement du fichier a été interrompu.".to_string())?
}

fn write_attachment(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let directory = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.persist(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_attachment_bytes_and_replaces_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("photo.png");
        write_attachment(&path, &[1, 2, 3]).unwrap();
        write_attachment(&path, &[0, 4]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), [0, 4]);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
