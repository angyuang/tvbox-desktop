// 苹果CMS v10 JSON 接口客户端
// 支持：分类、分页列表、详情、搜索、播放地址解析、API 占位符模板、站点级 headers
use crate::error::{AppError, AppResult};
use crate::http::fetch_text;
use crate::models::{
    CmsClass, CmsListResponse, CmsVod, Episode, PagedVideos, PlaySource, SiteConfig, VideoCard,
    VideoDetail,
};
use std::collections::HashMap;

const DEFAULT_TIMEOUT: u64 = 15;

fn site_headers(site: &SiteConfig) -> HashMap<String, String> {
    let mut h = site.header.clone();
    h.entry("Referer".into()).or_insert_with(|| {
        // 从 api 推断站点 Referer，规避部分防盗链
        if let Some(idx) = site.api.find("://") {
            let rest = &site.api[idx + 3..];
            let host = rest.split('/').next().unwrap_or("");
            if !host.is_empty() {
                return format!("https://{host}/");
            }
        }
        String::new()
    });
    h.retain(|_, v| !v.is_empty());
    h
}

fn timeout_of(site: &SiteConfig) -> u64 {
    site.timeout.unwrap_or(DEFAULT_TIMEOUT)
}

/// 解析 api 地址：返回 (基础地址, 是否占位符模板)
fn split_template(api: &str) -> (String, bool) {
    let has = api.contains("{ac}")
        || api.contains("{wd}")
        || api.contains("{pg}")
        || api.contains("{t}")
        || api.contains("{ids}");
    (api.to_string(), has)
}

fn apply_template(tpl: &str, ac: &str, t: &str, pg: &str, wd: &str, ids: &str) -> String {
    tpl.replace("{ac}", ac)
        .replace("{t}", t)
        .replace("{pg}", pg)
        .replace("{wd}", wd)
        .replace("{ids}", ids)
}

fn join_query(base: &str, kv: &[(&str, String)]) -> String {
    let sep = if base.contains('?') { '&' } else { '?' };
    let qs: Vec<String> = kv
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    if qs.is_empty() {
        base.to_string()
    } else {
        format!("{base}{sep}{}", qs.join("&"))
    }
}

/// 手写 percent-encode（避免额外依赖；reqwest 内部还会兜底编码一次）
pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.as_bytes() {
        let c = *b as char;
        let unreserved = c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~');
        if unreserved {
            out.push(c);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 构造 CMS 请求 URL。ac: "list" | "videolist"
pub fn build_cms_url(site: &SiteConfig, ac: &str, t: i64, pg: i64, wd: &str, ids: &str) -> String {
    let (tpl, is_tpl) = split_template(&site.api);
    let enc_wd = url_encode(wd);
    if is_tpl {
        return apply_template(&tpl, ac, &t.to_string(), &pg.to_string(), &enc_wd, ids);
    }
    let mut kv: Vec<(&str, String)> = vec![("ac", ac.to_string())];
    if ac == "videolist" {
        if t > 0 {
            kv.push(("t", t.to_string()));
        }
        kv.push(("pg", pg.to_string()));
        if !wd.is_empty() {
            kv.push(("wd", enc_wd));
        }
        if !ids.is_empty() {
            kv.push(("ids", ids.to_string()));
        }
    }
    join_query(&tpl, &kv)
}

async fn fetch_cms(
    client: &reqwest::Client,
    ua: &str,
    site: &SiteConfig,
    url: &str,
) -> AppResult<CmsListResponse> {
    let text = fetch_text(client, url, ua, &site_headers(site), timeout_of(site)).await?;
    let trimmed = text.trim_start();
    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        return Err(AppError::Parse(format!(
            "站点 {} 返回非 JSON（可能接口失效）",
            site.name
        )));
    }
    let parse_err = |e: serde_json::Error| {
        AppError::Parse(format!("站点 {} 响应解析失败: {e}", site.name))
    };
    match serde_json::from_str::<CmsListResponse>(&text) {
        Ok(r) => Ok(r),
        Err(e) => {
            // 宽松兜底：部分站点会包一层 JSONP / 前后附加提示文本 / 尾部分号，
            // 截取最外层大括号（中括号）再试一次
            let start = text.find('{').or_else(|| text.find('['));
            let end = text.rfind('}').or_else(|| text.rfind(']'));
            if let (Some(a), Some(b)) = (start, end) {
                if a < b {
                    if let Ok(r) = serde_json::from_str::<CmsListResponse>(&text[a..=b]) {
                        return Ok(r);
                    }
                }
            }
            Err(parse_err(e))
        }
    }
}

fn vod_to_card(site: &SiteConfig, v: CmsVod) -> VideoCard {
    VideoCard {
        site_key: site.key.clone(),
        site_name: site.name.clone(),
        vod_id: v.vod_id,
        name: v.vod_name,
        pic: v.vod_pic,
        remarks: v.vod_remarks,
        time: v.vod_time,
    }
}

pub async fn fetch_categories(
    client: &reqwest::Client,
    ua: &str,
    site: &SiteConfig,
) -> AppResult<Vec<CmsClass>> {
    if !site.is_cms() {
        return Err(AppError::msg("该站点不是 CMS 类型"));
    }
    let url = build_cms_url(site, "list", 0, 1, "", "");
    let resp = fetch_cms(client, ua, site, &url).await?;
    if resp.class.is_empty() {
        // 部分 CMS list 接口为空时回退 videolist 带回 class
        let url2 = build_cms_url(site, "videolist", 0, 1, "", "");
        let resp2 = fetch_cms(client, ua, site, &url2).await?;
        if resp2.class.is_empty() {
            return Err(AppError::msg("站点未返回分类信息"));
        }
        return Ok(resp2.class);
    }
    Ok(resp.class)
}

pub async fn fetch_videolist(
    client: &reqwest::Client,
    ua: &str,
    site: &SiteConfig,
    type_id: i64,
    page: i64,
) -> AppResult<PagedVideos> {
    let url = build_cms_url(site, "videolist", type_id, page, "", "");
    let resp = fetch_cms(client, ua, site, &url).await?;
    Ok(PagedVideos {
        page: resp.page,
        pagecount: resp.pagecount,
        total: resp.total,
        items: resp.list.into_iter().map(|v| vod_to_card(site, v)).collect(),
    })
}

pub async fn search_cms(
    client: &reqwest::Client,
    ua: &str,
    site: &SiteConfig,
    wd: &str,
) -> AppResult<Vec<VideoCard>> {
    let url = build_cms_url(site, "videolist", 0, 1, wd, "");
    let resp = fetch_cms(client, ua, site, &url).await?;
    Ok(resp.list.into_iter().map(|v| vod_to_card(site, v)).collect())
}

pub async fn fetch_detail(
    client: &reqwest::Client,
    ua: &str,
    site: &SiteConfig,
    vod_id: i64,
) -> AppResult<VideoDetail> {
    let url = build_cms_url(site, "videolist", 0, 1, "", &vod_id.to_string());
    let resp = fetch_cms(client, ua, site, &url).await?;
    let vod: CmsVod = resp
        .list
        .into_iter()
        .find(|v| v.vod_id == vod_id)
        .ok_or_else(|| AppError::msg("详情未找到该视频"))?;
    let sources = parse_play_urls(&vod.vod_play_from, &vod.vod_play_url);
    Ok(VideoDetail {
        site_key: site.key.clone(),
        site_name: site.name.clone(),
        vod_id: vod.vod_id,
        name: vod.vod_name,
        pic: vod.vod_pic,
        remarks: vod.vod_remarks,
        content: vod.vod_content,
        year: vod.vod_year,
        area: vod.vod_area,
        actor: vod.vod_actor,
        director: vod.vod_director,
        score: vod
            .vod_score
            .map(|v| match v {
                serde_json::Value::String(s) => s,
                other => other.to_string(),
            })
            .unwrap_or_default(),
        type_name: vod.type_name,
        sources,
    })
}

/// 判定是否网页线路（非 m3u8/mp4/flv 等直链）
fn is_web_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    let direct = [".m3u8", ".mp4", ".flv", ".mkv", ".ts", ".avi", ".mp3", ".aac"];
    direct.iter().any(|ext| lower.contains(ext))
}

/// 解析 vod_play_from / vod_play_url
/// from: "dbm3u8$$$ydm3u8"；url: "第01集$https://a.m3u8#第02集$https://b.m3u8$$$第01集$https://c.m3u8"
pub fn parse_play_urls(from: &str, urls: &str) -> Vec<PlaySource> {
    let url_groups: Vec<&str> = urls.split("$$$").collect();
    let from_names: Vec<&str> = if from.is_empty() {
        vec![]
    } else {
        from.split("$$$").collect()
    };
    if url_groups.is_empty() {
        return vec![];
    }
    let mut sources = Vec::with_capacity(url_groups.len());
    for (gi, group) in url_groups.iter().enumerate() {
        let name = from_names
            .get(gi)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("线路{}", gi + 1));
        let mut episodes = Vec::new();
        for (ei, ep) in group.split('#').enumerate() {
            let ep = ep.trim();
            if ep.is_empty() {
                continue;
            }
            let (name, url) = match ep.split_once('$') {
                Some((n, u)) => (n.trim().to_string(), u.trim().to_string()),
                None => (format!("第{}集", ei + 1), ep.to_string()),
            };
            if url.is_empty() {
                continue;
            }
            // 先计算 is_web，再移动 url 进结构体（避免 borrow after move）
            let is_web = !is_web_url(&url);
            episodes.push(Episode {
                name,
                url,
                is_web,
            });
        }
        if !episodes.is_empty() {
            sources.push(PlaySource { name, episodes });
        }
    }
    sources
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_play_urls() {
        let from = "dbm3u8$$$web";
        let urls = "第01集$https://a.com/1.m3u8#第02集$https://a.com/2.m3u8$$$第01集$https://a.com/play/1";
        let sources = parse_play_urls(from, urls);
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].name, "dbm3u8");
        assert_eq!(sources[0].episodes.len(), 2);
        assert!(!sources[0].episodes[0].is_web);
        assert!(sources[1].episodes[0].is_web);
    }

    #[test]
    fn test_build_url_plain() {
        let mut site = SiteConfig::default();
        site.api = "https://x.com/api.php/provide/vod".into();
        let u = build_cms_url(&site, "videolist", 6, 2, "", "");
        assert_eq!(u, "https://x.com/api.php/provide/vod?ac=videolist&t=6&pg=2");
        let u2 = build_cms_url(&site, "videolist", 0, 1, "海贼", "");
        assert_eq!(
            u2,
            "https://x.com/api.php/provide/vod?ac=videolist&pg=1&wd=%E6%B5%B7%E8%B4%BC"
        );
    }

    #[test]
    fn test_build_url_template() {
        let mut site = SiteConfig::default();
        site.api = "https://x.com/vod?ac={ac}&t={t}&pg={pg}&wd={wd}&ids={ids}".into();
        let u = build_cms_url(&site, "list", 0, 1, "", "");
        assert_eq!(u, "https://x.com/vod?ac=list&t=0&pg=1&wd=&ids=");
    }
}
