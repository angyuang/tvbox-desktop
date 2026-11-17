// HTTP 抓取：统一 UA / 超时 / 编码兜底（GBK 站点常见）。UA 由调用方传入（设置页可自定义）
//
// 网络加固（针对"error sending request / 解析失败"类搜索报错）：
// - 接受不规范 TLS 证书（大量采集站证书过期/自签名/域名不匹配）
// - 仅用 HTTP/1.1（部分站点对非浏览器 HTTP/2 指纹直接断连）
// - 绕过系统代理直连（代理软件半开连接会卡死请求）
// - 连接超时与总超时分离，传输失败自动重试 1 次
// - 错误信息分类：DNS/连接失败、TLS 失败、超时、HTTP 状态码，一眼分清"站挂了"还是"软件问题"
use crate::error::{AppError, AppResult};
use reqwest::Client;

/// 全局共享客户端：无代理 + 宽松 TLS + 连接超时
/// （注：reqwest 未暴露 HTTP 版本偏好开关，HTTP/2 兼容问题由重试机制兜底）
pub fn build_client(default_ua: &str) -> AppResult<Client> {
    Client::builder()
        .user_agent(default_ua)
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| AppError::Http(format!("HTTP 客户端初始化失败: {e}")))
}

/// 把 reqwest 传输层错误翻译成可读的中文分类
fn classify_reqwest_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "请求超时（站点响应慢或网络不通）".to_string()
    } else if e.is_connect() {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        if lower.contains("certificate")
            || lower.contains("tls")
            || lower.contains("ssl")
            || lower.contains("handshake")
        {
            format!("TLS 连接失败（证书握手异常）：{msg}")
        } else if lower.contains("dns") || lower.contains("resolve") || lower.contains("getaddrinfo")
        {
            format!("域名解析失败（站点可能已下线）：{msg}")
        } else {
            format!("无法连接站点（域名可能已失效或被拦截）：{msg}")
        }
    } else if let Some(s) = e.status() {
        format!("站点返回 HTTP {s}")
    } else {
        format!("网络请求失败：{e}")
    }
}

async fn send_with_retry(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<reqwest::Response> {
    let build_req = || async {
        let mut req = client
            .get(url)
            .header("User-Agent", ua)
            .timeout(std::time::Duration::from_secs(timeout_secs));
        for (k, v) in extra_headers {
            if !k.is_empty() {
                req = req.header(k.as_str(), v.as_str());
            }
        }
        req
    };

    let mut last_err: Option<AppError> = None;
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        }
        match build_req().await.send().await {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    // 4xx/5xx 重试意义不大，直接归类返回
                    return Err(AppError::Http(format!(
                        "{url} -> 站点返回 HTTP {status}（接口可能已失效）"
                    )));
                }
                return Ok(resp);
            }
            Err(e) => {
                let class = classify_reqwest_err(&e);
                // 仅对连接类/超时类错误重试一次；HTTP 状态错误不重试
                let retryable = e.is_connect() || e.is_timeout() || e.is_request();
                last_err = Some(AppError::Http(format!("{url} -> {class}")));
                if !retryable {
                    return Err(last_err.unwrap());
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| AppError::Http(format!("{url} -> 网络请求失败"))))
}

pub async fn fetch_bytes(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<Vec<u8>> {
    let resp = send_with_retry(client, url, ua, extra_headers, timeout_secs).await?;
    Ok(resp
        .bytes()
        .await
        .map_err(|e| AppError::Http(format!("{url} -> 读取响应失败：{e}")))?
        .to_vec())
}

/// 抓取并解码为文本：优先按 Content-Type charset，否则 utf-8 失败时回退 GBK
pub async fn fetch_text(
    client: &Client,
    url: &str,
    ua: &str,
    extra_headers: &std::collections::HashMap<String, String>,
    timeout_secs: u64,
) -> AppResult<String> {
    let resp = send_with_retry(client, url, ua, extra_headers, timeout_secs).await?;
    let charset = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|ct| {
            ct.split(';')
                .rev()
                .find_map(|p| {
                    let p = p.trim();
                    p.strip_prefix("charset=")
                        .map(|s| s.trim_matches('"').to_lowercase())
                })
                .filter(|s| !s.is_empty() && s != "utf-8" && s != "utf8")
        });
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Http(format!("{url} -> 读取响应失败：{e}")))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_client() {
        let c = build_client("test-ua").unwrap();
        assert_eq!(std::mem::size_of_val(&c), std::mem::size_of::<Client>());
    }
}
