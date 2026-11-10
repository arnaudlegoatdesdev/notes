use crate::oauth::NativeToken;
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::Manager;
static SESSION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
pub struct GoogleProfile { pub id: String, pub email: String, pub name: String }
#[derive(Deserialize)]
struct UserInfo { sub: String, email: String, email_verified: bool, name: Option<String> }
#[derive(Serialize, Deserialize)]
struct StoredSession {
    version: u8, user: GoogleProfile, client_id: String,
    access_token: String, refresh_token: Option<String>, scope: Option<String>, expires_at: u64,
}
#[derive(Serialize)]
pub struct CachedSession { user: GoogleProfile, credentials: Option<NativeToken> }
#[derive(Deserialize)]
struct RefreshedToken { access_token: String, expires_in: u64, token_type: String, scope: Option<String>, refresh_token: Option<String> }
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|v| v.as_secs()).unwrap_or(0) }
pub(crate) fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join("google-session.bin")).map_err(|_| "Le stockage de connexion est indisponible.".into())
}
fn valid_user(user: &GoogleProfile) -> bool { !user.id.is_empty() && user.id.len() <= 255 && !user.email.is_empty() && user.email.len() <= 1024 && !user.name.is_empty() && user.name.len() <= 4096 }
pub(crate) fn read_google_user(client: &reqwest::blocking::Client, token: &str) -> Result<GoogleProfile, String> {
    let response = client.get("https://openidconnect.googleapis.com/v1/userinfo").bearer_auth(token).send().map_err(|_| "Google ne répond pas. Vos notes locales restent disponibles.".to_string())?;
    if !response.status().is_success() { return Err("Google n’a pas confirmé l’identité de ce compte.".into()); }
    let profile: UserInfo = response.json().map_err(|_| "L’identité Google est invalide.".to_string())?;
    if !profile.email_verified { return Err("Google n’a pas confirmé l’identité de ce compte.".into()); }
    let user = GoogleProfile { id: profile.sub, name: profile.name.filter(|v| !v.is_empty()).unwrap_or_else(|| profile.email.clone()), email: profile.email };
    if !valid_user(&user) { return Err("L’identité Google est invalide.".into()); }
    Ok(user)
}
fn decode_session(mut plain: Vec<u8>) -> Result<Option<StoredSession>, String> {
    let parsed = serde_json::from_slice::<StoredSession>(&plain); plain.fill(0);
    let value = parsed.map_err(|_| "La connexion enregistrée est invalide.".to_string())?;
    if value.version != 1 || !valid_user(&value.user) || value.client_id.is_empty() || value.client_id.len() > 2048 || value.access_token.len() > 32768 || value.refresh_token.as_ref().is_some_and(|v| v.is_empty() || v.len() > 32768) { return Err("La connexion enregistrée est invalide.".into()); }
    Ok(Some(value))
}
#[cfg(not(target_os = "macos"))]
fn load(path: &Path) -> Result<Option<StoredSession>, String> {
    let metadata = match fs::metadata(path) { Ok(v) => v, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(_) => return Err("Impossible de lire la connexion enregistrée.".into()) };
    if metadata.len() == 0 || metadata.len() > 131072 { return Err("La connexion enregistrée est invalide.".into()); }
    let bytes = fs::read(path).map_err(|_| "Impossible de lire la connexion enregistrée.".to_string())?;
    let mut plain = unprotect(&bytes)?;
    decode_session(plain)
}
#[cfg(target_os = "macos")]
fn load(_: &Path) -> Result<Option<StoredSession>, String> {
    match crate::keychain::read(crate::keychain::SERVICE)? { Some(plain) => decode_session(plain), None => Ok(None) }
}
#[cfg(target_os = "macos")]
fn store(_: &Path, value: &StoredSession) -> Result<(), String> {
    let mut plain = serde_json::to_vec(value).map_err(|_| "Impossible de mémoriser la connexion.".to_string())?;
    let result = crate::keychain::write(crate::keychain::SERVICE, &plain); plain.fill(0); result
}
#[cfg(not(target_os = "macos"))]
fn store(path: &Path, value: &StoredSession) -> Result<(), String> {
    let mut plain = serde_json::to_vec(value).map_err(|_| "Impossible de mémoriser la connexion.".to_string())?;
    let protected = protect(&plain); plain.fill(0); let protected = protected?;
    let parent = path.parent().ok_or("Le stockage de connexion est indisponible.")?;
    fs::create_dir_all(parent).map_err(|_| "Impossible de mémoriser la connexion.".to_string())?;
    let temporary = parent.join(format!("google-session-{}.tmp", now()));
    fs::write(&temporary, protected).map_err(|_| "Impossible de mémoriser la connexion.".to_string())?;
    if fs::rename(&temporary, path).is_err() { let _ = fs::remove_file(temporary); return Err("Impossible de mémoriser la connexion.".into()); }
    Ok(())
}
fn credentials(value: &StoredSession) -> Option<NativeToken> {
    let expires_in = value.expires_at.saturating_sub(now());
    if expires_in <= 60 || expires_in > 86400 || value.access_token.is_empty() { return None; }
    Some(NativeToken { access_token: value.access_token.clone(), expires_in, scope: value.scope.clone(), user: Some(value.user.clone()) })
}
pub(crate) fn save_authorization(path: &Path, user: GoogleProfile, client_id: String, access_token: String, expires_in: u64, scope: Option<String>, refresh_token: Option<String>, expected_subject: Option<&str>) -> Result<(), String> {
    let _guard = SESSION_LOCK.lock().map_err(|_| "La connexion est occupée.".to_string())?;
    if expected_subject.is_some_and(|subject| subject != user.id) { return Err("Choisissez le même compte Google que pour la connexion à Notes.".into()); }
    let previous = load(path).ok().flatten();
    let refresh_token = refresh_token.or_else(|| previous.filter(|v| v.user.id == user.id && v.client_id == client_id).and_then(|v| v.refresh_token));
    store(path, &StoredSession { version: 1, user, client_id, access_token, expires_at: now() + expires_in, scope, refresh_token })
}
#[tauri::command]
pub fn native_cached_session(app: tauri::AppHandle) -> Result<Option<CachedSession>, String> {
    let _guard = SESSION_LOCK.lock().map_err(|_| "La connexion est occupée.".to_string())?;
    Ok(load(&session_path(&app)?)?.map(|value| CachedSession { credentials: credentials(&value), user: value.user }))
}
fn refresh(path: &Path, subject: &str, client_id: &str, client_secret: Option<String>, force: bool) -> Result<Option<NativeToken>, String> {
    let _guard = SESSION_LOCK.lock().map_err(|_| "La connexion est occupée.".to_string())?;
    let Some(mut saved) = load(path)? else { return Ok(None); };
    if saved.user.id != subject || saved.client_id != client_id { return Err("Reconnectez le compte Google d’origine.".into()); }
    if !force { if let Some(token) = credentials(&saved) { return Ok(Some(token)); } }
    let Some(refresh_token) = &saved.refresh_token else { return Ok(None); };
    let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Impossible de préparer la connexion Google.".to_string())?;
    let mut form = vec![("grant_type", "refresh_token".to_string()), ("refresh_token", refresh_token.clone()), ("client_id", client_id.to_string())];
    if let Some(secret) = client_secret.filter(|v| !v.is_empty() && v.len() <= 4096) { form.push(("client_secret", secret)); }
    let response = client.post("https://oauth2.googleapis.com/token").form(&form).send().map_err(|_| "Google ne répond pas. Vos notes locales restent disponibles.".to_string())?;
    if response.status() == reqwest::StatusCode::BAD_REQUEST || response.status() == reqwest::StatusCode::UNAUTHORIZED { return Ok(None); }
    if !response.status().is_success() { return Err("Google est temporairement indisponible.".into()); }
    let token: RefreshedToken = response.json().map_err(|_| "La réponse Google est invalide.".to_string())?;
    if !token.token_type.eq_ignore_ascii_case("bearer") || token.access_token.is_empty() || token.access_token.len() > 32768 || token.expires_in == 0 || token.expires_in > 86400 || token.refresh_token.as_ref().is_some_and(|v| v.is_empty() || v.len() > 32768) { return Err("La réponse Google est invalide.".into()); }
    let user = read_google_user(&client, &token.access_token)?;
    if user.id != saved.user.id { return Err("La connexion Google appartient à un autre compte.".into()); }
    saved.user = user; saved.access_token = token.access_token; saved.expires_at = now() + token.expires_in;
    if token.scope.is_some() { saved.scope = token.scope; }
    if token.refresh_token.is_some() { saved.refresh_token = token.refresh_token; }
    store(path, &saved)?;
    Ok(credentials(&saved))
}
#[tauri::command]
pub async fn native_refresh_google(app: tauri::AppHandle, subject: String, client_id: String, client_secret: Option<String>, force: Option<bool>) -> Result<Option<NativeToken>, String> {
    let path = session_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || refresh(&path, &subject, &client_id, client_secret, force.unwrap_or(false))).await.map_err(|_| "Le renouvellement Google a été interrompu.".to_string())?
}
#[tauri::command]
pub fn native_clear_session(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = SESSION_LOCK.lock().map_err(|_| "La connexion est occupée.".to_string())?;
    #[cfg(target_os = "macos")]
    { let _ = app; return crate::keychain::delete(crate::keychain::SERVICE); }
    #[cfg(not(target_os = "macos"))]
    match fs::remove_file(session_path(&app)?) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(_) => Err("Impossible de fermer la connexion enregistrée.".into()) }
}

#[cfg(windows)]
mod dpapi {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Blob { size: u32, data: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const Blob, description: *const u16, entropy: *const Blob, reserved: *mut c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, description: *mut *mut u16, entropy: *const Blob, reserved: *mut c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { fn LocalFree(memory: *mut c_void) -> *mut c_void; }
    pub(super) fn transform(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
        if bytes.is_empty() || bytes.len() > 131072 { return Err("La connexion enregistrée est invalide.".into()); }
        let input = Blob { size: bytes.len() as u32, data: bytes.as_ptr() as *mut u8 };
        let mut output = Blob { size: 0, data: ptr::null_mut() };
        // DPAPI uses the current Windows user. No machine-wide or plaintext fallback.
        let success = unsafe {
            if encrypt { CryptProtectData(&input, ptr::null(), ptr::null(), ptr::null_mut(), ptr::null(), 1, &mut output) }
            else { CryptUnprotectData(&input, ptr::null_mut(), ptr::null(), ptr::null_mut(), ptr::null(), 1, &mut output) }
        };
        if success == 0 { return Err("Windows n’a pas pu protéger la connexion enregistrée.".into()); }
        let result = unsafe { std::slice::from_raw_parts(output.data, output.size as usize).to_vec() };
        unsafe { if !encrypt { std::slice::from_raw_parts_mut(output.data, output.size as usize).fill(0); } LocalFree(output.data.cast()); }
        Ok(result)
    }
}
#[cfg(windows)]
fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> { dpapi::transform(bytes, true) }
#[cfg(windows)]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> { dpapi::transform(bytes, false) }
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Result<Vec<u8>, String> { Err("Le stockage de connexion natif nécessite Windows.".into()) }
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> { Err("Le stockage de connexion natif nécessite Windows.".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> StoredSession { StoredSession { version: 1, user: GoogleProfile { id: "person-a".into(), email: "a@example.com".into(), name: "Person".into() }, client_id: "client".into(), access_token: "short-lived-token".into(), refresh_token: Some("private-renewal-token".into()), scope: Some("openid".into()), expires_at: now() + 3600 } }
    #[test]
    fn expired_access_token_keeps_the_account_but_is_not_reused() { let mut s = fixture(); assert!(credentials(&s).is_some()); s.expires_at = now().saturating_sub(1); assert!(credentials(&s).is_none()); assert_eq!(s.user.id, "person-a"); }
    #[cfg(windows)]
    #[test]
    fn windows_protects_and_authenticates_persistent_credentials() {
        let plain = b"private-renewal-token";
        let mut protected = protect(plain).unwrap(); assert!(!protected.windows(plain.len()).any(|v| v == plain));
        assert_eq!(unprotect(&protected).unwrap(), plain);
        let last = protected.len() - 1; protected[last] ^= 1; assert!(unprotect(&protected).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn wrong_drive_account_cannot_replace_the_remembered_login() {
        let dir = std::env::temp_dir().join(format!("notes-account-test-{}", crate::oauth::test_random_id())); fs::create_dir_all(&dir).unwrap(); let path = dir.join("session.bin");
        store(&path, &fixture()).unwrap(); let before = fs::read(&path).unwrap();
        let other = GoogleProfile { id: "person-b".into(), email: "b@example.com".into(), name: "Other".into() };
        assert!(save_authorization(&path, other, "client".into(), "new-token".into(), 3600, Some("openid".into()), Some("other-renewal".into()), Some("person-a")).is_err());
        assert_eq!(fs::read(&path).unwrap(), before); assert_eq!(load(&path).unwrap().unwrap().user.id, "person-a"); fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn saved_session_survives_restart_and_refresh_token_never_leaves_native_result() {
        let dir = std::env::temp_dir().join(format!("notes-session-test-{}", crate::oauth::test_random_id())); fs::create_dir_all(&dir).unwrap(); let path = dir.join("session.bin");
        store(&path, &fixture()).unwrap(); store(&path, &fixture()).unwrap();
        let s = load(&path).unwrap().unwrap(); assert_eq!(s.refresh_token.as_deref(), Some("private-renewal-token"));
        let result = serde_json::to_string(&credentials(&s).unwrap()).unwrap(); assert!(!result.contains("private-renewal-token"));
        fs::remove_dir_all(dir).unwrap();
    }
}
