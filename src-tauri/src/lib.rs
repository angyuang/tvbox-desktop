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
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let client = reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(Duration::from_secs(25))
                // 连接超时独立于总超时：失败站点尽快暴露，不拖满整个超时
                .connect_timeout(Duration::from_secs(10))
                // 采集站普遍证书不规范（自签名/过期/链不全），且部分老服务器 HTTP/2 兼容差
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .http1_only()
                .redirect(reqwest::redirect::Policy::limited(8))
                .build()?;
            let runtime: RuntimeState = storage::load_all(&data_dir)?;
            let settings = settings::load_settings(&data_dir);
            app.manage(AppState {
                data_dir,
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
            commands::test_site,
            commands::set_site_enabled,
            commands::set_all_sites_enabled,
            commands::set_window_theme,
        ])
        .run(tauri::generate_context!())
        .expect("TVBox Desktop 启动失败");
}
