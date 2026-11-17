// 聚合搜索：并发调度全部可搜索站点，事件上报进度
use crate::error::AppResult;
use crate::models::{SearchResultGroup, SiteConfig};
use crate::state::AppState;
use futures::stream::{self, StreamExt};
use tauri::Emitter;

async fn search_site(
    state: &AppState,
    site: SiteConfig,
    wd: String,
    ua: &str,
    timeout_secs: u64,
) -> SearchResultGroup {
    let site_key = site.key.clone();
    let site_name = site.name.clone();
    let client = state.client.clone();
    let ua = ua.to_string();
    let task = async {
        if site.is_cms() {
            crate::cms::search_cms(&client, &ua, &site, &wd).await
        } else if site.kind == "html" {
            crate::htmlsite::search_html_site(&client, &ua, &site, &wd).await
        } else {
            Err(crate::error::AppError::msg("站点类型不支持搜索"))
        }
    };
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), task)
    .await
    {
        Ok(Ok(items)) => SearchResultGroup {
            site_key,
            site_name,
            ok: true,
            message: String::new(),
            items,
        },
        Ok(Err(e)) => SearchResultGroup {
            site_key,
            site_name,
            ok: false,
            message: e.to_string(),
            items: vec![],
        },
        Err(_) => SearchResultGroup {
            site_key,
            site_name,
            ok: false,
            message: "搜索超时".into(),
            items: vec![],
        },
    }
}

/// 聚合搜索：active 订阅下所有 searchable 站点并发搜索。
/// 每完成一个站点 emit "search:progress" { done, total, site_key, ok, count }。
pub async fn aggregate_search(
    app: &tauri::AppHandle,
    state: &AppState,
    wd: &str,
) -> AppResult<Vec<SearchResultGroup>> {
    let wd = wd.trim().to_string();
    if wd.is_empty() {
        return Ok(vec![]);
    }
    let cfg = {
        let rt = state.runtime.lock().await;
        state.active_config(&rt)
    };
    let Some(cfg) = cfg else {
        return Ok(vec![]);
    };
    let sites: Vec<SiteConfig> = cfg
        .sites
        .into_iter()
        .filter(|s| s.is_searchable())
        .collect();
    let total = sites.len();
    let (concurrency, timeout_secs, ua) = {
        // 设置页可调：并发数（1-32）、请求超时、自定义 UA；读取失败则用默认值
        state
            .settings
            .read()
            .map(|s| (s.search_concurrency, s.request_timeout, s.effective_ua()))
            .unwrap_or((6, 12, crate::state::USER_AGENT.to_string()))
    };
    let app_handle = app.clone();

    let results: Vec<SearchResultGroup> = stream::iter(sites.into_iter().enumerate())
        .map(|(idx, site)| {
            let state_ref = state;
            let app = app_handle.clone();
            let wd = wd.clone();
            let ua = ua.clone();
            async move {
                let group = search_site(state_ref, site, wd, &ua, timeout_secs).await;
                let _ = app.emit(
                    "search:progress",
                    serde_json::json!({
                        "done": idx + 1,
                        "total": total,
                        "siteKey": group.site_key,
                        "siteName": group.site_name,
                        "ok": group.ok,
                        "count": group.items.len(),
                    }),
                );
                group
            }
        })
        .buffer_unordered(concurrency)
        .collect::<Vec<_>>()
        .await;

    Ok(results)
}
