// 简易嗅探：
// 1) HTML 直取：reqwest 抓页面正则提取 m3u8/mp4 直链（含一层 iframe）
// 2) Webview hook：独立窗口注入 JS hook fetch/XHR/media.src，
//    捕获后以 sniff://found?u=... 触发导航，on_navigation 拦截并 emit 给主窗口
//
// 反"弹窗播放"：嗅探窗口一旦捕获到媒体直链（无论 hook 上报还是页面自己往媒体地址跳），
// 都立刻 emit 直链并关闭嗅探窗口、阻断原导航——窗口永远不会自己开始播视频。
use crate::error::{AppError, AppResult};
use crate::http::fetch_text;
use regex::Regex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SNIFF_LABEL: &str = "sniffer";

const MEDIA_EXT: &[&str] = &[".m3u8", ".mp4", ".flv", ".mkv"];

pub fn is_media_url(u: &str) -> bool {
    let lower = u.to_lowercase();
    MEDIA_EXT.iter().any(|ext| lower.contains(ext))
}

const SNIFF_JS: &str = r#"
(function () {
  if (window.__TVBOX_SNIFF__) return;
  window.__TVBOX_SNIFF__ = true;
  var seen = {};
  function report(u) {
    try {
      if (!u || typeof u !== 'string') return;
      if (!/^https?:\/\//i.test(u)) return;
      if (!/\.(m3u8|mp4|flv|mkv)(\?|#|$)/i.test(u)) return;
      if (seen[u]) return;
      seen[u] = 1;
      location.href = 'sniff://found?u=' + encodeURIComponent(u);
    } catch (e) {}
  }
  try {
    var of = window.fetch;
    if (of) {
      window.fetch = function () {
        var args = arguments;
        var p = of.apply(this, args);
        try {
          var u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          p.then(function (r) { report((r && r.url) || u); })['catch'](function () {});
        } catch (e) {}
        return p;
      };
    }
    var ox = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { report(String(u)); return ox.apply(this, arguments); };
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set: function (v) { report(String(v)); desc.set.call(this, v); },
        get: desc.get,
        configurable: true
      });
    }
    document.addEventListener('DOMContentLoaded', function () {
      try {
        document.querySelectorAll('video,source,a').forEach(function (el) {
          report(el.src || el.getAttribute('src') || el.href || '');
        });
        // 直接从页面源码里捞一遍
        var m = document.documentElement.outerHTML.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
        if (m) m.forEach(report);
      } catch (e) {}
    });
  } catch (e) {}
})();
"#;

/// 把 JS 转义 / HTML 实体还原成普通 URL 文本，提升直链提取命中率
fn unescape_for_extract(html: &str) -> String {
    html.replace("\\u002F", "/")
        .replace("\\u002f", "/")
        .replace("\\u0026", "&")
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("&#x2F;", "/")
        .replace("&#47;", "/")
}

/// 若候选直链是解析/中转页包裹（?url=https%3A%2F%2Fcdn%2Fa.m3u8），解出内层真实直链。
/// query_pairs 返回的值已经过百分号解码，无需再手动 decode。
fn unwrap_wrapped(u: &str) -> Option<String> {
    let parsed = url::Url::parse(u).ok()?;
    let direct = Regex::new(r#"https?://[^\s"'<>\\]+?\.(?:m3u8|mp4|flv|mkv)(?:\?[^\s"'<>\\]*)?"#)
        .expect("static regex");
    for (_, v) in parsed.query_pairs() {
        let val = v.trim();
        if let Some(m) = direct.find(val) {
            return Some(m.as_str().to_string());
        }
    }
    None
}

/// 从 HTML 文本提取媒体直链：解转义 -> 正则 -> 解包裹 -> 去重 -> 排序（m3u8 优先）
fn extract_links(html: &str) -> Vec<String> {
    let text = unescape_for_extract(html);
    let re = Regex::new(
        r#"https?://[^\s"'<>()\\]+?\.(?:m3u8|mp4|flv|mkv)(?:\?[^\s"'<>()\\]*)?"#,
    )
    .expect("static regex");
    let mut out: Vec<String> = Vec::new();
    let push = |u: String, out: &mut Vec<String>| {
        let u = unwrap_wrapped(&u).unwrap_or(u);
        if is_media_url(&u) && !out.contains(&u) {
            out.push(u);
        }
    };
    for m in re.find_iter(&text) {
        push(m.as_str().to_string(), &mut out);
    }
    // m3u8 排前面（同页同时出现 m3u8 与 mp4 广告时优先 HLS 直链）
    out.sort_by_key(|u| {
        let lower = u.to_lowercase();
        if lower.contains(".m3u8") {
            0
        } else if lower.contains(".mp4") {
            1
        } else {
            2
        }
    });
    out
}

fn extract_iframes(html: &str, base: &str) -> Vec<String> {
    let re = Regex::new(r#"<iframe[^>]+src=["']([^"']+)["']"#).expect("static regex");
    let mut out: Vec<String> = Vec::new();
    for m in re.captures_iter(html) {
        let link = m.get(1).map(|x| x.as_str()).unwrap_or("");
        if link.starts_with("http://") || link.starts_with("https://") {
            out.push(link.to_string());
        } else if let Ok(b) = url::Url::parse(base) {
            if let Ok(j) = b.join(link) {
                out.push(j.to_string());
            }
        }
    }
    out.truncate(3); // 最多追踪 3 个 iframe
    out
}

/// HTML 直取嗅探（主通道，纯 Rust 稳定可用）
pub async fn sniff_page(
    client: &reqwest::Client,
    ua: &str,
    page_url: &str,
) -> AppResult<Vec<String>> {
    let html = fetch_text(client, page_url, ua, &Default::default(), 15).await?;
    let mut found = extract_links(&html);
    for iframe in extract_iframes(&html, page_url) {
        if found.len() >= 10 {
            break;
        }
        if let Ok(sub) = fetch_text(client, &iframe, ua, &Default::default(), 10).await {
            for u in extract_links(&sub) {
                if !found.contains(&u) {
                    found.push(u);
                }
            }
        }
    }
    Ok(found)
}

/// 打开嗅探窗口（Webview hook 通道）。窗口捕获到直链或检测到媒体跳转时自动关闭。
pub fn open_sniffer_window(
    app: &tauri::AppHandle,
    page_url: &str,
) -> AppResult<()> {
    let parsed: tauri::Url = page_url
        .parse()
        .map_err(|_| AppError::msg("不是合法的网页地址"))?;
    // 若已有嗅探窗口则先关闭
    if let Some(old) = app.get_webview_window(SNIFF_LABEL) {
        let _ = old.close();
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    let app_for_nav = app.clone();
    WebviewWindowBuilder::new(app, SNIFF_LABEL, WebviewUrl::External(parsed))
        .title("线路嗅探中…（找到直链后会自动返回）")
        .inner_size(1100.0, 720.0)
        .initialization_script(SNIFF_JS)
        .on_navigation(move |nav_url| {
            // hook 上报通道：sniff://found?u=...
            if nav_url.scheme() == "sniff" {
                let found = nav_url
                    .query_pairs()
                    .find(|(k, _)| k == "u")
                    .map(|(_, v)| v.to_string())
                    .unwrap_or_default();
                if !found.is_empty() {
                    let _ = app_for_nav.emit("sniff:found", found);
                    // 找到直链：自动关闭嗅探窗口（"会自动返回"）
                    if let Some(w) = app_for_nav.get_webview_window(SNIFF_LABEL) {
                        let _ = w.close();
                    }
                }
                return false; // 阻止真实导航
            }
            // 页面自己往媒体地址跳（这就是"弹出新窗口开始播放"的来源）：
            // 拦下导航、当作嗅探结果上报，并关闭嗅探窗口
            let s = nav_url.as_str();
            if is_media_url(s) && nav_url.scheme().starts_with("http") {
                let _ = app_for_nav.emit("sniff:found", s.to_string());
                if let Some(w) = app_for_nav.get_webview_window(SNIFF_LABEL) {
                    let _ = w.close();
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| AppError::msg(format!("嗅探窗口创建失败: {e}（部分系统 WebView 不支持，可改用 HTML 直取嗅探）")))?;
    Ok(())
}

pub fn close_sniffer_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(SNIFF_LABEL) {
        let _ = w.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_basic() {
        let html = r#"var url = "https://vip.dytt-cdn.com/2020/1/index.m3u8?sign=abc";"#;
        let links = extract_links(html);
        assert_eq!(links, vec!["https://vip.dytt-cdn.com/2020/1/index.m3u8?sign=abc"]);
    }

    #[test]
    fn test_extract_unescape() {
        let html = r#"var u = "https:\/\/cdn.a.com\/v\/1.m3u8";"#;
        let links = extract_links(html);
        assert!(links[0].contains("https://cdn.a.com/v/1.m3u8"));
        let html2 = r#""url":"https:\u002F\u002Fx.com\u002Fa.mp4""#;
        assert!(extract_links(html2)[0].ends_with(".mp4"));
    }

    #[test]
    fn test_extract_wrapped() {
        let html = r#"<script>var p="https://jx.x.com/?url=https%3A%2F%2Fcdn.com%2Fa.m3u8";</script>"#;
        let links = extract_links(html);
        assert!(links[0].ends_with("a.m3u8"));
        assert!(links[0].starts_with("https://cdn.com/a.m3u8"));
    }

    #[test]
    fn test_extract_sorted() {
        let html = "https://a.com/x.mp4 https://b.com/y.m3u8";
        let links = extract_links(html);
        assert_eq!(links[0], "https://b.com/y.m3u8");
    }

    #[test]
    fn test_is_media() {
        assert!(is_media_url("https://a.com/1.M3U8"));
        assert!(!is_media_url("https://a.com/page.html"));
    }
}
