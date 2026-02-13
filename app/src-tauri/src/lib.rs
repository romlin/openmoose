use futures_util::StreamExt;
use reqwest::header::RANGE;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ── Constants (single source of truth for model identity) ──────────────
const MODEL_FILENAME: &str = "Ministral-3-14B-Reasoning-2512-Q4_K_M.gguf";
const MODEL_URL: &str = "https://huggingface.co/mistralai/Ministral-3-14B-Reasoning-2512-GGUF/resolve/main/Ministral-3-14B-Reasoning-2512-Q4_K_M.gguf";
const MODEL_MIN_SIZE: u64 = 7_500_000_000; // ~7.5 GB sanity check
const DEFAULT_GATEWAY_PORT: u16 = 18789;

#[derive(Clone, Serialize, Deserialize, Debug)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

/// The fields the app owns inside ~/.moose/config.json.
/// We use serde_json::Value for read-modify-write so we never
/// destroy fields the gateway (or user) may have added.
#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct AppConfig {
    #[serde(default)]
    setup_complete: bool,
    #[serde(default = "default_theme")]
    theme: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct StartupInfo {
    config: AppConfig,
    model_exists: bool,
    model_size: u64,
    model_name: String,
    gateway_port: u16,
}

fn default_theme() -> String {
    "dark".to_string()
}

fn get_moose_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".moose"))
}

fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_moose_dir(app)?.join("config.json"))
}

fn get_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(get_moose_dir(app)?.join(format!("models/llama-cpp/{}", MODEL_FILENAME)))
}

fn get_gateway_port() -> u16 {
    std::env::var("GATEWAY_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_GATEWAY_PORT)
}

struct GatewayState(Mutex<Option<CommandChild>>);

fn find_project_root() -> Option<PathBuf> {
    let mut current = std::env::current_dir().ok()?;
    loop {
        // OpenMoose root has both package.json and pnpm-workspace.yaml (or src/gateway)
        if current.join("package.json").exists()
            && (current.join("pnpm-workspace.yaml").exists()
                || current.join("src/gateway").exists())
        {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn start_gateway_internal(
    app: &tauri::AppHandle,
    state: &State<'_, GatewayState>,
) -> Result<String, String> {
    let mut lock = state.0.lock().unwrap();
    if lock.is_some() {
        return Ok("Gateway already running".to_string());
    }

    let root_dir = find_project_root()
        .ok_or("Could not find project root (package.json not found in parents)")?;
    println!("[Rust] Found project root at: {:?}", root_dir);

    let shell = app.shell();

    // Prefer pnpm if available, otherwise fallback to npm
    let has_pnpm = std::process::Command::new("pnpm")
        .arg("--version")
        .output()
        .is_ok();
    let cmd = if has_pnpm { "pnpm" } else { "npm" };

    println!("[Rust] Starting gateway using {} in {:?}", cmd, root_dir);

    let output = shell
        .command(cmd)
        .args(["run", "gateway"])
        .current_dir(root_dir)
        .spawn();

    match output {
        Ok((_rx, child)) => {
            *lock = Some(child);
            Ok("Gateway started".to_string())
        }
        Err(e) => {
            let err_msg = format!("Failed to spawn gateway process: {}", e);
            println!("[Rust] Error: {}", err_msg);
            Err(err_msg)
        }
    }
}

#[tauri::command]
async fn start_gateway(
    app: tauri::AppHandle,
    state: State<'_, GatewayState>,
) -> Result<String, String> {
    start_gateway_internal(&app, &state)
}

#[tauri::command]
async fn stop_gateway(state: State<'_, GatewayState>) -> Result<String, String> {
    let mut lock = state.0.lock().unwrap();
    if let Some(child) = lock.take() {
        let kill_result = child.kill();
        match kill_result {
            Ok(_) => Ok("Gateway stopped".to_string()),
            Err(e) => Err(format!("Failed to stop gateway: {}", e)),
        }
    } else {
        Ok("Gateway not running".to_string())
    }
}

#[tauri::command]
async fn download_model<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let url = MODEL_URL;
    let file_path = get_model_path(&app)?;
    let path = file_path.parent().unwrap();

    println!("[Rust] Starting download from: {}", url);
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("OpenMoose")
        .build()
        .map_err(|e| e.to_string())?;

    // Get total size first
    let head_res = client
        .head(url)
        .send()
        .await
        .map_err(|e| format!("HEAD request failed: {}", e))?;

    let mut total_size = head_res.content_length().unwrap_or(0);

    if total_size == 0 {
        println!("[Rust] HEAD request didn't return Content-Length, trying GET...");
        let get_res = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("GET (size check) failed: {}", e))?;
        total_size = get_res.content_length().unwrap_or(0);
    }

    if total_size == 0 {
        return Err("Could not determine model size from server".to_string());
    }

    println!("[Rust] Total size: {} bytes", total_size);

    let mut downloaded: u64 = 0;
    let mut file = if file_path.exists() {
        let metadata = file_path.metadata().map_err(|e| e.to_string())?;
        downloaded = metadata.len();

        if downloaded >= total_size {
            println!("[Rust] Model already downloaded.");
            app.emit(
                "download-progress",
                DownloadProgress {
                    downloaded: total_size,
                    total: total_size,
                },
            )
            .map_err(|e| e.to_string())?;
            return Ok(());
        }

        println!("[Rust] Resuming from {} bytes", downloaded);
        std::fs::OpenOptions::new()
            .append(true)
            .open(&file_path)
            .map_err(|e| e.to_string())?
    } else {
        std::fs::File::create(&file_path).map_err(|e| e.to_string())?
    };

    // Emit initial progress immediately
    app.emit(
        "download-progress",
        DownloadProgress {
            downloaded,
            total: total_size,
        },
    )
    .map_err(|e| e.to_string())?;

    let mut request = client.get(url);
    if downloaded > 0 {
        request = request.header(RANGE, format!("bytes={}-", downloaded));
    }

    let res = request
        .send()
        .await
        .map_err(|e| format!("Download stream failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Server returned error: {}", res.status()));
    }

    // Check if range was respected (206 Partial Content)
    if downloaded > 0 && res.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        println!("[Rust] Server did not respect Range header, starting from 0");
        downloaded = 0;
        file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
        app.emit(
            "download-progress",
            DownloadProgress {
                downloaded,
                total: total_size,
            },
        )
        .map_err(|e| e.to_string())?;
    }

    let mut stream = res.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if last_emit.elapsed().as_millis() > 200 {
            app.emit(
                "download-progress",
                DownloadProgress {
                    downloaded,
                    total: total_size,
                },
            )
            .map_err(|e| e.to_string())?;
            last_emit = std::time::Instant::now();
        }
    }

    app.emit(
        "download-progress",
        DownloadProgress {
            downloaded: total_size,
            total: total_size,
        },
    )
    .map_err(|e| e.to_string())?;

    println!("[Rust] Download finished successfully.");
    Ok(())
}

/// Reads the full config.json as a serde_json::Value (preserves all fields).
fn read_config_raw(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = get_config_path(app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn get_config_internal(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let raw = read_config_raw(app)?;
    serde_json::from_value(raw).map_err(|e| e.to_string())
}

async fn check_model_exists_internal(app: &tauri::AppHandle) -> bool {
    match get_model_path(app) {
        Ok(p) => {
            if !p.exists() {
                return false;
            }
            p.metadata()
                .map(|m| m.len() > MODEL_MIN_SIZE)
                .unwrap_or(false)
        }
        Err(_) => false,
    }
}

#[tauri::command]
async fn check_model_exists(app: tauri::AppHandle) -> bool {
    check_model_exists_internal(&app).await
}

#[tauri::command]
async fn get_startup_info(app: tauri::AppHandle) -> Result<StartupInfo, String> {
    let config = get_config_internal(&app)?;
    let model_exists = check_model_exists_internal(&app).await;
    let model_path = get_model_path(&app)?;
    let (model_name, model_size) = if model_exists {
        let name = model_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unknown".to_string());
        let size = model_path.metadata().map(|m| m.len()).unwrap_or(0);
        (name, size)
    } else {
        (MODEL_FILENAME.to_string(), 0)
    };
    Ok(StartupInfo {
        config,
        model_exists,
        model_size,
        model_name,
        gateway_port: get_gateway_port(),
    })
}

#[tauri::command]
async fn get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    get_config_internal(&app)
}

#[tauri::command]
async fn update_config(app: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let path = get_config_path(&app)?;
    let moose_dir = path.parent().unwrap();

    std::fs::create_dir_all(moose_dir).map_err(|e| e.to_string())?;

    // Read-modify-write: preserve any fields the gateway or user may have set.
    let mut existing = read_config_raw(&app)?;
    let obj = existing
        .as_object_mut()
        .ok_or("config.json is not a JSON object")?;
    obj.insert(
        "setup_complete".to_string(),
        serde_json::Value::Bool(config.setup_complete),
    );
    obj.insert(
        "theme".to_string(),
        serde_json::Value::String(config.theme),
    );

    let content = serde_json::to_string_pretty(&existing).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_docker(app: tauri::AppHandle) -> Result<bool, String> {
    let shell = app.shell();
    let output = shell.command("docker").args(["info"]).output().await;

    match output {
        Ok(out) => {
            if out.status.success() {
                Ok(true)
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                Err(format!("Docker check failed: {}", stderr))
            }
        }
        Err(e) => Err(format!("Failed to execute docker: {}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(GatewayState(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_gateway,
            stop_gateway,
            check_docker,
            check_model_exists,
            get_startup_info,
            download_model,
            get_config,
            update_config
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<GatewayState>();

            // Check if setup is complete
            if let Ok(config) = get_config_internal(&handle) {
                if config.setup_complete {
                    println!("[Rust] Auto-starting gateway in background...");
                    let _ = start_gateway_internal(&handle, &state);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_gateway_port() {
        // Without GATEWAY_PORT env var, should return the default
        std::env::remove_var("GATEWAY_PORT");
        assert_eq!(get_gateway_port(), DEFAULT_GATEWAY_PORT);
    }
}
