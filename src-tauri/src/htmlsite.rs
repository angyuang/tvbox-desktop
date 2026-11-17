// 网页规则站（type=1/"html"）搜索：rules 里的 CSS 选择器抓取，仅支持搜索
use crate::error::{AppError, AppResult};
use crate::http::fetch_text;
use crate::models::{SiteConfig, VideoCard};
use scraper::{Html, Selector};

/// 简易 hash（html 站无数字 vod_id，用链接 hash 充当）
fn link_hash(s: &str) -> i64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    (h & 0x7fff_ffff_ffff_ffff) as i64
}

fn first_text(el: &scraper::ElementRef, selector: &str) -> String {
    Selector::parse(selector)
        .ok()
        .and_then(|sel| el.select(&sel).next())
        .map(|n| {
            if selector.contains("img") {
                // 图片选择器优先取 src/data-src
                let node = n.value();
                for attr in ["src", "data-src", "data-original", "data-lazy-src"] {
                    if let Some(v) = node.attr(attr) {
                        return v.to_string();
                    }
                }
                String::new()
            } else {
                n.text().collect::<Vec<_>>().join("").trim().to_string()
            }
        })
        .unwrap_or_default()
}

fn first_attr(el: &scraper::ElementRef, selector: &str, attr: &str) -> String {
    Selector::parse(selector)
        .ok()
        .and_then(|sel| el.select(&sel).next())
        .and_then(|n| n.value().attr(attr).map(|s| s.to_string()))
        .unwrap_or_default()
}

fn abs_url(base: &str, link: &str) -> String {
    if link.starts_with("http://") || link.starts_with("https://") {
        return link.to_string();
    }
    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(joined) = base_url.join(link) {
            return joined.to_string();
        }
    }
    link.to_string()
}

pub async fn search_html_site(
    client: &reqwest::Client,
    ua: &str,
    site: &SiteConfig,
    wd: &str,
) -> AppResult<Vec<VideoCard>> {
    let rules = site
        .rules
        .as_ref()
        .ok_or_else(|| AppError::msg("网页站缺少 rules 规则"))?;
    let api = site.api.trim();
    let search_tpl = if api.contains("{wd}") {
        api.to_string()
    } else if api.contains('?') || api.ends_with('=') {
        format!("{api}{{wd}}")
    } else {
        format!("{api}?wd={{wd}}")
    };
    let url = search_tpl.replace("{wd}", &crate::cms::url_encode(wd));
    let html_text = fetch_text(client, &url, ua, &site.header.clone(), site.timeout.unwrap_or(15)).await?;
    let doc = Html::parse_document(&html_text);
    let list_sel = Selector::parse(&rules.list)
        .map_err(|_| AppError::msg(format!("rules.list 选择器无效: {}", rules.list)))?;

    let mut cards = Vec::new();
    for item in doc.select(&list_sel) {
        let name = first_text(&item, &rules.name);
        let link = first_attr(&item, &rules.link, "href");
        let pic = if rules.pic.is_empty() {
            String::new()
        } else {
            first_text(&item, &rules.pic)
        };
        let remarks = if rules.remarks.is_empty() {
            String::new()
        } else {
            first_text(&item, &rules.remarks)
        };
        if name.is_empty() || link.is_empty() {
            continue;
        }
        let link = abs_url(&url, &link);
        cards.push(VideoCard {
            site_key: site.key.clone(),
            site_name: site.name.clone(),
            vod_id: link_hash(&link),
            name,
            pic,
            remarks,
            time: String::new(),
            score: String::new(),
        });
    }
    Ok(cards)
}
