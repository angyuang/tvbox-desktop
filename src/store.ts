// 全局状态：应用状态（订阅）+ 应用设置 + 轻提示 + 聚合搜索结果保活
import { create } from "zustand";
import { api } from "./api";
import {
  disabledSiteKeys,
  pushSearchHistory,
  removeSearchHistory,
} from "./local";
import type { AppStateDto, AppSettings, FavoriteItem, HistoryItem, SearchResultGroup } from "./types";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

export interface SearchProgressInfo {
  done: number;
  total: number;
  siteKey: string;
  siteName: string;
  ok: boolean;
  count: number;
}

interface AppStore {
  state: AppStateDto | null;
  stateLoading: boolean;
  settings: AppSettings | null;
  favorites: FavoriteItem[];
  history: HistoryItem[];
  toasts: Toast[];

  // 聚合搜索：结果放在全局 store，返回/切页都不会清空（状态保活）
  searchKw: string;
  searchResults: SearchResultGroup[];
  searching: boolean;
  searchError: string;
  searchProgress: SearchProgressInfo | null;

  toast: (text: string, kind?: Toast["kind"]) => void;
  reloadState: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  applyAppearance: (s: AppSettings) => void;
  bindSystemTheme: () => void;
  reloadFavorites: () => Promise<void>;
  reloadHistory: () => Promise<void>;
  reloadAll: () => Promise<void>;

  runSearch: (kw: string) => Promise<void>;
  resetSearch: () => void;
  setSearchProgress: (p: SearchProgressInfo | null) => void;
  addSearchHistory: (kw: string) => void;
  dropSearchHistory: (kw: string) => void;
}

let toastSeq = 0;

// 强调色 -> 浅背景色（透明度 12%）
function accentSoft(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#eef2ff";
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.12)`;
}

// 主题判定：dark 或 system 且系统为暗色
function isDarkTheme(s: AppSettings): boolean {
  if (s.theme === "dark") return true;
  if (s.theme === "light") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export const useApp = create<AppStore>((set, get) => ({
  state: null,
  stateLoading: true,
  settings: null,
  favorites: [],
  history: [],
  toasts: [],

  searchKw: "",
  searchResults: [],
  searching: false,
  searchError: "",
  searchProgress: null,

  toast: (text, kind = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, kind === "error" ? 6000 : 3200);
  },

  reloadState: async () => {
    try {
      const st = await api.getAppState();
      set({ state: st, stateLoading: false });
    } catch (e) {
      get().toast(String(e), "error");
      set({ stateLoading: false });
    }
  },

  reloadSettings: async () => {
    try {
      const s = await api.getSettings();
      set({ settings: s });
      get().applyAppearance(s);
    } catch {
      /* 忽略 */
    }
  },

  // 强调色 / 密度 / 主题写入 DOM 与原生窗口，全局生效
  applyAppearance: (s: AppSettings) => {
    const root = document.documentElement;
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--accent-soft", accentSoft(s.accent));
    document.body.classList.toggle("compact", s.density === "compact");
    const dark = isDarkTheme(s);
    document.body.classList.toggle("dark", dark);
    // 原生窗口主题同步：标题栏 / 系统级 UI 跟随应用主题
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        const theme = s.theme === "dark" ? "dark" : s.theme === "light" ? "light" : null;
        w.setTheme(theme).catch(() => undefined);
      })
      .catch(() => undefined);
  },

  // 监听系统主题变化（theme=system 时实时跟随），App 挂载时调用一次
  bindSystemTheme: () => {
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener?.("change", () => {
        const s = get().settings;
        if (s) get().applyAppearance(s);
      });
    } catch {
      /* 忽略 */
    }
  },

  reloadFavorites: async () => {
    try {
      set({ favorites: await api.getFavorites() });
    } catch {
      /* 忽略 */
    }
  },

  reloadHistory: async () => {
    try {
      set({ history: await api.getHistory() });
    } catch {
      /* 忽略 */
    }
  },

  reloadAll: async () => {
    await Promise.all([
      get().reloadState(),
      get().reloadSettings(),
      get().reloadFavorites(),
      get().reloadHistory(),
    ]);
  },

  // 聚合搜索：结果与进度全部入 store；只有发起新搜索才会清空
  runSearch: async (kw: string) => {
    const w = kw.trim();
    if (!w || get().searching) return;
    set({
      searchKw: w,
      searching: true,
      searchResults: [],
      searchError: "",
      searchProgress: null,
    });
    pushSearchHistory(w);
    try {
      const skip = disabledSiteKeys();
      const res = await api.aggregateSearch(w, skip);
      // 只保留当前关键词的结果，防止竞态
      if (get().searchKw === w) set({ searchResults: res, searching: false });
    } catch (e) {
      if (get().searchKw === w)
        set({ searchError: String(e), searching: false });
    } finally {
      set({ searchProgress: null });
    }
  },

  resetSearch: () => {
    // 只清空搜索结果状态，历史记录保留（历史是持久功能）
    set({
      searchKw: "",
      searchResults: [],
      searching: false,
      searchError: "",
      searchProgress: null,
    });
  },

  setSearchProgress: (p) => set({ searchProgress: p }),

  addSearchHistory: (kw) => pushSearchHistory(kw),
  dropSearchHistory: (kw) => removeSearchHistory(kw),
}));
