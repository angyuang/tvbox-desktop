// TVBox 配置模型：兼容 A 格式（安卓 TVBox 原生）与 B 格式（tvbox-desktop/1）
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------- 宽松反序列化 ----------
// 大量 CMS 采集站把数值字段输出成字符串（"vod_id":"1"）或把布尔输出成 0/1，
// 严格类型反序列化会直接报 "error decoding response body"。这里统一做 string-or-number 兼容。

/// 宽松整数：接受 number / "number" / bool / null
pub fn de_flex_i64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    use serde::de::Error;
    let v = serde_json::Value::deserialize(d)?;
    match v {
        serde_json::Value::Number(n) => Ok(n
            .as_i64()
            .unwrap_or_else(|| n.as_f64().unwrap_or(0.0).round() as i64)),
        serde_json::Value::String(s) => Ok(s.trim().parse().unwrap_or_else(|_| {
            s.trim().parse::<f64>().map(|f| f.round() as i64).unwrap_or(0)
        })),
        serde_json::Value::Bool(b) => Ok(if b { 1 } else { 0 }),
        serde_json::Value::Null => Ok(0),
        other => Err(D::Error::custom(format!("无法解析为整数: {other}"))),
    }
}

/// 宽松 i32（searchable/enabled 等开关字段常被写成 true/false 或 "1"）
pub fn de_flex_i32<'de, D: serde::Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    Ok(de_flex_i64(d)? as i32)
}

/// 宽松字符串：接受 string / number / bool / null
pub fn de_flex_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    })
}

/// 站点配置。type 字段取值混乱（数字 0-4 / 字符串），先用 Value 接收再归一化。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SiteConfig {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub api: String,
    #[serde(default, rename = "type")]
    pub type_raw: serde_json::Value,
    #[serde(default, deserialize_with = "de_flex_i32")]
    pub searchable: i32,
    #[serde(default, deserialize_with = "de_flex_i32")]
    pub quick_search: i32,
    #[serde(default, deserialize_with = "de_flex_i32")]
    pub filterable: i32,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub header: HashMap<String, String>,
    #[serde(default, deserialize_with = "de_flex_opt_u64")]
    pub timeout: Option<u64>,
    #[serde(default, deserialize_with = "de_flex_opt_i32")]
    pub enabled: Option<i32>,
    /// 归一化后的类型：cms | api | html | spider | unknown（由 normalize 填充）
    #[serde(default)]
    pub kind: String,
    /// html 规则站的 CSS 选择器
    #[serde(default)]
    pub rules: Option<HtmlRules>,
    /// 桌面端不支持原因（灰显说明，由 normalize 填充）
    #[serde(default)]
    pub unsupported_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HtmlRules {
    #[serde(default)]
    pub list: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub pic: String,
    #[serde(default)]
    pub remarks: String,
}

impl SiteConfig {
    /// 归一化 type_raw -> kind，并标记桌面端不可用站点。
    /// 对照原项目 README：
    /// 3/"cms" = 苹果CMS；1/"html" = 网页规则站（仅搜索）；4/"api" = CMS 变体；
    /// 0/"spider"（含 csp_ 开头）= 需要 jar/dex，桌面端不支持。
    pub fn normalize(&mut self) {
        let api_lower = self.api.to_lowercase();
        let is_csp = api_lower.starts_with("csp_") || api_lower.starts_with("csp.");
        let t = match &self.type_raw {
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(-1),
            serde_json::Value::String(s) => match s.as_str() {
                "cms" => 3,
                "html" => 1,
                "api" => 4,
                "spider" => 0,
                other => other.parse().unwrap_or(-1),
            },
            _ => -1,
        };
        if is_csp {
            self.kind = "spider".into();
        } else {
            self.kind = match t {
                3 => "cms".into(),
                1 => "html".into(),
                4 => "api".into(),
                0 => "spider".into(),
                _ => "unknown".into(),
            };
        }
        self.unsupported_reason = match self.kind.as_str() {
            "spider" => "需要配套 jar/dex 扩展，桌面端不支持".into(),
            "unknown" => "未知站点类型，桌面端不支持".into(),
            _ => String::new(),
        };
    }

    pub fn supported(&self) -> bool {
        matches!(self.kind.as_str(), "cms" | "api" | "html")
    }

    pub fn is_searchable(&self) -> bool {
        self.searchable != 0 && self.enabled.unwrap_or(1) != 0 && self.supported()
    }

    /// cms / api 归为同一处理路径（JSON 苹果CMS 协议）
    pub fn is_cms(&self) -> bool {
        matches!(self.kind.as_str(), "cms" | "api")
    }
}

/// 直播源：B 格式 { name, url }，兼容 A 格式内嵌 groups
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveGroup {
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub r#type: i32,
    #[serde(default)]
    pub groups: Vec<LiveGroupRaw>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveGroupRaw {
    pub name: String,
    #[serde(default)]
    pub channels: Vec<LiveChannelRaw>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveChannelRaw {
    pub name: String,
    #[serde(default)]
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParseConfig {
    pub name: String,
    #[serde(default)]
    pub r#type: i32,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HeaderRule {
    pub host: String,
    #[serde(default)]
    pub header: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HomeSection {
    pub title: String,
    #[serde(default)]
    pub site: String,
    #[serde(default, alias = "typeId")]
    pub type_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TvboxDesktopExt {
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default)]
    pub density: Option<String>,
    #[serde(default)]
    pub home: HomeExt,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HomeExt {
    #[serde(default)]
    pub sections: Vec<HomeSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TvboxConfig {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub sites: Vec<SiteConfig>,
    #[serde(default)]
    pub lives: Vec<LiveGroup>,
    #[serde(default)]
    pub parses: Vec<ParseConfig>,
    #[serde(default)]
    pub headers: Vec<HeaderRule>,
    #[serde(default, rename = "tvboxDesktop")]
    pub ext: TvboxDesktopExt,
    // A 格式兼容字段（忽略内容，仅避免反序列化报错）
    #[serde(default)]
    pub spider: Option<String>,
    #[serde(default)]
    pub wallpaper: Option<String>,
    #[serde(default, rename = "warningText")]
    pub warning_text: Option<String>,
}

impl TvboxConfig {
    pub fn parse_json(text: &str) -> crate::error::AppResult<Self> {
        let mut cfg: TvboxConfig = serde_json::from_str(text)
            .map_err(|e| crate::error::AppError::Parse(format!("不是合法的 TVBox 配置 JSON: {e}")))?;
        for s in cfg.sites.iter_mut() {
            s.normalize();
        }
        Ok(cfg)
    }
}

// ---------- CMS 接口响应 ----------

/// Option 字段的宽松反序列化（null / 缺省 / "12" 都能兜住）
pub fn de_flex_opt_u64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    let v: serde_json::Value = serde::Deserialize::deserialize(d)?;
    Ok(match v {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

pub fn de_flex_opt_i32<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<i32>, D::Error> {
    let v: serde_json::Value = serde::Deserialize::deserialize(d)?;
    Ok(match v {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => n.as_i64().map(|x| x as i32),
        serde_json::Value::Bool(b) => Some(if b { 1 } else { 0 }),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CmsClass {
    #[serde(default, rename = "type_id", deserialize_with = "de_flex_i64")]
    pub type_id: i64,
    #[serde(default, rename = "type_name", deserialize_with = "de_flex_string")]
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CmsVod {
    #[serde(default, rename = "vod_id", deserialize_with = "de_flex_i64")]
    pub vod_id: i64,
    #[serde(default, rename = "vod_name", deserialize_with = "de_flex_string")]
    pub vod_name: String,
    #[serde(default, rename = "vod_pic", deserialize_with = "de_flex_string")]
    pub vod_pic: String,
    #[serde(default, rename = "vod_remarks", deserialize_with = "de_flex_string")]
    pub vod_remarks: String,
    #[serde(default, rename = "vod_time", deserialize_with = "de_flex_string")]
    pub vod_time: String,
    #[serde(default, rename = "vod_play_from", deserialize_with = "de_flex_string")]
    pub vod_play_from: String,
    #[serde(default, rename = "vod_play_url", deserialize_with = "de_flex_string")]
    pub vod_play_url: String,
    #[serde(default, rename = "vod_content", deserialize_with = "de_flex_string")]
    pub vod_content: String,
    #[serde(default, rename = "type_name", deserialize_with = "de_flex_string")]
    pub type_name: String,
    #[serde(default, rename = "vod_year", deserialize_with = "de_flex_string")]
    pub vod_year: String,
    #[serde(default, rename = "vod_area", deserialize_with = "de_flex_string")]
    pub vod_area: String,
    #[serde(default, rename = "vod_actor", deserialize_with = "de_flex_string")]
    pub vod_actor: String,
    #[serde(default, rename = "vod_director", deserialize_with = "de_flex_string")]
    pub vod_director: String,
    #[serde(default, rename = "vod_douban_score")]
    pub vod_score: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CmsListResponse {
    #[serde(default, deserialize_with = "de_flex_i64")]
    pub page: i64,
    #[serde(default, deserialize_with = "de_flex_i64")]
    pub pagecount: i64,
    #[serde(default, deserialize_with = "de_flex_i64")]
    pub total: i64,
    #[serde(default, deserialize_with = "de_null_vec")]
    pub list: Vec<CmsVod>,
    #[serde(default, deserialize_with = "de_null_vec")]
    pub class: Vec<CmsClass>,
}

/// 列表字段为 null 时按空处理（部分站返回 "list": null）
pub fn de_null_vec<'de, T: serde::de::DeserializeOwned, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Vec<T>, D::Error> {
    let v: serde_json::Value = serde::Deserialize::deserialize(d)?;
    match v {
        serde_json::Value::Null => Ok(vec![]),
        other => serde_json::from_value(other).map_err(serde::de::Error::custom),
    }
}

// ---------- 面向前端的模型 ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoCard {
    pub site_key: String,
    pub site_name: String,
    pub vod_id: i64,
    pub name: String,
    pub pic: String,
    pub remarks: String,
    pub time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Episode {
    pub name: String,
    pub url: String,
    /// 网页线路：需要嗅探拿到真实直链
    pub is_web: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlaySource {
    pub name: String,
    pub episodes: Vec<Episode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoDetail {
    pub site_key: String,
    pub site_name: String,
    pub vod_id: i64,
    pub name: String,
    pub pic: String,
    pub remarks: String,
    pub content: String,
    pub year: String,
    pub area: String,
    pub actor: String,
    pub director: String,
    pub score: String,
    pub type_name: String,
    pub sources: Vec<PlaySource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PagedVideos {
    pub page: i64,
    pub pagecount: i64,
    pub total: i64,
    pub items: Vec<VideoCard>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchResultGroup {
    pub site_key: String,
    pub site_name: String,
    pub ok: bool,
    pub message: String,
    pub items: Vec<VideoCard>,
}

// ---------- 直播 ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveChannel {
    pub name: String,
    /// 同名频道多线路合并
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveChannelGroup {
    pub group: String,
    pub channels: Vec<LiveChannel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LineSpeed {
    pub url: String,
    pub delay_ms: i64,
    pub ok: bool,
}

// ---------- 本地存储 ----------

pub fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: String,
    pub name: String,
    /// http(s) 订阅地址 / 本地文件路径 / builtin:public-sources
    pub url: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// 启用开关：禁用的订阅不参与生效配置（老配置文件缺省为 true）
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub config: TvboxConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FavoriteItem {
    pub site_key: String,
    pub site_name: String,
    pub vod_id: i64,
    pub name: String,
    pub pic: String,
    pub remarks: String,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HistoryItem {
    pub site_key: String,
    pub site_name: String,
    pub vod_id: i64,
    pub name: String,
    pub pic: String,
    pub remarks: String,
    pub source_name: String,
    pub episode_index: i32,
    pub episode_name: String,
    pub episode_url: String,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub updated_at: i64,
}

impl HistoryItem {
    pub fn same_video(&self, other: &Self) -> bool {
        self.site_key == other.site_key && self.vod_id == other.vod_id
    }
}
