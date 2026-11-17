// 全局状态：应用状态（订阅）+ 应用设置 + 轻提示 + 聚合搜索（跨页面保活）+ 搜索历史
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

interface AppStore {
  state: AppStateDto | null;
  stateLoading: boolean;
  settings: AppSettings | null;
  favorites: FavoriteItem[];
  history: HistoryItem[];
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  reloadState: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  applyAppearance: (s: AppSettings) => void;
  reloadFavorites: () => Promise<void>;
  reloadHistory: () => Promise<void>;
  reloadAll: () => Promise<void>;
}

let toastSeq = 0;

// 强调色 -> 浅背景色（浅色主题透明度 12%，深色主题 20% 才看得出来）
function accentSoft(hex: string, theme: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const alpha = theme === "light" ? 0.12 : 0.2;
  if (!m) return `rgba(37, 99, 235, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const useApp = create<AppStore>((set, get) => ({
  state: null,
  stateLoading: true,
  settings: null,
  favorites: [],
  history: [],
  toasts: [],

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

  // 主题 / 强调色 / 密度写入 CSS 与窗口（标题栏跟随），全局生效
  applyAppearance: (s: AppSettings) => {
    const root = document.documentElement;
    const theme = s.theme === "light" ? "light" : "dark";
    root.dataset.theme = theme;
    root.style.setProperty("--accent", s.accent);
    root.style.setProperty("--accent-soft", accentSoft(s.accent, theme));
    document.body.classList.toggle("compact", s.density === "compact");
    api.setTheme(theme).catch(() => undefined);
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

// ---------------- 搜索历史（localStorage 持久化，最多 20 条） ----------------

const HIST_KEY = "tvbox.searchHistory";
const HIST_MAX = 20;

export function loadSearchHistory(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(list: string[]) {
  localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX)));
}

export function addSearchHistory(kw: string) {
  const w = kw.trim();
  if (!w) return;
  const list = loadSearchHistory().filter((x) => x !== w);
  list.unshift(w);
  saveSearchHistory(list);
}

export function removeSearchHistory(kw: string) {
  saveSearchHistory(loadSearchHistory().filter((x) => x !== kw));
}

export function clearSearchHistory() {
  localStorage.removeItem(HIST_KEY);
}

// ---------------- 聚合搜索状态（放全局 store：切页面再回来不丢结果） ----------------

export interface SearchProgress {
  done: number;
  total: number;
  siteKey: string;
  siteName: string;
  ok: boolean;
  count: number;
}

interface SearchStore {
  kw: string;
  results: SearchResultGroup[];
  searching: boolean;
  error: string;
  progress: SearchProgress | null;
  /** 已发起搜索的关键词（用于判断是否需要自动重搜） */
  searchedKw: string;
  setKw: (kw: string) => void;
  setProgress: (p: SearchProgress | null) => void;
  search: (word: string) => Promise<void>;
}

export const useSearch = create<SearchStore>((set, get) => ({
  kw: "",
  results: [],
  searching: false,
  error: "",
  progress: null,
  searchedKw: "",

  setKw: (kw) => set({ kw }),
  setProgress: (p) => set({ progress: p }),

  search: async (word) => {
    const w = word.trim();
    if (!w) return;
    set({ kw: w, searching: true, error: "", progress: null, searchedKw: w });
    addSearchHistory(w);
    try {
      const res = await api.aggregateSearch(w);
      // 只保留当前关键词的结果，防止竞态
      if (get().kw === w) set({ results: res, searching: false });
    } catch (e) {
      if (get().kw === w) set({ error: String(e), searching: false });
    } finally {
      if (get().kw === w) set({ progress: null, searching: false });
    }
  },
}));
