// 与 Rust 端 serde 序列化字段一一对应
export interface VideoCard {
  site_key: string;
  site_name: string;
  vod_id: number;
  name: string;
  pic: string;
  remarks: string;
  time: string;
  score: string;
}

export interface Episode {
  name: string;
  url: string;
  is_web: boolean;
}

export interface PlaySource {
  name: string;
  episodes: Episode[];
}

export interface VideoDetail {
  site_key: string;
  site_name: string;
  vod_id: number;
  name: string;
  pic: string;
  remarks: string;
  content: string;
  year: string;
  area: string;
  actor: string;
  director: string;
  score: string;
  type_name: string;
  sources: PlaySource[];
}

export interface PagedVideos {
  page: number;
  pagecount: number;
  total: number;
  items: VideoCard[];
}

export interface CmsClass {
  type_id: number;
  type_name: string;
}

export interface SearchResultGroup {
  site_key: string;
  site_name: string;
  ok: boolean;
  message: string;
  items: VideoCard[];
}

export interface SiteConfig {
  key: string;
  name: string;
  api: string;
  kind: string;
  searchable: number;
  quick_search: number;
  filterable: number;
  categories: string[];
  enabled?: number;
  unsupported_reason: string;
}

export interface HomeSection {
  title: string;
  site: string;
  type_id?: number;
}

export interface LiveGroupRaw {
  name: string;
  url: string;
}

export interface TvboxDesktopExt {
  accent?: string;
  density?: string;
  home: { sections: HomeSection[] };
}

export interface ParseConfig {
  name: string;
  type: number;
  url: string;
}

export interface TvboxConfig {
  format?: string;
  name?: string;
  sites: SiteConfig[];
  lives: LiveGroupRaw[];
  parses: ParseConfig[];
  ext: TvboxDesktopExt;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  created_at: number;
  updated_at: number;
  enabled: boolean;
  config: TvboxConfig;
}

export interface AppStateDto {
  subscriptions: Subscription[];
  activeId: string | null;
  activeConfig: TvboxConfig | null;
}

export interface LiveChannel {
  name: string;
  lines: string[];
}

export interface LiveChannelGroup {
  group: string;
  channels: LiveChannel[];
}

export interface LineSpeed {
  url: string;
  delay_ms: number;
  ok: boolean;
}

export interface FavoriteItem {
  site_key: string;
  site_name: string;
  vod_id: number;
  name: string;
  pic: string;
  remarks: string;
  added_at: number;
}

export interface HistoryItem {
  site_key: string;
  site_name: string;
  vod_id: number;
  name: string;
  pic: string;
  remarks: string;
  source_name: string;
  episode_index: number;
  episode_name: string;
  episode_url: string;
  position_sec: number;
  duration_sec: number;
  updated_at: number;
}

export interface HomeSectionData {
  title: string;
  site_key: string;
  site_name: string;
  items: VideoCard[];
}

// 跨站片源池：同一部影片在其它站点的可播线路（详情/播放页换源用）
export interface PoolLine {
  name: string;
  count: number;
}

export interface PoolEntry {
  site_key: string;
  site_name: string;
  vod_id: number;
  /** 该源片名（可能与搜索名略有出入，如 “凡人修仙传(重制版)”） */
  vod_name: string;
  pic: string;
  remarks: string;
  lines: PoolLine[];
}

// ---------- 应用设置（与 Rust settings.rs 一一对应） ----------

export interface AiSettings {
  api_key: string;
  model: string;
  base_url: string;
}

export interface AppSettings {
  search_concurrency: number;
  request_timeout: number;
  hide_commentary: boolean;
  density: string; // cozy | compact
  accent: string; // #RRGGBB
  ua: string;
  ext_player: string; // 命令模板，{url} 占位；空 = 自动探测
  theme: string; // dark（默认）| light，同步窗口标题栏
  update_url: string; // 检查更新地址（JSON 或纯文本版本号）
  ai: AiSettings;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  /** 是否便携模式：配置保存在 exe 同目录 data 文件夹 */
  portable: boolean;
  os: string;
  runtime: string;
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  hasUpdate: boolean;
  notes: string;
  downloadUrl: string;
  checkedFrom: string;
}

// 与 Rust room.rs 对齐
export function isRoomUrl(u: string): boolean {
  const lower = u.toLowerCase();
  return (
    (lower.startsWith("huya://") || lower.startsWith("douyin://")) &&
    !lower.includes(".m3u8")
  );
}

// 站点能力判断（对应 Rust SiteConfig::normalize 后的 kind）
export function siteKindOk(s: SiteConfig): boolean {
  return s.kind === "cms" || s.kind === "api" || s.kind === "html";
}

export function siteIsCms(s: SiteConfig): boolean {
  return s.kind === "cms" || s.kind === "api";
}
