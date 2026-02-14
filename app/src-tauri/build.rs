fn main() {
    // Ensure the resources/gateway directory has at least one file so the
    // glob pattern in tauri.conf.json ("resources/gateway/**") succeeds
    // during dev builds and cargo test. In production builds, this directory
    // is fully populated by scripts/bundle-gateway.sh.
    let placeholder = std::path::Path::new("resources/gateway/gateway/placeholder.txt");
    if !placeholder.exists() {
        if let Some(parent) = placeholder.parent() {
            std::fs::create_dir_all(parent).expect("Failed to create resources/gateway/gateway directory");
        }
        std::fs::write(
            placeholder,
            "# Placeholder for dev builds. Populated by scripts/bundle-gateway.sh\n",
        )
        .expect("Failed to create placeholder.txt");
    }
    tauri_build::build()
}
