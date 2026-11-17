// 应用全局状态：数据目录 + HTTP 客户端 + 订阅运行时状态 + 应用设置
use crate::models::Subscription;
use crate::settings::AppSettings;
use std::path::PathBuf;
use std::sync::RwLock;
use tokio::sync::Mutex;

pub struct AppState {
    pub data_dir: PathBuf,
    /// 是否便携模式：exe 同目录存在 data 文件夹（配置随目录迁移）
    pub portable: bool,
    pub client: reqwest::Client,
    pub runtime: Mutex<RuntimeState>,
    /// 应用设置（设置页修改，settings.json 持久化）。临界区极短，同步 RwLock 足够
    pub settings: RwLock<AppSettings>,
}

#[derive(Default)]
pub struct RuntimeState {
    pub subscriptions: Vec<Subscription>,
    pub active_id: Option<String>,
}

impl AppState {
    /// 当前生效的配置：优先 active_id 且未被禁用的订阅，否则第一个启用的订阅
    pub fn active_config(&self, rt: &RuntimeState) -> Option<crate::models::TvboxConfig> {
        let enabled: Vec<&Subscription> = rt.subscriptions.iter().filter(|s| s.enabled).collect();
        let active = rt
            .active_id
            .as_ref()
            .and_then(|id| enabled.iter().find(|s| &s.id == id))
            .copied();
        let sub = match active {
            Some(s) => Some(s),
            None => enabled.first().copied(),
        };
        sub.map(|s| s.config.clone())
    }

    /// 读取当前设置的 UA（快照）
    pub fn effective_ua(&self) -> String {
        self.settings
            .read()
            .map(|s| s.effective_ua())
            .unwrap_or_else(|_| USER_AGENT.to_string())
    }
}

pub const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 tvbox-desktop-tauri/1.0";
