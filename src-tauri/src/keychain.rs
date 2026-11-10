//! macOS stores the OAuth session in the system Keychain, never in a plaintext file.
use std::{ffi::c_void, ptr};
const ACCOUNT: &[u8] = b"Google OAuth session";
pub(crate) const SERVICE: &str = "fr.flion.notes.google-session";
#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainFindGenericPassword(keychain: *const c_void, service_len: u32, service: *const u8, account_len: u32, account: *const u8, length: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32;
    fn SecKeychainAddGenericPassword(keychain: *const c_void, service_len: u32, service: *const u8, account_len: u32, account: *const u8, length: u32, data: *const c_void, item: *mut *mut c_void) -> i32;
    fn SecKeychainItemModifyAttributesAndData(item: *mut c_void, attributes: *const c_void, length: u32, data: *const c_void) -> i32;
    fn SecKeychainItemDelete(item: *mut c_void) -> i32;
    fn SecKeychainItemFreeContent(attributes: *const c_void, data: *mut c_void) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" { fn CFRelease(value: *const c_void); }
const NOT_FOUND: i32 = -25300;
fn failure() -> String { "Le Trousseau macOS n’a pas autorisé l’accès à la connexion Notes.".into() }
unsafe fn find(service: &str, length: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32 {
    SecKeychainFindGenericPassword(ptr::null(), service.len() as u32, service.as_ptr(), ACCOUNT.len() as u32, ACCOUNT.as_ptr(), length, data, item)
}
pub(crate) fn read(service: &str) -> Result<Option<Vec<u8>>, String> {
    let mut length = 0; let mut data = ptr::null_mut();
    let status = unsafe { find(service, &mut length, &mut data, ptr::null_mut()) };
    if status == NOT_FOUND { return Ok(None); }
    if status != 0 { return Err(failure()); }
    let result = if data.is_null() || length == 0 || length > 131072 { Err("La connexion enregistrée est invalide.".into()) }
        else { Ok(Some(unsafe { std::slice::from_raw_parts(data.cast::<u8>(), length as usize).to_vec() })) };
    if !data.is_null() { unsafe { std::slice::from_raw_parts_mut(data.cast::<u8>(), length as usize).fill(0); SecKeychainItemFreeContent(ptr::null(), data); } }
    result
}
pub(crate) fn write(service: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 131072 { return Err("La connexion enregistrée est invalide.".into()); }
    let mut item = ptr::null_mut();
    let found = unsafe { find(service, ptr::null_mut(), ptr::null_mut(), &mut item) };
    let status = match found {
        NOT_FOUND => unsafe { SecKeychainAddGenericPassword(ptr::null(), service.len() as u32, service.as_ptr(), ACCOUNT.len() as u32, ACCOUNT.as_ptr(), bytes.len() as u32, bytes.as_ptr().cast(), ptr::null_mut()) },
        0 => { let result = unsafe { SecKeychainItemModifyAttributesAndData(item, ptr::null(), bytes.len() as u32, bytes.as_ptr().cast()) }; unsafe { CFRelease(item); } result },
        _ => return Err(failure()),
    };
    if status == 0 { Ok(()) } else { Err(failure()) }
}
pub(crate) fn delete(service: &str) -> Result<(), String> {
    let mut item = ptr::null_mut(); let found = unsafe { find(service, ptr::null_mut(), ptr::null_mut(), &mut item) };
    if found == NOT_FOUND { return Ok(()); }
    if found != 0 { return Err(failure()); }
    let status = unsafe { let status = SecKeychainItemDelete(item); CFRelease(item); status };
    if status == 0 { Ok(()) } else { Err(failure()) }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_survives_restart_updates_and_explicit_sign_out() {
        let service = format!("fr.flion.notes.test.{}", crate::oauth::test_random_id());
        assert!(read(&service).unwrap().is_none());
        write(&service, b"private-session-v1").unwrap();
        assert_eq!(read(&service).unwrap().unwrap(), b"private-session-v1");
        write(&service, b"private-session-v2").unwrap();
        assert_eq!(read(&service).unwrap().unwrap(), b"private-session-v2");
        delete(&service).unwrap(); assert!(read(&service).unwrap().is_none()); delete(&service).unwrap();
    }
}
