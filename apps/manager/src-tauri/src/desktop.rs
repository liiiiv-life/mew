use crate::core::{self, Line, Settings};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};

const WINDOWS_SCRIPT: &str = include_str!("../scripts/windows.ps1");
const HIDDEN: u32 = 0x08000000;
struct State {
    busy: Arc<Mutex<bool>>,
    settings: Mutex<Settings>,
    settings_error: Mutex<Option<String>>,
}
fn base() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA를 찾을 수 없습니다.")?)
            .join("Mew/Manager"),
    )
}
fn load_settings() -> Result<Settings, String> {
    let path = base()?.join("settings.json");
    let settings: Settings = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("설정 파일을 읽을 수 없습니다: {e}"))?
    } else {
        Settings::default()
    };
    settings.validate()?;
    Ok(settings)
}
fn save_atomic(path: PathBuf, value: &Settings) -> Result<(), String> {
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(value).unwrap()).map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())?;
    Ok(())
}
fn log(app: &tauri::AppHandle, text: &str, kind: &str) {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let row = json!({ "time": time, "kind": kind, "text": text });
    let _ = app.emit("manager-log", row.clone());
    if let Ok(base) = base() {
        let file = base.join("events.jsonl");
        if fs::metadata(&file)
            .map(|m| m.len() > 2_000_000)
            .unwrap_or(false)
        {
            let previous = base.join("events.previous.jsonl");
            let _ = fs::remove_file(&previous);
            let _ = fs::rename(&file, previous);
        }
        if let Ok(mut handle) = fs::OpenOptions::new().create(true).append(true).open(file) {
            let _ = writeln!(handle, "{row}");
        }
    }
}
fn keep_server_alive(settings: &Settings) {
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let script = "state=\"$HOME/.local/state/mew/mew.pid\"; [ -f \"$state\" ] || exit; pid=$(cat \"$state\"); while kill -0 \"$pid\" 2>/dev/null && grep -zq 'server/serve.ts' /proc/\"$pid\"/cmdline; do sleep 20; done";
    let _ = Command::new(PathBuf::from(system).join("System32/wsl.exe"))
        .args([
            "--distribution",
            &settings.distro,
            "--user",
            "mew",
            "--exec",
            "bash",
            "-c",
            script,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(HIDDEN)
        .spawn();
}
fn execute(app: &tauri::AppHandle, action: &str, settings: &Settings) -> Result<Value, String> {
    let payload = json!({ "action": action, "settings": settings, "scripts": { "probe": include_str!("../scripts/probe.sh"), "prepare": include_str!("../scripts/prepare.sh"), "install": include_str!("../scripts/install.sh"), "action": include_str!("../scripts/action.sh") } });
    let script = format!("$ManagerInput = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')) | ConvertFrom-Json\n{}", STANDARD.encode(payload.to_string()), WINDOWS_SCRIPT);
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let tasks = base()?.join("tasks");
    fs::create_dir_all(&tasks).map_err(|e| e.to_string())?;
    let script_path = tasks.join(format!("operation-{}.ps1", std::process::id()));
    fs::write(&script_path, core::powershell_file(&script)).map_err(|e| e.to_string())?;
    struct ScriptGuard(PathBuf);
    impl Drop for ScriptGuard {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _script_guard = ScriptGuard(script_path.clone());
    let mut child =
        Command::new(PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe"))
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .creation_flags(HIDDEN)
            .spawn()
            .map_err(|e| format!("Windows 제어 프로세스를 실행하지 못했습니다: {e}"))?;
    let err = child.stderr.take().unwrap();
    let errors = Arc::new(Mutex::new(String::new()));
    let error_copy = errors.clone();
    let error_app = app.clone();
    let error_thread = std::thread::spawn(move || {
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            if let Line::Log(text) = core::parse_line(&line) {
                log(&error_app, &text, "error");
                let mut errors = error_copy.lock().unwrap();
                errors.push_str(&text);
                errors.push('\n');
                if errors.len() > 8192 {
                    *errors = errors
                        .chars()
                        .rev()
                        .take(4096)
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                }
            }
        }
    });
    let mut snapshot = Value::Null;
    let mut framing_error = None;
    for line in BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map_while(Result::ok)
    {
        match core::parse_line(&line) {
            Line::Stage(stage) => {
                let _ = app.emit("manager-stage", &stage);
                if action != "inspect" {
                    log(app, &format!("단계: {stage}"), "stage");
                }
            }
            Line::Snapshot(encoded) => match core::frame_json(&encoded) {
                Ok(value) => snapshot = value,
                Err(error) => framing_error = Some(error),
            },
            Line::Credential(encoded) => match core::frame_json(&encoded) {
                Ok(credential) => {
                    let _ = app.emit("manager-credential", credential);
                }
                Err(_) => framing_error = Some("계정 정보를 읽지 못했습니다.".into()),
            },
            Line::Log(text) => {
                if let Some(encoded) = text.strip_prefix("::mew-update::") {
                    match core::frame_json(encoded) {
                        Ok(update) => {
                            let _ = app.emit("manager-update", update);
                        }
                        Err(error) => framing_error = Some(error),
                    }
                } else if !text.trim().is_empty() && action != "inspect" {
                    log(app, &text, "info");
                }
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = error_thread.join();
    if !status.success() {
        let error = errors.lock().unwrap().trim().to_string();
        return Err(if error.is_empty() {
            format!("작업이 실패했습니다 ({status}).")
        } else {
            error
        });
    }
    if let Some(error) = framing_error {
        return Err(format!("작업 응답을 읽지 못했습니다: {error}"));
    }
    if matches!(action, "install" | "start" | "restart" | "update") {
        keep_server_alive(settings);
    }
    Ok(snapshot)
}
#[tauri::command]
async fn run_operation(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    action: String,
) -> Result<Value, String> {
    core::validate_action(&action)?;
    if let Some(error) = state
        .settings_error
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
    {
        return Err(format!("{error} 설정 화면에서 값을 확인하고 저장하세요."));
    }
    {
        let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
        if *busy {
            return Err("다른 작업이 진행 중입니다.".into());
        }
        *busy = true;
    }
    let settings = state.settings.lock().unwrap().clone();
    let busy = state.busy.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        struct BusyGuard(Arc<Mutex<bool>>);
        impl Drop for BusyGuard {
            fn drop(&mut self) {
                if let Ok(mut value) = self.0.lock() {
                    *value = false;
                }
            }
        }
        let _guard = BusyGuard(busy);
        execute(&app, &action, &settings)
    })
    .await
    .map_err(|e| e.to_string())?;
    result
}
#[tauri::command]
fn get_settings(state: tauri::State<'_, State>) -> Result<Settings, String> {
    if let Some(error) = state
        .settings_error
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
    {
        return Err(error.clone());
    }
    Ok(state.settings.lock().unwrap().clone())
}
#[tauri::command]
fn set_settings(state: tauri::State<'_, State>, settings: Settings) -> Result<Settings, String> {
    settings.validate()?;
    let busy = state.busy.lock().map_err(|e| e.to_string())?;
    if *busy {
        return Err("작업 완료 후 설정을 변경하세요.".into());
    }
    save_atomic(base()?.join("settings.json"), &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    *state.settings_error.lock().unwrap() = None;
    Ok(settings)
}
#[tauri::command]
fn get_logs() -> Result<Vec<Value>, String> {
    let path = base()?.join("events.jsonl");
    if !path.exists() {
        return Ok(vec![]);
    }
    let lines = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(lines
        .lines()
        .rev()
        .take(300)
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect())
}
#[tauri::command]
fn open_mew(state: tauri::State<'_, State>, port: u16) -> Result<(), String> {
    let expected = state.settings.lock().unwrap().port;
    if port < expected || port > expected.saturating_add(20) {
        return Err("지원하지 않는 서버 포트입니다.".into());
    }
    let system = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    Command::new(PathBuf::from(system).join("explorer.exe"))
        .arg(format!("http://localhost:{port}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn open_folder(kind: String) -> Result<(), String> {
    let dir = match kind.as_str() {
        "manager" => base()?,
        _ => return Err("지원하지 않는 폴더입니다.".into()),
    };
    Command::new(
        PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
            .join("explorer.exe"),
    )
    .arg(dir)
    .spawn()
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn run() {
    let settings = load_settings();
    let error = settings.as_ref().err().cloned();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(State {
            busy: Arc::new(Mutex::new(false)),
            settings: Mutex::new(settings.unwrap_or_default()),
            settings_error: Mutex::new(error.clone()),
        })
        .setup(move |app| {
            if let Some(error) = &error {
                log(app.handle(), error, "error");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if *window.state::<State>().busy.lock().unwrap() {
                    api.prevent_close();
                    let _ = window.emit(
                        "manager-notice",
                        "작업이 진행 중입니다. 완료 후 창을 닫을 수 있습니다.",
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            run_operation,
            get_settings,
            set_settings,
            get_logs,
            open_mew,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("mewnager를 시작하지 못했습니다.");
}
