use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToken {
    pub access_token: String,
    pub expires_in: u64,
    pub scope: Option<String>,
    pub user: Option<crate::session::GoogleProfile>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    token_type: String,
    scope: Option<String>,
    refresh_token: Option<String>,
}

struct Provider {
    authorize: &'static str,
    token: &'static str,
    scope: &'static str,
    loopback_host: &'static str,
}

fn provider_config(provider: &str) -> Result<Provider, String> {
    match provider {
        "google" => Ok(Provider {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            scope: "https://www.googleapis.com/auth/drive.appdata",
            loopback_host: "127.0.0.1",
        }),
        "onedrive" => Ok(Provider {
            authorize: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
            token: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
            scope: "https://graph.microsoft.com/Files.ReadWrite.AppFolder https://graph.microsoft.com/User.Read",
            loopback_host: "localhost",
        }),
        _ => Err("Ce fournisseur de cloud n’est pas pris en charge.".into()),
    }
}

fn google_scope(purpose: &str) -> Result<&'static str, String> {
    match purpose {
        "login" => Ok("openid email profile"),
        "drive" => Ok("openid email profile https://www.googleapis.com/auth/drive.appdata"),
        _ => Err("Type de connexion inconnu.".into()),
    }
}

fn random_secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[derive(Debug, PartialEq)]
enum Callback {
    Ignore,
    Code(String),
    Denied,
}

fn parse_callback(target: &str, expected_state: &str) -> Callback {
    if !target.starts_with('/') || target.starts_with("//") || target.contains('#') {
        return Callback::Ignore;
    }
    let Ok(url) = Url::parse(&format!("http://localhost{target}")) else {
        return Callback::Ignore;
    };
    if url.path() != "/callback" {
        return Callback::Ignore;
    }
    let pairs: Vec<_> = url.query_pairs().collect();
    let values = |key: &str| -> Vec<&str> {
        pairs.iter().filter(|(name, _)| name == key).map(|(_, value)| value.as_ref()).collect()
    };
    let states = values("state");
    if states.len() != 1 || !bool::from(states[0].as_bytes().ct_eq(expected_state.as_bytes())) {
        return Callback::Ignore;
    }
    let errors = values("error");
    let codes = values("code");
    if !errors.is_empty() || codes.len() != 1 || codes[0].is_empty() || codes[0].len() > 4096 {
        return Callback::Denied;
    }
    Callback::Code(codes[0].to_string())
}

fn reply(stream: &mut TcpStream, accepted: bool) {
    let (status, text) = if accepted {
        ("200 OK", "Retournez dans Notes pour terminer la connexion. Vous pouvez fermer cet onglet.")
    } else {
        ("400 Bad Request", "Cette réponse de connexion n’est pas valide. Retournez dans Notes.")
    };
    // Never reflect OAuth query parameters or tokens into the browser response.
    let body = format!("<!doctype html><html lang=\"fr\"><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Notes</title><h1>Notes</h1><p>{text}</p></html>");
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
}

fn wait_for_callback(listener: TcpListener, state: &str) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_secs(180);
    listener.set_nonblocking(true).map_err(|_| "Le retour de connexion local est indisponible.".to_string())?;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, peer)) if peer.ip().is_loopback() => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                let mut request = Vec::with_capacity(1024);
                let mut chunk = [0u8; 1024];
                while request.len() < 8192 && !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => request.extend_from_slice(&chunk[..count]),
                    }
                }
                let header_complete = request.len() <= 8192 && request.windows(4).any(|window| window == b"\r\n\r\n");
                let callback = if header_complete {
                    let request_text = String::from_utf8_lossy(&request);
                    let mut parts = request_text.lines().next().unwrap_or_default().split_whitespace();
                    match (parts.next(), parts.next(), parts.next(), parts.next()) {
                        (Some("GET"), Some(target), Some("HTTP/1.1" | "HTTP/1.0"), None) => parse_callback(target, state),
                        _ => Callback::Ignore,
                    }
                } else { Callback::Ignore };
                match callback {
                    Callback::Code(code) => { reply(&mut stream, true); return Ok(code); }
                    Callback::Denied => { reply(&mut stream, false); return Err("La connexion au cloud a été refusée.".into()); }
                    Callback::Ignore => reply(&mut stream, false),
                }
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(40)),
            Err(_) => return Err("Le retour de connexion local a échoué.".into()),
        }
    }
    Err("La connexion a expiré. Relancez-la depuis Notes.".into())
}

fn authorize(provider_name: String, client_id: String, client_secret: Option<String>, purpose: String, login_hint: Option<String>, session_path: std::path::PathBuf) -> Result<NativeToken, String> {
    let mut provider = provider_config(&provider_name)?;
    if provider_name == "google" {
        provider.scope = google_scope(&purpose)?;
    }
    if client_id.trim().is_empty() || client_id.len() > 2048 || client_secret.as_ref().is_some_and(|secret| secret.len() > 4096) {
        return Err("La connexion à ce cloud n’est pas configurée correctement.".into());
    }
    // Only the local IPv4 loopback is bound. No listener is exposed to the LAN.
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| "Impossible d’ouvrir le retour de connexion local.".to_string())?;
    let port = listener.local_addr().map_err(|_| "Le port de connexion local est indisponible.".to_string())?.port();
    let redirect = format!("http://{}:{port}/callback", provider.loopback_host);
    let verifier = random_secret();
    let state = random_secret();
    let mut url = Url::parse(provider.authorize).map_err(|_| "Configuration OAuth invalide.".to_string())?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("access_type", "offline")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("scope", provider.scope)
        .append_pair("state", &state)
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("include_granted_scopes", "true");
    url.query_pairs_mut().append_pair("prompt", if purpose == "login" { "select_account consent" } else { "consent" });
    if let Some(hint) = login_hint.clone().filter(|hint| !hint.is_empty() && hint.len() <= 255) { url.query_pairs_mut().append_pair("login_hint", &hint); }
    let expected_subject = login_hint.clone();
    // Fixed HTTPS provider URLs are opened by the OS, never inside the WebView.
    open::that(url.as_str()).map_err(|_| "Impossible d’ouvrir votre navigateur. Vérifiez le navigateur par défaut de Windows.".to_string())?;
    let code = wait_for_callback(listener, &state)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_| "Impossible de préparer la connexion sécurisée.".to_string())?;
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", client_id.clone()),
        ("code", code),
        ("redirect_uri", redirect),
        ("code_verifier", verifier),
    ];
    if provider_name == "google" {
        if let Some(secret) = client_secret.filter(|secret| !secret.is_empty()) { form.push(("client_secret", secret)); }
    } else { form.push(("scope", provider.scope.to_string())); }
    let response = client.post(provider.token).form(&form).send()
        .map_err(|_| "Le cloud ne répond pas. Vérifiez votre connexion Internet.".to_string())?;
    if !response.status().is_success() {
        return Err("Le cloud a refusé la connexion. Vérifiez les identifiants OAuth et les adresses de retour de cette version.".into());
    }
    let token: TokenResponse = response.json().map_err(|_| "La réponse du cloud est invalide.".to_string())?;
    if !token.token_type.eq_ignore_ascii_case("bearer") || token.access_token.is_empty() || token.access_token.len() > 32768 || token.expires_in == 0 || token.expires_in > 86400 {
        return Err("Le jeton renvoyé par le cloud est invalide.".into());
    }
    if let Some(scopes) = &token.scope {
        let required = if provider_name == "google" { if purpose == "login" { "openid" } else { "https://www.googleapis.com/auth/drive.appdata" } } else { "Files.ReadWrite.AppFolder" };
        if !scopes.split_whitespace().any(|scope| scope.eq_ignore_ascii_case(required) || scope.eq_ignore_ascii_case(&format!("https://graph.microsoft.com/{required}"))) {
            return Err("L’autorisation d’accès au dossier Notes n’a pas été accordée.".into());
        }
    }
    if token.refresh_token.as_ref().is_some_and(|v| v.is_empty() || v.len() > 32768) { return Err("La réponse Google est invalide.".into()); }
    let scope = token.scope.or_else(|| Some(provider.scope.to_string()));
    let user = if provider_name == "google" {
        let user = crate::session::read_google_user(&client, &token.access_token)?;
        crate::session::save_authorization(&session_path, user.clone(), client_id, token.access_token.clone(), token.expires_in, scope.clone(), token.refresh_token, if purpose == "drive" { expected_subject.as_deref() } else { None })?;
        Some(user)
    } else { None };
    Ok(NativeToken { access_token: token.access_token, expires_in: token.expires_in, scope, user })
}

#[tauri::command]
pub async fn native_authorize(app: tauri::AppHandle, provider: String, client_id: String, client_secret: Option<String>, purpose: Option<String>, login_hint: Option<String>) -> Result<NativeToken, String> {
    let path = crate::session::session_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || authorize(provider, client_id, client_secret, purpose.unwrap_or_else(|| "drive".into()), login_hint, path))
        .await.map_err(|_| "La connexion au cloud a été interrompue.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_identity_does_not_require_drive_permission() {
        assert_eq!(google_scope("login").unwrap(), "openid email profile");
        assert!(!google_scope("login").unwrap().contains("drive.appdata"));
        assert!(google_scope("drive").unwrap().contains("drive.appdata"));
        assert!(google_scope("unknown").is_err());
    }

    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert_eq!(random_secret().len(), 43);
    }

    #[test]
    fn callback_requires_exact_unique_state_and_path() {
        assert_eq!(parse_callback("/callback?code=abc&state=expected", "expected"), Callback::Code("abc".into()));
        assert_eq!(parse_callback("/callback?code=abc&state=other", "expected"), Callback::Ignore);
        assert_eq!(parse_callback("/callback?code=abc&state=expected&state=expected", "expected"), Callback::Ignore);
        assert_eq!(parse_callback("/other?code=abc&state=expected", "expected"), Callback::Ignore);
        assert_eq!(parse_callback("//attacker/callback?code=abc&state=expected", "expected"), Callback::Ignore);
        assert_eq!(parse_callback("/callback?code=abc&state=expected#state=expected", "expected"), Callback::Ignore);
    }

    #[test]
    fn denial_and_ambiguous_code_never_return_a_token() {
        assert_eq!(parse_callback("/callback?error=access_denied&state=expected", "expected"), Callback::Denied);
        assert_eq!(parse_callback("/callback?code=one&code=two&state=expected", "expected"), Callback::Denied);
        assert_eq!(parse_callback("/callback?state=expected", "expected"), Callback::Denied);
    }

    #[test]
    fn providers_cannot_redirect_token_exchange_to_arbitrary_hosts() {
        assert!(provider_config("https://attacker.example").is_err());
        assert_eq!(provider_config("google").unwrap().token, "https://oauth2.googleapis.com/token");
        assert_eq!(provider_config("onedrive").unwrap().loopback_host, "localhost");
    }
}

#[cfg(test)]
pub(crate) fn test_random_id() -> String { random_secret() }
