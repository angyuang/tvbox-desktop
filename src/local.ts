// localStorage 轻量持久化：站点启用开关 / 搜索历史 / 本地播放记录
// 这些数据属于界面偏好，存本地即可，无需进 Rust 数据目录

const K_SITE = "tb_site_enabled";
const K_HIST = "tb_search_history";
const K_LOCAL = "tb_local_recent";
const HISTORY_CAP = 30;
const LOCAL_CAP = 24;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 空间满等异常忽略 */
  }
}

// ---------- 站点启用开关（影视源管理表格） ----------

export type SiteEnabledMap = Record<string, boolean>;

export function getSiteEnabledMap(): SiteEnabledMap {
  return readJson<SiteEnabledMap>(K_SITE, {});
}

export function saveSiteEnabledMap(map: SiteEnabledMap) {
  writeJson(K_SITE, map);
}

export function isSiteEnabled(map: SiteEnabledMap, key: string): boolean {
  return map[key] !== false;
}

export function disabledSiteKeys(): string[] {
  const map = getSiteEnabledMap();
  return Object.keys(map).filter((k) => map[k] === false);
}

// ---------- 聚合搜索历史 ----------

export interface SearchHistItem {
  kw: string;
  ts: number;
}

export function getSearchHistory(): SearchHistItem[] {
  return readJson<SearchHistItem[]>(K_HIST, []);
}

export function pushSearchHistory(kw: string) {
  const w = kw.trim();
  if (!w) return;
  const list = getSearchHistory().filter((x) => x.kw !== w);
  list.unshift({ kw: w, ts: Date.now() });
  writeJson(K_HIST, list.slice(0, HISTORY_CAP));
}

export function removeSearchHistory(kw: string) {
  writeJson(
    K_HIST,
    getSearchHistory().filter((x) => x.kw !== kw)
  );
}

export function clearSearchHistory() {
  writeJson(K_HIST, []);
}

// ---------- 本地播放记录（含进度记忆） ----------

export interface LocalRecentItem {
  name: string;
  path: string;
  /** 上次看到的位置（秒） */
  position: number;
  /** 时长（秒） */
  duration: number;
  ts: number;
}

export function getLocalRecent(): LocalRecentItem[] {
  return readJson<LocalRecentItem[]>(K_LOCAL, []);
}

export function upsertLocalRecent(item: {
  name: string;
  path: string;
  position: number;
  duration: number;
}) {
  if (!item.path) return;
  const list = getLocalRecent().filter((x) => x.path !== item.path);
  list.unshift({ ...item, ts: Date.now() });
  writeJson(K_LOCAL, list.slice(0, LOCAL_CAP));
}

export function removeLocalRecent(path: string) {
  writeJson(
    K_LOCAL,
    getLocalRecent().filter((x) => x.path !== path)
  );
}

export function clearLocalRecent() {
  writeJson(K_LOCAL, []);
}
