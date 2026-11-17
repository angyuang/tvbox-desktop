// Tauri commands：前端 invoke 的全部入口
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::state::{AppState, RuntimeState};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize, Default)]
pub struct HomeSectionData {
    pub title: String,
    pub site_key: String,
    pub site_name: String,
    pub items: Vec<VideoCard>,
}

async fn with_runtime<T>(
    state: &AppState,
    f: impl FnOnce(&mut RuntimeState) -> AppResult<T>,
) -> AppResult<T> {
    let mut rt = state.runtime.lock().await;
    f(&mut rt)
}

// ---------------- 应用状态 / 订阅管理 ----------------

#[tauri::command]
pub async fn get_app_state(state: tauri::State<'_, AppState>) -> AppResult<serde_json::Value> {
    let rt = state.runtime.lock().await;
    let active_config = state.active_config(&rt);
    Ok(serde_json::json!({
        "subscriptions": &rt.subscriptions,
        "activeId": &rt.active_id,
        "activeConfig": active_config,
    }))
}

#[tauri::command]
pub async fn add_subscription_url(
    state: tauri::State<'_, AppState>,
    url: String,
) -> AppResult<Subscription> {
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::msg("订阅地址必须是 http(s) 链接"));
    }
    let text = crate::http::fetch_text(&state.client, &url, &state.effective_ua(), &Default::default(), 20).await?;
    let cfg = TvboxConfig::parse_json(&text)?;
    let sub = Subscription {
        id: crate::storage::gen_id(),
        name: cfg.name.clone().unwrap_or_else(|| url.clone()),
        url,
        created_at: crate::storage::now(),
        updated_at: crate::storage::now(),
        enabled: true,
        config: cfg,
    };
    with_runtime(&state, |rt| {
        rt.subscriptions.push(sub.clone());
        if rt.active_id.is_none() {
            rt.active_id = Some(sub.id.clone());
        }
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await?;
    Ok(sub)
}

#[tauri::command]
pub async fn add_subscription_local(
    state: tauri::State<'_, AppState>,
    path: String,
) -> AppResult<Subscription> {
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::msg(format!("读取本地配置失败: {e}")))?;
    let cfg = TvboxConfig::parse_json(&text)?;
    let name = cfg
        .name
        .clone()
        .unwrap_or_else(|| std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "本地配置".into()));
    let sub = Subscription {
        id: crate::storage::gen_id(),
        name,
        url: path,
        created_at: crate::storage::now(),
        updated_at: crate::storage::now(),
        enabled: true,
        config: cfg,
    };
    with_runtime(&state, |rt| {
        rt.subscriptions.push(sub.clone());
        if rt.active_id.is_none() {
            rt.active_id = Some(sub.id.clone());
        }
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await?;
    Ok(sub)
}

#[tauri::command]
pub async fn add_subscription_raw(
    state: tauri::State<'_, AppState>,
    json_text: String,
    name: Option<String>,
) -> AppResult<Subscription> {
    let cfg = TvboxConfig::parse_json(&json_text)?;
    let sub = Subscription {
        id: crate::storage::gen_id(),
        name: name
            .filter(|n| !n.trim().is_empty())
            .or_else(|| cfg.name.clone())
            .unwrap_or_else(|| "粘贴的配置".into()),
        url: "local:pasted".into(),
        created_at: crate::storage::now(),
        updated_at: crate::storage::now(),
        enabled: true,
        config: cfg,
    };
    with_runtime(&state, |rt| {
        rt.subscriptions.push(sub.clone());
        if rt.active_id.is_none() {
            rt.active_id = Some(sub.id.clone());
        }
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await?;
    Ok(sub)
}

#[tauri::command]
pub async fn remove_subscription(
    state: tauri::State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    with_runtime(&state, |rt| {
        rt.subscriptions.retain(|s| s.id != id);
        if rt.active_id.as_deref() == Some(id.as_str()) {
            rt.active_id = rt.subscriptions.first().map(|s| s.id.clone());
        }
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_active_subscription(
    state: tauri::State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    with_runtime(&state, |rt| {
        if !rt.subscriptions.iter().any(|s| s.id == id) {
            return Err(AppError::msg("订阅不存在"));
        }
        rt.active_id = Some(id);
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn rename_subscription(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::msg("名称不能为空"));
    }
    with_runtime(&state, |rt| {
        let s = rt
            .subscriptions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::msg("订阅不存在"))?;
        s.name = name;
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_subscription_enabled(
    state: tauri::State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    with_runtime(&state, |rt| {
        let s = rt
            .subscriptions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| AppError::msg("订阅不存在"))?;
        s.enabled = enabled;
        // 禁用了当前激活订阅则切到第一个启用的
        if !enabled && rt.active_id.as_deref() == Some(id.as_str()) {
            rt.active_id = rt
                .subscriptions
                .iter()
                .find(|s| s.enabled && s.id != id)
                .map(|s| s.id.clone());
        }
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn refresh_subscription(
    state: tauri::State<'_, AppState>,
    id: String,
) -> AppResult<Subscription> {
    // 先在锁外做网络/文件 IO
    let sub = {
        let rt = state.runtime.lock().await;
        let sub = rt
            .subscriptions
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| AppError::msg("订阅不存在"))?;
        sub
    };
    let cfg = if sub.id == crate::builtin::BUILTIN_ID {
        Ok(crate::builtin::builtin_config())
    } else if sub.url.starts_with("http://") || sub.url.starts_with("https://") {
        let text = crate::http::fetch_text(&state.client, &sub.url, &state.effective_ua(), &Default::default(), 20).await?;
        TvboxConfig::parse_json(&text)
    } else if std::path::Path::new(&sub.url).exists() {
        let text = std::fs::read_to_string(&sub.url)
            .map_err(|e| AppError::msg(format!("读取本地配置失败: {e}")))?;
        TvboxConfig::parse_json(&text)
    } else {
        Err(AppError::msg("订阅源不可刷新（粘贴的配置请删除后重新添加）"))
    }?;
    // 刷新合并：保留用户手工新增的站点/直播/解析（旧有新无的条目），
    // 并保留同名站点在设置页的停用状态，避免「刷新后自己加的源被覆盖」
    let cfg = merge_refreshed(sub.config.clone(), cfg);
    let updated = Subscription {
        updated_at: crate::storage::now(),
        config: cfg,
        ..sub
    };
    with_runtime(&state, |rt| {
        if let Some(s) = rt.subscriptions.iter_mut().find(|s| s.id == id) {
            *s = updated.clone();
        }
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await?;
    Ok(updated)
}

/// 刷新合并策略：
/// 1. 新配置里的同名站点保留用户在设置页做的 enabled 停用/启用状态；
/// 2. 旧配置里存在、新配置里没有的站点/直播/解析（用户新增或上游下架）原样保留；
/// 3. 其余以上游刷新结果为准。
fn merge_refreshed(old: TvboxConfig, mut new: TvboxConfig) -> TvboxConfig {
    let new_keys: std::collections::HashSet<String> =
        new.sites.iter().map(|s| s.key.clone()).collect();
    for s in new.sites.iter_mut() {
        if let Some(o) = old.sites.iter().find(|o| o.key == s.key) {
            if o.enabled.is_some() {
                s.enabled = o.enabled;
            }
        }
    }
    for o in old.sites.iter() {
        if !new_keys.contains(&o.key) {
            new.sites.push(o.clone());
        }
    }
    for l in old.lives.iter() {
        if !new.lives.iter().any(|n| n.name == l.name && n.url == l.url) {
            new.lives.push(l.clone());
        }
    }
    for p in old.parses.iter() {
        if !new.parses.iter().any(|n| n.name == p.name && n.url == p.url) {
            new.parses.push(p.clone());
        }
    }
    new
}

/// 设置页「影视源」站点启用开关：写入当前生效订阅的 config.sites[].enabled 并持久化
#[tauri::command]
pub async fn set_site_enabled(
    state: tauri::State<'_, AppState>,
    site_key: String,
    enabled: bool,
) -> AppResult<()> {
    with_runtime(&state, |rt| {
        let active_id = rt.active_id.clone();
        let sub = match rt
            .subscriptions
            .iter_mut()
            .find(|s| s.enabled && Some(s.id.as_str()) == active_id.as_deref())
        {
            Some(s) => s,
            None => rt
                .subscriptions
                .iter_mut()
                .find(|s| s.enabled)
                .ok_or_else(|| AppError::msg("没有启用的订阅"))?,
        };
        let site = sub
            .config
            .sites
            .iter_mut()
            .find(|s| s.key == site_key)
            .ok_or_else(|| AppError::msg("站点不存在"))?;
        site.enabled = Some(if enabled { 1 } else { 0 });
        crate::storage::save_all(&state.data_dir, rt)?;
        Ok(())
    })
    .await
}

/// 重新加载配置文件（subscriptions.json / settings.json），无需重启应用
#[tauri::command]
pub async fn reload_app_state(
    state: tauri::State<'_, AppState>,
) -> AppResult<serde_json::Value> {
    let rt = crate::storage::load_all(&state.data_dir)?;
    let s = crate::settings::load_settings(&state.data_dir);
    let n = rt.subscriptions.len();
    *state.runtime.lock().await = rt;
    if let Ok(mut cur) = state.settings.write() {
        *cur = s;
    }
    Ok(serde_json::json!({ "subscriptions": n }))
}

/// 检查更新：请求更新地址，支持 JSON {"version":"x.y.z","notes":"...","url":"下载页"}
/// 或纯文本版本号两种格式；与当前版本按数字段比较
#[tauri::command]
pub async fn check_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    update_url: Option<String>,
) -> AppResult<serde_json::Value> {
    let url = update_url
        .filter(|u| !u.trim().is_empty())
        .or_else(|| {
            state
                .settings
                .read()
                .ok()
                .map(|s| s.update_url.clone())
                .filter(|u| !u.trim().is_empty())
        })
        .ok_or_else(|| {
            AppError::msg("未配置更新地址：请到 设置 → 通用 → 更新地址 填写，或编辑 settings.json 的 update_url 字段")
        })?;
    let url = url.trim().to_string();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::msg("更新地址必须是 http(s) 链接"));
    }
    let current = app.package_info().version.to_string();
    let text = crate::http::fetch_text(
        &state.client,
        &url,
        &state.effective_ua(),
        &Default::default(),
        15,
    )
    .await?;
    let text = text.trim().to_string();
    let (latest, notes, download) = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => {
            let latest = v
                .get("version")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if latest.is_empty() {
                return Err(AppError::msg("更新清单缺少 version 字段"));
            }
            let notes = v
                .get("notes")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let download = v
                .get("url")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            (latest, notes, download)
        }
        Err(_) => (text.clone(), String::new(), String::new()),
    };
    let has_update = version_gt(&latest, &current);
    Ok(serde_json::json!({
        "current": current,
        "latest": latest,
        "hasUpdate": has_update,
        "notes": notes,
        "downloadUrl": download,
        "checkedFrom": url,
    }))
}

/// 版本号比较：按 '.' 分段数字比较，非数字段按字符串兜底
fn version_gt(a: &str, b: &str) -> bool {
    let pa: Vec<&str> = a.trim().trim_start_matches('v').split('.').collect();
    let pb: Vec<&str> = b.trim().trim_start_matches('v').split('.').collect();
    let n = pa.len().max(pb.len());
    for i in 0..n {
        let x = pa.get(i).copied().unwrap_or("0");
        let y = pb.get(i).copied().unwrap_or("0");
        match (x.parse::<i64>().ok(), y.parse::<i64>().ok()) {
            (Some(xi), Some(yi)) => {
                if xi != yi {
                    return xi > yi;
                }
            }
            _ => {
                if x != y {
                    return x > y;
                }
            }
        }
    }
    false
}

/// 用系统浏览器打开链接（下载页 / 更新地址等）
#[tauri::command]
pub async fn open_in_browser(app: tauri::AppHandle, url: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::msg(format!("打开链接失败: {e}")))?;
    Ok(())
}

/// 切换主窗口深/浅色（Windows 标题栏跟随）
#[tauri::command]
pub async fn set_theme(app: tauri::AppHandle, theme: String) -> AppResult<()> {
    use tauri::utils::Theme;
    let t = if theme == "light" { Theme::Light } else { Theme::Dark };
    if let Some(w) = app.get_webview_window("main") {
        w.set_theme(Some(t))
            .map_err(|e| AppError::msg(format!("设置窗口主题失败: {e}")))?;
    }
    Ok(())
}

// ---------------- 首页 / 分类 / 详情 ----------------

#[tauri::command]
pub async fn get_home_sections(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<HomeSectionData>> {
    let cfg = {
        let rt = state.runtime.lock().await;
        state.active_config(&rt)
    };
    let Some(cfg) = cfg else { return Ok(vec![]) };

    // 归一化 sections：缺失时回退到前 3 个 CMS 站点的最新列表
    let mut plan: Vec<(String, SiteConfig, Option<i64>)> = Vec::new();
    for sec in &cfg.ext.home.sections {
        let site = cfg
            .sites
            .iter()
            .find(|s| s.key == sec.site || s.name == sec.site);
        if let Some(site) = site {
            if site.is_cms() {
                plan.push((sec.title.clone(), site.clone(), sec.type_id));
            }
        }
    }
    if plan.is_empty() {
        for site in cfg.sites.iter().filter(|s| s.is_cms()).take(3) {
            plan.push((
                format!("{} · 最近更新", site.name),
                site.clone(),
                None,
            ));
        }
    }

    let client = state.client.clone();
    let ua = state.effective_ua();
    let tasks = plan
        .into_iter()
        .map(|(title, site, type_id)| {
            let client = client.clone();
            let ua = ua.clone();
            async move {
                let items = match tokio::time::timeout(
                    std::time::Duration::from_secs(12),
                    crate::cms::fetch_videolist(&client, &ua, &site, type_id.unwrap_or(0), 1),
                )
                .await
                {
                    Ok(Ok(p)) => p.items.into_iter().take(12).collect::<Vec<_>>(),
                    _ => vec![],
                };
                HomeSectionData {
                    title,
                    site_key: site.key.clone(),
                    site_name: site.name.clone(),
                    items,
                }
            }
        })
        .collect::<Vec<_>>();
    let mut out: Vec<HomeSectionData> =
        futures::future::join_all(tasks).await.into_iter().collect();
    out.retain(|s| !s.items.is_empty());
    Ok(out)
}

#[tauri::command]
pub async fn get_categories(
    state: tauri::State<'_, AppState>,
    site_key: String,
) -> AppResult<Vec<CmsClass>> {
    let cfg = {
        let rt = state.runtime.lock().await;
        state.active_config(&rt)
    };
    let site = cfg
        .as_ref()
        .and_then(|c| c.sites.iter().find(|s| s.key == site_key))
        .cloned()
        .ok_or_else(|| AppError::msg("站点不存在"))?;
    if !site.is_cms() {
        return Err(AppError::msg("该站点不支持分类浏览"));
    }
    crate::cms::fetch_categories(&state.client, &state.effective_ua(), &site).await
}

#[tauri::command]
pub async fn get_videolist(
    state: tauri::State<'_, AppState>,
    site_key: String,
    type_id: i64,
    page: i64,
) -> AppResult<PagedVideos> {
    let cfg = {
        let rt = state.runtime.lock().await;
        state.active_config(&rt)
    };
    let site = cfg
        .as_ref()
        .and_then(|c| c.sites.iter().find(|s| s.key == site_key))
        .cloned()
        .ok_or_else(|| AppError::msg("站点不存在"))?;
    if !site.is_cms() {
        return Err(AppError::msg("该站点不支持列表浏览"));
    }
    crate::cms::fetch_videolist(&state.client, &state.effective_ua(), &site, type_id, page).await
}

#[tauri::command]
pub async fn get_detail(
    state: tauri::State<'_, AppState>,
    site_key: String,
    vod_id: i64,
) -> AppResult<VideoDetail> {
    let cfg = {
        let rt = state.runtime.lock().await;
        state.active_config(&rt)
    };
    let site = cfg
        .as_ref()
        .and_then(|c| c.sites.iter().find(|s| s.key == site_key))
        .cloned()
        .ok_or_else(|| AppError::msg("站点不存在"))?;
    if !site.is_cms() {
        return Err(AppError::msg("网页规则站暂不支持详情页，仅支持搜索"));
    }
    crate::cms::fetch_detail(&state.client, &state.effective_ua(), &site, vod_id).await
}

#[tauri::command]
pub async fn aggregate_search(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    wd: String,
) -> AppResult<Vec<SearchResultGroup>> {
    crate::search::aggregate_search(&app, &state, &wd).await
}

// ---------------- 直播 ----------------

#[tauri::command]
pub async fn get_live_channels(
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<LiveChannelGroup>> {
    crate::live::load_live_groups(&state).await
}

#[tauri::command]
pub async fn speed_test_lines(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    urls: Vec<String>,
) -> AppResult<Vec<LineSpeed>> {
    Ok(crate::live::speed_test_lines(&app, &state, urls).await)
}

#[tauri::command]
pub async fn resolve_room_url(_app: tauri::AppHandle, url: String) -> AppResult<String> {
    crate::room::resolve_room_url(&url).await
}

// ---------------- 收藏 / 历史 / 进度 ----------------

#[tauri::command]
pub async fn add_favorite(
    state: tauri::State<'_, AppState>,
    item: FavoriteItem,
) -> AppResult<()> {
    let mut items = crate::storage::get_favorites(&state.data_dir)?;
    if !items
        .iter()
        .any(|f| f.site_key == item.site_key && f.vod_id == item.vod_id)
    {
        items.insert(0, item);
        crate::storage::save_favorites(&state.data_dir, &items)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_favorite(
    state: tauri::State<'_, AppState>,
    site_key: String,
    vod_id: i64,
) -> AppResult<()> {
    let mut items = crate::storage::get_favorites(&state.data_dir)?;
    items.retain(|f| !(f.site_key == site_key && f.vod_id == vod_id));
    crate::storage::save_favorites(&state.data_dir, &items)?;
    Ok(())
}

#[tauri::command]
pub async fn get_favorites(state: tauri::State<'_, AppState>) -> AppResult<Vec<FavoriteItem>> {
    crate::storage::get_favorites(&state.data_dir)
}

#[tauri::command]
pub async fn save_progress(
    state: tauri::State<'_, AppState>,
    item: HistoryItem,
) -> AppResult<()> {
    let mut items = crate::storage::get_history(&state.data_dir)?;
    let mut item = item;
    item.updated_at = crate::storage::now();
    items.retain(|h| !h.same_video(&item));
    items.insert(0, item);
    items.truncate(200);
    crate::storage::save_history(&state.data_dir, &items)?;
    Ok(())
}

#[tauri::command]
pub async fn get_history(state: tauri::State<'_, AppState>) -> AppResult<Vec<HistoryItem>> {
    crate::storage::get_history(&state.data_dir)
}

#[tauri::command]
pub async fn remove_history(
    state: tauri::State<'_, AppState>,
    site_key: String,
    vod_id: i64,
) -> AppResult<()> {
    let mut items = crate::storage::get_history(&state.data_dir)?;
    items.retain(|h| !(h.site_key == site_key && h.vod_id == vod_id));
    crate::storage::save_history(&state.data_dir, &items)?;
    Ok(())
}

#[tauri::command]
pub async fn clear_history(state: tauri::State<'_, AppState>) -> AppResult<()> {
    crate::storage::save_history(&state.data_dir, &[])?;
    Ok(())
}

// ---------------- 外部播放器 ----------------

/// 用本机播放器打开直链，返回实际使用的播放器名。
/// 优先用设置页配置的命令模板（{url} 占位），否则自动探测。
#[tauri::command]
pub async fn open_external_player(
    state: tauri::State<'_, AppState>,
    url: String,
) -> AppResult<String> {
    let tpl = state
        .settings
        .read()
        .ok()
        .map(|s| s.ext_player.clone())
        .unwrap_or_default();
    crate::external::open_with_player(&url, Some(&tpl))
}

/// 检测本机已安装的播放器（设置页「检测本机播放器」按钮）
#[tauri::command]
pub async fn detect_players() -> Vec<String> {
    crate::external::detect_players()
}

// ---------------- 应用设置 / 关于 ----------------

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, AppState>) -> AppResult<crate::settings::AppSettings> {
    Ok(state
        .settings
        .read()
        .map(|s| s.clone())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn save_settings(
    state: tauri::State<'_, AppState>,
    settings: crate::settings::AppSettings,
) -> AppResult<crate::settings::AppSettings> {
    let s = settings.sanitized();
    crate::settings::save_settings(&state.data_dir, &s)?;
    if let Ok(mut cur) = state.settings.write() {
        *cur = s.clone();
    }
    Ok(s)
}

/// 版本 / 数据目录 / 运行环境（关于区展示）；portable = 是否便携模式（exe 同目录 data 文件夹）
#[tauri::command]
pub async fn get_app_info(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> AppResult<serde_json::Value> {
    let version = app.package_info().version.to_string();
    Ok(serde_json::json!({
        "version": version,
        "dataDir": state.data_dir.to_string_lossy(),
        "portable": state.portable,
        "os": std::env::consts::OS,
        "runtime": "Tauri 2 · Rust · React",
    }))
}

/// 在系统文件管理器中打开数据目录
#[tauri::command]
pub async fn open_data_dir(state: tauri::State<'_, AppState>) -> AppResult<()> {
    let dir = &state.data_dir;
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("explorer").arg(dir).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(dir).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(dir).spawn();
    spawned.map_err(|e| AppError::msg(format!("打开数据目录失败: {e}")))?;
    Ok(())
}

// ---------------- 解析接口 / AI 总结 ----------------

/// 用解析接口解析网页线路 -> 直链（设置页「解析接口」的试测 & 播放兜底）
#[tauri::command]
pub async fn resolve_parse(
    state: tauri::State<'_, AppState>,
    parse_url: String,
    page_url: String,
) -> AppResult<String> {
    crate::parse::resolve_parse(&state.client, &state.effective_ua(), &parse_url, &page_url).await
}

/// AI 总结本集（OpenAI 兼容接口，只发送元信息，不发送播放地址）
#[tauri::command]
pub async fn ai_summary(
    state: tauri::State<'_, AppState>,
    name: String,
    episode: String,
    type_name: String,
    year: String,
    actor: String,
    content: String,
) -> AppResult<String> {
    let ai = state
        .settings
        .read()
        .map(|s| s.ai.clone())
        .unwrap_or_default();
    crate::ai::ai_summary(&state.client, &ai, &name, &episode, &type_name, &year, &actor, &content).await
}

// ---------------- 嗅探 ----------------

#[tauri::command]
pub async fn sniff_page(
    state: tauri::State<'_, AppState>,
    url: String,
) -> AppResult<Vec<String>> {
    crate::sniffer::sniff_page(&state.client, &state.effective_ua(), &url).await
}

#[tauri::command]
pub async fn open_sniffer(_app: tauri::AppHandle, url: String) -> AppResult<()> {
    crate::sniffer::open_sniffer_window(&_app, &url)
}

#[tauri::command]
pub async fn close_sniffer(app: tauri::AppHandle) -> AppResult<()> {
    crate::sniffer::close_sniffer_window(&app);
    Ok(())
}
