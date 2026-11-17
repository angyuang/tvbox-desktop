// 全局状态：应用状态（订阅）+ 应用设置 + 轻提示 + 聚合搜索结果
// 搜索结果放在全局 store：从详情页返回时不再丢失，也不会触发重新搜索
import { create } from "zustand";
import { api } from "./api";
import type {
  AppStateDto,
  AppSettings,
  FavoriteItem,
  HistoryItem,
  SearchResultGroup,
} from "./types";

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

  // 聚合搜索（全局保留：切页/返回不清空）
  searchKw: string;
  searchResults: SearchResultGroup[];
  searching: boolean;
  searchError: string;
  searchProgress: SearchProgressInfo | null;
  lastSearched: string;
  runSearch: (word: string) => Promise<void>;
  clearSearch: () => void;

  toast: (text: string, kind?: Toast["kind"]) => void;
  reloadState: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  applyAppearance: (s: AppSettings) => void;
  reloadFavorites: () => Promise<void>;
  reloadHistory: () => Promise<void>;
  reloadAll: () => Promise<void>;
}

let toastSeq = 0;

// 强调色 -> 浅背景色（透明度可调：深色主题下需要更高不透明度才可见）
function accentSoft(hex: string, alpha = 0.12): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(238, 242, 255, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ---------- 主题解析：light | dark | night | system ----------
let themeMode = "light";
let sysListenerBound = false;

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

function resolveTheme(mode: string): string {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode; // light / dark / night 原样使用
}

function applyThemeAll(mode: string, accent: string) {
  themeMode = mode;
  const resolved = resolveTheme(mode);
  const dark = resolved === "dark" || resolved === "night";
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.setProperty("--accent", accent);
  root.style.setProperty(
    "--accent-soft",
    accentSoft(accent, dark ? 0.22 : 0.12)
  );
  // 原生窗口标题栏同步（暗色/深夜黑时标题栏一起变暗）
  api.setWindowTheme(resolved).catch(() => undefined);
  // 跟随系统：监听系统主题变化，只绑一次
  if (!sysListenerBound && typeof window !== "undefined" && window.matchMedia) {
    sysListenerBound = true;
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (themeMode === "system") {
          const r = resolveTheme("system");
          document.documentElement.dataset.theme = r;
          api.setWindowTheme(r).catch(() => undefined);
        }
      });
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
  lastSearched: "",

  runSearch: async (word) => {
    const w = word.trim();
    if (!w) return;
    set({
      searchKw: w,
      lastSearched: w,
      searching: true,
      searchError: "",
      searchProgress: null,
      searchResults: [],
    });
    try {
      const res = await api.aggregateSearch(w);
      // 只写入当前关键词的结果，防止竞态
      set((s) =>
        s.lastSearched === w
          ? { searchResults: res, searching: false, searchProgress: null }
          : s
      );
    } catch (e) {
      set((s) =>
        s.lastSearched === w
          ? { searchError: String(e), searching: false, searchProgress: null }
          : s
      );
    }
  },

  clearSearch: () => {
    set({
      searchKw: "",
      searchResults: [],
      searching: false,
      searchError: "",
      searchProgress: null,
      lastSearched: "",
    });
  },

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

  // 主题 / 强调色 / 界面密度写入 CSS，全局生效
  applyAppearance: (s: AppSettings) => {
    applyThemeAll(s.theme || "light", s.accent);
    document.body.classList.toggle("compact", s.density === "compact");
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
}));
