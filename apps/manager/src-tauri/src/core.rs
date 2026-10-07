use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

pub const DEFAULT_DISTRO: &str = "Mew";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub distro: String,
    pub install_path: String,
    pub workspace: String,
    pub port: u16,
    pub owner_email: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            distro: DEFAULT_DISTRO.into(),
            install_path: "/home/mew/apps/mew".into(),
            workspace: "/home/mew/workspace".into(),
            port: 5000,
            owner_email: String::new(),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if self.distro.is_empty()
            || self.distro.len() > 40
            || !self.distro.starts_with(|c: char| c.is_ascii_alphabetic())
            || !self
                .distro
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(
                "배포판 이름은 영문으로 시작하는 영문·숫자·하이픈·밑줄 40자 이내여야 합니다."
                    .into(),
            );
        }
        for value in [&self.install_path, &self.workspace] {
            if value.len() > 400
                || !value.starts_with('/')
                || value.split('/').any(|p| p == "..")
                || !value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "/ _-.".contains(c))
            {
                return Err("Linux 절대 경로를 입력하세요. 영문·숫자·공백·하이픈·밑줄·점만 사용할 수 있습니다.".into());
            }
        }
        if !self.install_path.starts_with("/home/mew/") || self.install_path == "/home/mew/" {
            return Err("설치 폴더는 /home/mew/ 아래에 지정하세요.".into());
        }
        if !self.workspace.starts_with("/home/mew/") || self.workspace == "/home/mew/" {
            return Err("작업 폴더는 /home/mew/ 아래에 지정하세요.".into());
        }
        if self.port < 1024 {
            return Err("포트는 1024~65535 범위로 입력하세요.".into());
        }
        if !self.owner_email.is_empty()
            && (self.owner_email.len() > 254
                || self
                    .owner_email
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control())
                || self.owner_email.matches('@').count() != 1
                || self.owner_email.starts_with('@')
                || !self.owner_email.split('@').nth(1).is_some_and(|domain| {
                    domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
                }))
        {
            return Err("올바른 관리자 이메일을 입력하세요.".into());
        }
        Ok(())
    }
}
pub fn validate_action(action: &str) -> Result<(), String> {
    match action {
        "inspect" | "install" | "start" | "stop" | "restart" | "check-update" | "update"
        | "update-wsl" | "desktop-setup" => Ok(()),
        _ => Err("지원하지 않는 작업입니다.".into()),
    }
}
pub fn powershell_file(script: &str) -> Vec<u8> {
    // Windows PowerShell 5.1 needs a BOM to read Korean source as UTF-8.
    [b"\xef\xbb\xbf".as_slice(), script.as_bytes()].concat()
}
pub fn frame_json(encoded: &str) -> Result<serde_json::Value, String> {
    serde_json::from_slice(&STANDARD.decode(encoded).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
#[derive(Debug, PartialEq)]
pub enum Line {
    Log(String),
    Stage(String),
    Snapshot(String),
    Credential(String),
}
pub fn parse_line(text: &str) -> Line {
    let text = text.trim_end_matches('\r');
    for (prefix, kind) in [
        ("::mew-stage::", 0),
        ("::mew-snapshot::", 1),
        ("::mew-credential::", 2),
    ] {
        if let Some(rest) = text.strip_prefix(prefix) {
            return match kind {
                0 => Line::Stage(rest.into()),
                1 => Line::Snapshot(rest.into()),
                _ => Line::Credential(rest.into()),
            };
        }
    }
    if text.contains("임시 비밀번호:")
        || text.to_ascii_lowercase().contains("password:")
        || text.contains("::mew-credential::")
    {
        return Line::Log("[계정 정보는 로그에서 숨겼습니다]".into());
    }
    Line::Log(text.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shell_injection_and_path_traversal() {
        for value in ["../Mew", "Mew;whoami", "Mew'", "Mew\n", "--help"] {
            let mut s = Settings::default();
            s.distro = value.into();
            assert!(s.validate().is_err());
        }
        for value in [
            "/home/mew/../root",
            "/home/mew/$(id)",
            "/home/mew/\n",
            "/root/mew",
        ] {
            let mut s = Settings::default();
            s.install_path = value.into();
            assert!(s.validate().is_err());
        }
        let mut s = Settings::default();
        s.install_path = "/home/mew/My apps/mew".into();
        assert!(s.validate().is_ok());
        assert!(validate_action("wsl --unregister Ubuntu").is_err());
    }
    #[test]
    fn powershell_file_preserves_unicode_without_command_line_limits() {
        let original = "'경로 with spaces'";
        let file = powershell_file(original);
        assert_eq!(&file[..3], b"\xef\xbb\xbf");
        assert_eq!(std::str::from_utf8(&file[3..]).unwrap(), original);
        assert!(frame_json("invalid!").is_err());
        assert_eq!(
            frame_json(&STANDARD.encode(br#"{"port":5000}"#)).unwrap()["port"],
            5000
        );
    }
    #[test]
    fn credentials_are_never_log_lines() {
        assert_eq!(
            parse_line("임시 비밀번호: secret"),
            Line::Log("[계정 정보는 로그에서 숨겼습니다]".into())
        );
        assert!(matches!(
            parse_line("::mew-credential::encoded"),
            Line::Credential(_)
        ));
        assert_eq!(
            parse_line("::mew-stage::build\r"),
            Line::Stage("build".into())
        );
    }
}
