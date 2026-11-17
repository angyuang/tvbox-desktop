// HTTP 抓取：统一 UA / 超时 / 编码兜底（GBK 站点常见）。UA 由调用方传入（设置页可自定义）
use crate::error::{AppError, AppResult};
use reqwest::Client;

pub async fn fetch_bytes(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<Vec<u8>> {
    let mut req = client
        .get(url)
        .header("User-Agent", ua)
        .timeout(std::time::Duration::from_secs(timeout_secs));
    for (k, v) in extra_headers {
        if !k.is_empty() {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Http(format!("{url} -> {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Http(format!(
            "{url} -> HTTP {}",
            resp.status()
        )));
    }
    Ok(resp.bytes().await.map_err(|e| AppError::Http(e.to_string()))?.to_vec())
}

/// 抓取并解码为文本：优先按 Content-Type charset，否则 utf-8 失败时回退 GBK
pub async fn fetch_text(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<String> {
    let mut req = client
        .get(url)
        .header("User-Agent", ua)
        .timeout(std::time::Duration::from_secs(timeout_secs));
    for (k, v) in extra_headers {
        if !k.is_empty() {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Http(format!("{url} -> {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Http(format!(
            "{url} -> HTTP {}",
            resp.status()
        )));
    }
    let charset = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|ct| {
            ct.split(';')
                .rev()
                .find_map(|p| {
                    let p = p.trim();
                    p.strip_prefix("charset=").map(|s| s.trim_matches('"').to_lowercase())
                })
                .filter(|s| !s.is_empty() && s != "utf-8" && s != "utf8")
        });
    let bytes = resp.bytes().await.map_err(|e| AppError::Http(e.to_string()))?;
    if let Some(label) = charset {
        let (text, _, _) = encoding_rs::Encoding::for_label(label.as_bytes())
            .unwrap_or(encoding_rs::UTF_8)
            .decode(&bytes);
        return Ok(text.into_owned());
    }
    match std::str::from_utf8(&bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => {
            let (text, _, _) = encoding_rs::GBK.decode(&bytes);
            Ok(text.into_owned())
        }
    }
}

