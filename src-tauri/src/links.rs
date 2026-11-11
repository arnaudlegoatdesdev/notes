use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::{io::Read, net::{IpAddr, SocketAddr, ToSocketAddrs}, time::{Duration, Instant}};
use url::Url;

fn external_url(value: &str) -> Result<Url, String> {
    if value.len() > 8192 || value.chars().any(|c| c.is_control() || c.is_whitespace()) { return Err("Lien invalide.".into()); }
    let url = Url::parse(value).map_err(|_| "Lien invalide.".to_string())?;
    if !matches!(url.scheme(), "https" | "http" | "mailto") || !url.username().is_empty() || url.password().is_some() { return Err("Ce type de lien n’est pas pris en charge.".into()); }
    if url.scheme() != "mailto" && url.host_str().is_none() { return Err("Lien invalide.".into()); }
    Ok(url)
}
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let url = external_url(&url)?.to_string();
    tauri::async_runtime::spawn_blocking(move || open::that(url).map_err(|_| "Impossible d’ouvrir votre navigateur par défaut.".to_string()))
        .await.map_err(|_| "L’ouverture du lien a été interrompue.".to_string())?
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a,b,c,_] = ip.octets();
            !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_broadcast() || ip.is_documentation() ||
                a == 0 || a >= 224 || (a == 100 && (64..=127).contains(&b)) ||
                (a == 192 && b == 0 && c == 0) || (a == 198 && (b == 18 || b == 19)))
        },
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only global unicast, excluding transition and documentation ranges.
            (s[0] & 0xe000) == 0x2000 && s[0] != 0x2002 &&
                !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8)) &&
                !(s[0] == 0x3fff && (s[1] & 0xf000) == 0)
        }
    }
}
fn preview_url(value: &str) -> Result<Url, String> {
    let url = external_url(value)?;
    if !matches!(url.scheme(), "http" | "https") || !matches!(url.port_or_known_default(), Some(80 | 443)) { return Err("Aperçu indisponible.".into()); }
    let host = url.host_str().unwrap_or_default().trim_end_matches('.');
    if !host.contains('.') && !host.contains(':') || ["localhost", ".localhost", ".local", ".internal", ".test", ".invalid"].iter().any(|suffix| host == *suffix || host.ends_with(suffix)) { return Err("Aperçu indisponible pour une adresse locale.".into()); }
    Ok(url)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkResource { url: String, content_type: String, body: String }
fn fetch_resource(value: String, kind: String) -> Result<LinkResource, String> {
    let limit = match kind.as_str() { "page" => 512 * 1024, "image" => 3 * 1024 * 1024, _ => return Err("Ressource inconnue.".into()) };
    let mut url = preview_url(&value)?;
    let start = Instant::now();
    for _ in 0..4 {
        let host = url.host_str().ok_or("Adresse invalide.")?.trim_matches(['[', ']']).to_string();
        let port = url.port_or_known_default().ok_or("Port invalide.")?;
        let addresses: Vec<SocketAddr> = (host.as_str(), port).to_socket_addrs().map_err(|_| "Ce site ne répond pas.".to_string())?.collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) { return Err("Aperçu indisponible pour cette adresse.".into()); }
        let remaining = Duration::from_secs(12).checked_sub(start.elapsed()).ok_or("Le site met trop de temps à répondre.")?;
        // Pin vetted DNS answers and recheck every redirect. Never forward cookies, tokens or proxy credentials.
        let client = reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addresses).timeout(remaining).connect_timeout(Duration::from_secs(4))
            .user_agent("Notes/1.0 (link preview)").build().map_err(|_| "Aperçu indisponible.".to_string())?;
        let response = client.get(url.clone()).header("Accept", if kind == "page" { "text/html,application/xhtml+xml" } else { "image/avif,image/webp,image/png,image/jpeg,image/gif" })
            .send().map_err(|_| "Ce site ne répond pas.".to_string())?;
        if response.status().is_redirection() {
            let location = response.headers().get(reqwest::header::LOCATION).and_then(|h| h.to_str().ok()).ok_or("Redirection invalide.")?;
            url = preview_url(url.join(location).map_err(|_| "Redirection invalide.")?.as_str())?;
            continue;
        }
        if !response.status().is_success() { return Err("Ce site ne propose pas d’aperçu.".into()); }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|h| h.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        let valid_type = if kind == "page" { matches!(content_type.as_str(), "text/html" | "application/xhtml+xml") } else { matches!(content_type.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/avif") };
        if !valid_type { return Err("Format d’aperçu inconnu.".into()); }
        let mut bytes = Vec::new();
        response.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(|_| "Aperçu interrompu.".to_string())?;
        if bytes.len() > limit { if kind == "image" { return Err("Image d’aperçu trop volumineuse.".into()); } bytes.truncate(limit); }
        return Ok(LinkResource { url: url.to_string(), content_type, body: STANDARD.encode(bytes) });
    }
    Err("Trop de redirections.".into())
}
#[tauri::command]
pub async fn fetch_link_resource(url: String, kind: String) -> Result<LinkResource, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_resource(url, kind)).await.map_err(|_| "Aperçu interrompu.".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires public internet; run explicitly for local QA"]
    fn public_preview_network_smoke() {
        let resource = fetch_resource("https://ogp.me/".into(), "page".into()).expect("public HTML preview");
        assert_eq!(resource.content_type, "text/html");
        let bytes = STANDARD.decode(&resource.body).unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("Open Graph"));
    }
    #[test]
    fn external_links_are_urls_not_commands() {
        assert!(external_url("https://example.com/path?q=a&other=b").is_ok());
        assert!(external_url("mailto:hello@example.com").is_ok());
        for value in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello", "cmd.exe /c calc", "https://user:secret@example.com", "https://example.com/\n"] { assert!(external_url(value).is_err(), "{value}"); }
    }
    #[test]
    fn preview_requests_cannot_target_private_or_special_networks() {
        for ip in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2002:7f00:1::"] { assert!(!public_ip(ip.parse().unwrap()), "{ip}"); }
        for ip in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] { assert!(public_ip(ip.parse().unwrap()), "{ip}"); }
        assert!(preview_url("http://localhost").is_err());
        assert!(preview_url("https://example.com:9000/").is_err());
    }
}
