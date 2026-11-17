// 应用设置：settings.json（与订阅同目录），设置页可视化修改
// 对齐原版 tvbox-desktop 的「通用」「AI 总结」设置区
use crate::error::AppResult;
use crate::state::USER_AGENT;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AiSettings {
    /// OpenAI 兼容 API Key（DeepSeek 等），仅存本机
    pub api_key: String,
    /// 模型名，默认 deepseek-flash
    pub model: String,
    /// 接口地址，留空 = https://api.deepseek.com（自动拼 /chat/completions）
    pub base_url: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "deepseek-flash".into(),
            base_url: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// 聚合搜索并发数（1-32）
    pub search_concurrency: usize,
    /// 站点请求超时（秒）
    pub request_timeout: u64,
    /// 搜索结果过滤「解说/速看/混剪」
    pub hide_commentary: bool,
    /// 界面密度：cozy | compact
    pub density: String,
    /// 界面主题：light | dark | system（跟随系统）
    pub theme: String,
    /// 强调色 #RRGGBB
    pub accent: String,
    /// 自定义 User-Agent，留空用内置默认
    pub ua: String,
    /// 外部播放器命令模板，{url} 代表播放地址，空 = 自动探测
    /// 例：C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe --fullscreen {url}
    pub ext_player: String,
    /// AI 总结（OpenAI 兼容接口）
    pub ai: AiSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            search_concurrency: 8,
            request_timeout: 20,
            hide_commentary: true,
            density: "cozy".into(),
            theme: "system".into(),
            accent: "#2563eb".into(),
            ua: String::new(),
            ext_player: String::new(),
            ai: AiSettings::default(),
        }
    }
}

impl AppSettings {
    pub fn effective_ua(&self) -> String {
        let ua = self.ua.trim();
        if ua.is_empty() {
            USER_AGENT.to_string()
        } else {
            ua.to_string()
        }
    }

    /// 保存前的钳制，防止前端传非法值
    pub fn sanitized(mut self) -> Self {
        self.search_concurrency = self.search_concurrency.clamp(1, 32);
        self.request_timeout = self.request_timeout.clamp(1, 120);
        if !self.density.eq("compact") {
            self.density = "cozy".into();
        }
        if !matches!(self.theme.as_str(), "light" | "dark" | "system") {
            self.theme = "system".into();
        }
        let a = self.accent.trim();
        self.accent = if is_hex_color(a) { a.to_lowercase() } else { "#2563eb".into() };
        self
    }
}

fn is_hex_color(s: &str) -> bool {
    let b = s.strip_prefix('#').unwrap_or(s);
    b.len() == 6 && b.chars().all(|c| c.is_ascii_hexdigit())
}

fn settings_path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

pub fn load_settings(dir: &Path) -> AppSettings {
    match std::fs::read_to_string(settings_path(dir)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

pub fn save_settings(dir: &Path, s: &AppSettings) -> AppResult<()> {
    let p = settings_path(dir);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(s).unwrap_or_default())?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}
