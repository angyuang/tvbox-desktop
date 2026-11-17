// HTTP 抓取：统一 UA / 超时 / 编码兜底（GBK 站点常见）。UA 由调用方传入（设置页可自定义）
// 网络层加固：错误分类（超时/连接/解码）、解压失败自动用 identity 重试一次、BOM 清理
use crate::error::{AppError, AppResult};
use reqwest::Client;

/// 把 reqwest 错误翻译成用户能看懂的分类，方便区分「站点失效」还是「软件问题」
fn classify(url: &str, e: &reqwest::Error) -> String {
    let prefix = format!("{url} -> ");
    if e.is_timeout() {
        format!("{prefix}请求超时（站点无响应，可能已失效或网络不通）")
    } else if e.is_decode() {
        format!("{prefix}响应解码失败（返回数据异常，多为站点接口失效）")
    } else if e.is_connect() {
        format!("{prefix}连接失败（域名可能已失效、被墙或需要代理）")
    } else if e.is_status() {
        format!(
            "{prefix}HTTP {}",
            e.status().map(|s| s.as_str().to_string()).unwrap_or_default()
        )
    } else if e.is_request() {
        format!("{prefix}请求发送失败（TLS/网络异常）")
    } else {
        format!("{prefix}{e}")
    }
}

/// 单次请求 -> (字节, Content-Type)。identity=true 时强制服务器返回未压缩数据
async fn raw_bytes(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
    identity: bool,
) -> AppResult<(Vec<u8>, String)> {
    let mut req = client
        .get(url)
        .header("User-Agent", ua)
        .timeout(std::time::Duration::from_secs(timeout_secs));
    if identity {
        // 部分服务器谎报压缩格式导致解码失败，强制原文重试
        req = req.header("Accept-Encoding", "identity");
    }
    for (k, v) in extra_headers {
        if !k.is_empty() {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Http(classify(url, &e)))?;
    if !resp.status().is_success() {
        return Err(AppError::Http(format!(
            "{url} -> HTTP {}（站点拒绝或接口失效）",
            resp.status()
        )));
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Http(classify(url, &e)))?;
    Ok((bytes.to_vec(), ct))
}

/// 抓取字节。首次失败且属于「解码/连接」类时自动重试一次（identity 强制不压缩）
pub async fn fetch_bytes(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<Vec<u8>> {
    match raw_bytes(client, url, ua, extra_headers, timeout_secs, false).await {
        Ok((b, _)) => Ok(b),
        Err(first) => {
            let retryable = first.to_string().contains("响应解码失败")
                || first.to_string().contains("连接失败")
                || first.to_string().contains("请求发送失败");
            if retryable {
                raw_bytes(client, url, ua, extra_headers, timeout_secs, true)
                    .await
                    .map(|(b, _)| b)
            } else {
                Err(first)
            }
        }
    }
}

/// 抓取并解码为文本：优先按 Content-Type charset，否则 utf-8 失败时回退 GBK
pub async fn fetch_text(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<String> {
    let (bytes, ct) = match raw_bytes(client, url, ua, extra_headers, timeout_secs, false).await {
        Ok(v) => v,
        Err(first) => {
            let retryable = first.to_string().contains("响应解码失败")
                || first.to_string().contains("连接失败")
                || first.to_string().contains("请求发送失败");
            if retryable {
                raw_bytes(client, url, ua, extra_headers, timeout_secs, true).await?
            } else {
                return Err(first);
            }
        }
    };
    let charset = ct
        .split(';')
        .rev()
        .find_map(|p| {
            let p = p.trim();
            p.strip_prefix("charset=")
                .map(|s| s.trim_matches('"').to_lowercase())
        })
        .filter(|s| !s.is_empty() && s != "utf-8" && s != "utf8");
    let text = if let Some(label) = charset {
        let (t, _, _) = encoding_rs::Encoding::for_label(label.as_bytes())
            .unwrap_or(encoding_rs::UTF_8)
            .decode(&bytes);
        t.into_owned()
    } else {
        match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                let (t, _, _) = encoding_rs::GBK.decode(&bytes);
                t.into_owned()
            }
        }
    };
    // 清理 BOM / 零宽字符：有站点返回带 BOM 的 JSON，trim 不会去掉它
    Ok(text
        .trim_start_matches('\u{feff}')
        .trim_start_matches('\u{200b}')
        .to_string())
}
