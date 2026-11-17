// TVBox 配置模型：兼容 A 格式（安卓 TVBox 原生）与 B 格式（tvbox-desktop/1）
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------- 宽容反序列化 ----------
// 现实中大量采集站 / 订阅配置把数字写成字符串（"vod_id":"1"、"page":"1"、"searchable":"1"），
// 严格 i64/i32 解析会直接报 invalid type: string "1", expected i64。
// 以下 helper 统一接受：数字 / 数字字符串 / 布尔 / null。
pub mod flex {
    use serde::{Deserialize, Deserializer};

    fn value_to_i64(v: &serde_json::Value) -> i64 {
        match v {
            serde_json::Value::Number(n) => n
                .as_i64()
                .or_else(|| n.as_f64().map(|f| f as i64))
                .unwrap_or(0),
            serde_json::Value::String(s) => {
                let t = s.trim();
                t.parse::<i64>()
                    .or_else(|_| t.parse::<f64>().map(|f| f as i64))
                    .unwrap_or(0)
            }
            serde_json::Value::Bool(b) => *b as i64,
            _ => 0,
        }
    }

    pub fn i64_flex<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        Ok(value_to_i64(&serde_json::Value::deserialize(d)?))
    }

    pub fn i32_flex<'de, D: Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
        Ok(value_to_i64(&serde_json::Value::deserialize(d)?).clamp(
            i32::MIN as i64,
            i32::MAX as i64,
        ) as i32)
    }

    pub fn u64_flex<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        Ok(value_to_i64(&serde_json::Value::deserialize(d)?).max(0) as u64)
    }

    pub fn opt_i64_flex<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match v {
            serde_json::Value::Null => None,
            ref other => Some(value_to_i64(other)),
        })
    }

    pub fn opt_i32_flex<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i32>, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match v {
            serde_json::Value::Null => None,
            ref other => Some(value_to_i64(other).clamp(i32::MIN as i64, i32::MAX as i64) as i32),
        })
    }

    pub fn opt_u64_flex<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match v {
            serde_json::Value::Null => None,
            ref other => Some(value_to_i64(other).max(0) as u64),
        })
    }

    /// 字符串字段：接受 "abc" / 123 / true，其余归空串
    /// （部分站点把 vod_time 返回成时间戳数字、vod_year 返回成数字）
    pub fn string_flex<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        Ok(match v {
            serde_json::Value::String(s) => s,
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            _ => String::new(),
        })
    }

    /// null -> 默认值（部分站点返回 "list": null）
    pub fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de> + Default,
    {
        let v = Option::<T>::deserialize(d)?;
        Ok(v.unwrap_or_default())
    }

    /// 站点数组容忍：单个站点条目非法（如字符串/缺字段）时跳过，不炸掉整份配置
    pub fn tolerant_sites<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Vec<super::SiteConfig>, D::Error> {
        let v: Vec<serde_json::Value> = Vec::deserialize(d)?;
        Ok(v.into_iter()
            .filter(|item| item.is_object())
            .filter_map(|item| serde_json::from_value::<super::SiteConfig>(item).ok())
            .collect())
    }
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
    #[serde(default, deserialize_with = "flex::i32_flex")]
    pub searchable: i32,
    #[serde(
        default,
        alias = "quickSearch",
        deserialize_with = "flex::i32_flex"
    )]
    pub quick_search: i32,
    #[serde(default, deserialize_with = "flex::i32_flex")]
    pub filterable: i32,
    #[serde(default, deserialize_with = "flex::null_to_default")]
    pub categories: Vec<String>,
    #[serde(default)]
    pub header: HashMap<String, String>,
    #[serde(default, deserialize_with = "flex::opt_u64_flex")]
    pub timeout: Option<u64>,
    #[serde(default, deserialize_with = "flex::opt_i32_flex")]
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
    #[serde(default, deserialize_with = "flex::i32_flex")]
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
    #[serde(default, deserialize_with = "flex::i32_flex")]
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
    #[serde(default, alias = "typeId", deserialize_with = "flex::opt_i64_flex")]
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
    #[serde(default, deserialize_with = "flex::tolerant_sites")]
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
    // A 格式兼容字段，保持与 TVBox 原配置一致的驼峰命名
    #[serde(default)]
    #[allow(non_snake_case)]
    pub warningText: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 采集站返回字符串数字（"page":"1"）时必须能解析 —— 回归测试
    #[test]
    fn test_cms_response_string_numbers() {
        let text = r#"{"code":1,"msg":"数据列表","page":"1","pagecount":"203","total":"4057","list":[{"vod_id":"12","vod_name":"测试","vod_pic":"","vod_remarks":"更新至","vod_time":"","vod_play_from":"dbm3u8","vod_play_url":"第01集$https://a.com/1.m3u8","type_id":"5"}],"class":[{"type_id":"1","type_name":"电影"}]}"#;
        let r: CmsListResponse = serde_json::from_str(text).unwrap();
        assert_eq!(r.page, 1);
        assert_eq!(r.pagecount, 203);
        assert_eq!(r.total, 4057);
        assert_eq!(r.list[0].vod_id, 12);
        assert_eq!(r.class[0].type_id, 1);
    }

    #[test]
    fn test_cms_response_number_and_mixed() {
        // 数字与字符串混用也要能解析
        let text = r#"{"page":2,"pagecount":"10","total":"","list":[],"class":[]}"#;
        let r: CmsListResponse = serde_json::from_str(text).unwrap();
        assert_eq!(r.page, 2);
        assert_eq!(r.pagecount, 10);
        assert_eq!(r.total, 0); // 空字符串回退 0
    }

    /// 订阅配置里 "searchable":"1" 字符串形式必须能解析 —— 回归测试
    #[test]
    fn test_site_config_string_flags() {
        let text = r#"{"key":"a","name":"A","type":3,"api":"https://x/vod","searchable":"1","quickSearch":"0","filterable":1}"#;
        let s: SiteConfig = serde_json::from_str(text).unwrap();
        assert_eq!(s.searchable, 1);
        assert_eq!(s.quick_search, 0);
        assert_eq!(s.filterable, 1);
        assert_eq!(s.kind, "cms");
    }

    /// vod_time 时间戳数字 / vod_year 数字、"list": null 也要能解析
    #[test]
    fn test_cms_response_numeric_strings_and_null_list() {
        let text = r#"{"page":1,"pagecount":"1","total":"3","list":null,"class":null}"#;
        let r: CmsListResponse = serde_json::from_str(text).unwrap();
        assert!(r.list.is_empty());
        assert!(r.class.is_empty());

        let text2 = r#"{"page":"1","list":[{"vod_id":12,"vod_name":"片名","vod_time":1730000000,"vod_year":2025,"vod_score":"8.5"}]}"#;
        let r2: CmsListResponse = serde_json::from_str(text2).unwrap();
        assert_eq!(r2.list[0].vod_time, "1730000000");
        assert_eq!(r2.list[0].vod_year, "2025");
        assert_eq!(r2.list[0].vod_name, "片名");
    }

    /// 站点条目里混入非法项（字符串/缺字段对象）时跳过，不炸整份配置
    #[test]
    fn test_tolerant_sites() {
        let text = r#"{"sites":[{"key":"a","name":"A","type":3,"api":"https://x/vod"},"csp_XXX",{},{ "key":"b","name":"B","type":"cms","api":"https://y/vod","searchable":1}]}"#;
        let cfg: TvboxConfig = serde_json::from_str(text).unwrap();
        let keys: Vec<&str> = cfg.sites.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, vec!["a", "b"]);
        assert_eq!(cfg.sites[1].kind, "cms");
    }
}

// ---------- CMS 接口响应 ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CmsClass {
    #[serde(default, rename = "type_id", deserialize_with = "flex::i64_flex")]
    pub type_id: i64,
    #[serde(default, rename = "type_name", deserialize_with = "flex::string_flex")]
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CmsVod {
    #[serde(default, rename = "vod_id", deserialize_with = "flex::i64_flex")]
    pub vod_id: i64,
    #[serde(default, rename = "vod_name", deserialize_with = "flex::string_flex")]
    pub vod_name: String,
    #[serde(default, rename = "vod_pic", deserialize_with = "flex::string_flex")]
    pub vod_pic: String,
    #[serde(default, rename = "vod_remarks", deserialize_with = "flex::string_flex")]
    pub vod_remarks: String,
    #[serde(default, rename = "vod_time", deserialize_with = "flex::string_flex")]
    pub vod_time: String,
    #[serde(default, rename = "vod_play_from", deserialize_with = "flex::string_flex")]
    pub vod_play_from: String,
    #[serde(default, rename = "vod_play_url", deserialize_with = "flex::string_flex")]
    pub vod_play_url: String,
    #[serde(default, rename = "vod_content", deserialize_with = "flex::string_flex")]
    pub vod_content: String,
    #[serde(default, rename = "type_name", deserialize_with = "flex::string_flex")]
    pub type_name: String,
    #[serde(default, rename = "vod_year", deserialize_with = "flex::string_flex")]
    pub vod_year: String,
    #[serde(default, rename = "vod_area", deserialize_with = "flex::string_flex")]
    pub vod_area: String,
    #[serde(default, rename = "vod_actor", deserialize_with = "flex::string_flex")]
    pub vod_actor: String,
    #[serde(default, rename = "vod_director", deserialize_with = "flex::string_flex")]
    pub vod_director: String,
    #[serde(default, rename = "vod_douban_score")]
    pub vod_score: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CmsListResponse {
    #[serde(default, deserialize_with = "flex::i64_flex")]
    pub page: i64,
    #[serde(default, deserialize_with = "flex::i64_flex")]
    pub pagecount: i64,
    #[serde(default, deserialize_with = "flex::i64_flex")]
    pub total: i64,
    #[serde(default, deserialize_with = "flex::null_to_default")]
    pub list: Vec<CmsVod>,
    #[serde(default, deserialize_with = "flex::null_to_default")]
    pub class: Vec<CmsClass>,
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
