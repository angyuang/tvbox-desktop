// Tauri 应用装配：插件、状态、命令注册
pub mod ai;
pub mod builtin;
pub mod cms;
pub mod commands;
pub mod error;
pub mod external;
pub mod htmlsite;
pub mod http;
pub mod live;
pub mod models;
pub mod parse;
pub mod room;
pub mod search;
pub mod settings;
pub mod sniffer;
pub mod state;
pub mod storage;

use state::{AppState, RuntimeState, USER_AGENT};
use std::time::Duration;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 便携模式：若 exe 同目录存在 data 文件夹则优先使用（配置文件可随目录拷贝、直接编辑），
            // 否则用系统数据目录（Windows: %APPDATA%\com.tvbox.desktop）
            let exe_data = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .map(|d| d.join("data"));
            let (data_dir, portable) = match exe_data {
                Some(d) if d.is_dir() => (d, true),
                _ => (app.path().app_data_dir()?, false),
            };
            std::fs::create_dir_all(&data_dir)?;
            let client = reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(Duration::from_secs(25))
                .redirect(reqwest::redirect::Policy::limited(8))
                .build()?;
            let runtime: RuntimeState = storage::load_all(&data_dir)?;
            let settings = settings::load_settings(&data_dir);
            app.manage(AppState {
                data_dir,
                portable,
                client,
                runtime: tokio::sync::Mutex::new(runtime),
                settings: std::sync::RwLock::new(settings),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::add_subscription_url,
            commands::add_subscription_local,
            commands::add_subscription_raw,
            commands::remove_subscription,
            commands::rename_subscription,
            commands::set_subscription_enabled,
            commands::set_active_subscription,
            commands::refresh_subscription,
            commands::set_site_enabled,
            commands::reload_app_state,
            commands::get_home_sections,
            commands::get_categories,
            commands::get_videolist,
            commands::get_detail,
            commands::aggregate_search,
            commands::get_live_channels,
            commands::speed_test_lines,
            commands::resolve_room_url,
            commands::open_external_player,
            commands::detect_players,
            commands::get_settings,
            commands::save_settings,
            commands::get_app_info,
            commands::open_data_dir,
            commands::check_update,
            commands::open_in_browser,
            commands::set_theme,
            commands::resolve_parse,
            commands::ai_summary,
            commands::add_favorite,
            commands::remove_favorite,
            commands::get_favorites,
            commands::save_progress,
            commands::get_history,
            commands::remove_history,
            commands::clear_history,
            commands::sniff_page,
            commands::open_sniffer,
            commands::close_sniffer,
        ])
        .run(tauri::generate_context!())
        .expect("TVBox Desktop 启动失败");
}
