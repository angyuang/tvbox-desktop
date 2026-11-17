// Tauri invoke / event 封装：Rust snake_case 参数 -> JS camelCase
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppStateDto,
  Subscription,
  CmsClass,
  PagedVideos,
  VideoDetail,
  SearchResultGroup,
  LiveChannelGroup,
  LineSpeed,
  FavoriteItem,
  HistoryItem,
  HomeSectionData,
  AppSettings,
  AppInfo,
} from "./types";

export const api = {
  getAppState: () => invoke<AppStateDto>("get_app_state"),

  addSubscriptionUrl: (url: string) =>
    invoke<Subscription>("add_subscription_url", { url }),
  addSubscriptionLocal: (path: string) =>
    invoke<Subscription>("add_subscription_local", { path }),
  addSubscriptionRaw: (jsonText: string, name?: string) =>
    invoke<Subscription>("add_subscription_raw", { jsonText, name }),
  removeSubscription: (id: string) =>
    invoke<void>("remove_subscription", { id }),
  renameSubscription: (id: string, name: string) =>
    invoke<void>("rename_subscription", { id, name }),
  setSubscriptionEnabled: (id: string, enabled: boolean) =>
    invoke<void>("set_subscription_enabled", { id, enabled }),
  setActiveSubscription: (id: string) =>
    invoke<void>("set_active_subscription", { id }),
  refreshSubscription: (id: string) =>
    invoke<Subscription>("refresh_subscription", { id }),

  getHomeSections: () => invoke<HomeSectionData[]>("get_home_sections"),
  getCategories: (siteKey: string) =>
    invoke<CmsClass[]>("get_categories", { siteKey }),
  getVideolist: (siteKey: string, typeId: number, page: number) =>
    invoke<PagedVideos>("get_videolist", { siteKey, typeId, page }),
  getDetail: (siteKey: string, vodId: number) =>
    invoke<VideoDetail>("get_detail", { siteKey, vodId }),
  aggregateSearch: (wd: string, skip?: string[]) =>
    invoke<SearchResultGroup[]>("aggregate_search", { wd, skip: skip?.length ? skip : null }),
  testSite: (siteKey: string) =>
    invoke<{ ok: boolean; ms: number; message: string }>("test_site", { siteKey }),

  getLiveChannels: () => invoke<LiveChannelGroup[]>("get_live_channels"),
  speedTestLines: (urls: string[]) =>
    invoke<LineSpeed[]>("speed_test_lines", { urls }),
  resolveRoomUrl: (url: string) => invoke<string>("resolve_room_url", { url }),

  addFavorite: (item: FavoriteItem) => invoke<void>("add_favorite", { item }),
  removeFavorite: (siteKey: string, vodId: number) =>
    invoke<void>("remove_favorite", { siteKey, vodId }),
  getFavorites: () => invoke<FavoriteItem[]>("get_favorites"),

  saveProgress: (item: HistoryItem) => invoke<void>("save_progress", { item }),
  getHistory: () => invoke<HistoryItem[]>("get_history"),
  removeHistory: (siteKey: string, vodId: number) =>
    invoke<void>("remove_history", { siteKey, vodId }),
  clearHistory: () => invoke<void>("clear_history"),

  sniffPage: (url: string) => invoke<string[]>("sniff_page", { url }),
  openSniffer: (url: string) => invoke<void>("open_sniffer", { url }),
  closeSniffer: () => invoke<void>("close_sniffer"),

  // 外部播放器：返回实际使用的播放器名（模板读设置页配置，空则自动探测）
  openExternalPlayer: (url: string) =>
    invoke<string>("open_external_player", { url }),
  detectPlayers: () => invoke<string[]>("detect_players"),

  // 应用设置
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) =>
    invoke<AppSettings>("save_settings", { settings }),
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  openDataDir: () => invoke<void>("open_data_dir"),

  // 解析接口 / AI 总结
  resolveParse: (parseUrl: string, pageUrl: string) =>
    invoke<string>("resolve_parse", { parseUrl, pageUrl }),
  aiSummary: (args: {
    name: string;
    episode: string;
    typeName: string;
    year: string;
    actor: string;
    content: string;
  }) => invoke<string>("ai_summary", args),
};

export type Unlisten = () => void;

export async function onEvent<T>(
  name: string,
  handler: (payload: T) => void
): Promise<Unlisten> {
  const un = await listen<T>(name, (e) => handler(e.payload));
  return un;
}

// 事件名与 Rust 端 emit 对齐
export const EVENTS = {
  SEARCH_PROGRESS: "search:progress",
  SNIFF_FOUND: "sniff:found",
  LIVE_SPEED: "live:speed",
} as const;

// 通用：调用外部播放器并提示结果（模板由 Rust 端从设置读取）
export async function openExternal(
  url: string,
  toastFn: (t: string, k?: "info" | "error" | "success") => void
): Promise<void> {
  try {
    const name = await api.openExternalPlayer(url);
    toastFn(`已用 ${name} 打开`, "success");
  } catch (e) {
    toastFn(String(e), "error");
  }
}
