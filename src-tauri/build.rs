fn main() {
    println!("cargo:rerun-if-env-changed=FLION_UPDATER_PUBLIC_KEY");
    tauri_build::build()
}
