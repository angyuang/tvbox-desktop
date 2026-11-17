// 简易嗅探：
// 1) HTML 直取：reqwest 抓页面正则提取 m3u8/mp4 直链（含一层 iframe）
// 2) Webview hook：独立窗口注入 JS hook fetch/XHR/media.src，
//    捕获后以 sniff://found?u=... 触发导航，on_navigation 拦截并 emit 给主窗口
use crate::error::{AppError, AppResult};
use crate::http::fetch_text;
use regex::Regex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SNIFF_LABEL: &str = "sniffer";

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

/// 从 HTML 文本提取媒体直链
fn extract_links(html: &str) -> Vec<String> {
    let re = Regex::new(r#"https?://[^\s"'<>()\\]+?\.(?:m3u8|mp4|flv|mkv)(?:\?[^\s"'<>()\\]*)?"#)
        .expect("static regex");
    let mut out: Vec<String> = Vec::new();
    for m in re.find_iter(html) {
        let u = m.as_str().to_string();
        if !out.contains(&u) {
            out.push(u);
        }
    }
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

/// 打开嗅探窗口（Webview hook 通道）
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
            if nav_url.scheme() == "sniff" {
                let found = nav_url
                    .query_pairs()
                    .find(|(k, _)| k == "u")
                    .map(|(_, v)| v.to_string())
                    .unwrap_or_default();
                if !found.is_empty() {
                    let _ = app_for_nav.emit("sniff:found", found);
                }
                return false; // 阻止真实导航
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
