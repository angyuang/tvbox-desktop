import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PosterCard from "../components/PosterCard";
import { EVENTS, onEvent } from "../api";
import { useApp } from "../store";
import {
  clearSearchHistory,
  getSearchHistory,
  removeSearchHistory,
  type SearchHistItem,
} from "../local";
import type { VideoCard } from "../types";

export default function Search() {
  const { settings, searchKw, searchResults, searching, searchError, searchProgress, runSearch, resetSearch, setSearchProgress, dropSearchHistory, toast } = useApp();
  const [params] = useSearchParams();
  const [kw, setKw] = useState(searchKw);
  const [hist, setHist] = useState<SearchHistItem[]>(getSearchHistory());

  const refreshHist = useCallback(() => setHist(getSearchHistory()), []);

  // 进度事件 -> 全局 store（切页回来也能看到进度）
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<{
      done: number;
      total: number;
      siteKey: string;
      siteName: string;
      ok: boolean;
      count: number;
    }>(EVENTS.SEARCH_PROGRESS, (p) =>
      setSearchProgress({
        done: p.done,
        total: p.total,
        siteKey: p.siteKey,
        siteName: p.siteName,
        ok: p.ok,
        count: p.count,
      })
    ).then((f) => (un = f));
    return () => un?.();
  }, [setSearchProgress]);

  // 从外部（首页推荐等）带关键词跳进来时才自动搜；普通切页/返回不重搜（结果保活）
  useEffect(() => {
    const q = params.get("q");
    if (q && q !== searchKw && !searching) {
      setKw(q);
      void runSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const doSearch = (word: string) => {
    const w = word.trim();
    if (!w) return;
    setKw(w);
    void runSearch(w).then(refreshHist);
  };

  const removeHist = (w: string) => {
    removeSearchHistory(w);
    dropSearchHistory(w);
    refreshHist();
  };

  const clearHist = () => {
    if (hist.length === 0) return;
    clearSearchHistory();
    refreshHist();
    toast("搜索历史已清空");
  };

  // 搜索结果过滤「解说/速看/混剪」（设置页可关）
  const commentaryRe = /解说|速看|混剪|一口气/;
  const filterItems = (items: VideoCard[]): VideoCard[] =>
    settings?.hide_commentary
      ? items.filter((c) => !commentaryRe.test(c.name + c.remarks))
      : items;

  return (
    <div>
      <h1 className="page-title">聚合搜索</h1>
      <p className="page-desc">
        并发搜索当前订阅下所有已启用的可搜索站点，超时站点自动跳过；返回本页不会丢失结果
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <input
          className="input"
          style={{ width: 360, padding: "11px 14px" }}
          placeholder="输入影视名 / 关键词"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch(kw)}
          autoFocus
        />
        <button
          className="btn primary"
          disabled={searching || !kw.trim()}
          onClick={() => doSearch(kw)}
        >
          {searching ? "搜索中…" : "聚合搜索"}
        </button>
        {searching && searchProgress && (
          <span className="search-progress" style={{ marginBottom: 0 }}>
            {searchProgress.done}/{searchProgress.total} · {searchProgress.siteName}{" "}
            {searchProgress.ok ? `找到 ${searchProgress.count} 条` : "失败/超时"}
          </span>
        )}
      </div>

      {/* 历史搜索记录：点击重搜，可单条删除 / 一键清空 */}
      {hist.length > 0 && (
        <div className="hist-box">
          <span className="hist-label">搜索历史</span>
          <div className="hist-chips">
            {hist.map((h) => (
              <span key={h.kw} className="hist-chip" onClick={() => doSearch(h.kw)} title={`点击重新搜索「${h.kw}」`}>
                <span className="hist-kw">{h.kw}</span>
                <span
                  className="hist-x"
                  title="删除该记录"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHist(h.kw);
                  }}
                >
                  ×
                </span>
              </span>
            ))}
          </div>
          <button className="btn small hist-clear" onClick={clearHist}>
            清空
          </button>
        </div>
      )}

      {searchError && (
        <div className="toast-error" style={{ color: "#dc2626", marginBottom: 14 }}>
          搜索失败：{searchError}
        </div>
      )}

      {searchResults.map((g) => {
        const items = filterItems(g.items);
        return (
          <div className="search-group" key={g.site_key}>
            <div className="search-group-head">
              <span style={{ fontWeight: 700 }}>{g.site_name}</span>
              {g.ok ? (
                <span className="cnt">
                  {items.length} 条结果
                  {items.length < g.items.length && (
                    <span className="filtered-hint">（已隐藏 {g.items.length - items.length} 条解说类）</span>
                  )}
                </span>
              ) : (
                <span className="err">失败：{g.message}</span>
              )}
            </div>
            {items.length > 0 && (
              <div className="grid">
                {items.map((c) => (
                  <PosterCard
                    key={`${c.site_key}-${c.vod_id}`}
                    card={c}
                    showSite
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {!searching && searchResults.length === 0 && !searchError && !searchKw && (
        <div className="empty">输入关键词开始聚合搜索，历史记录会显示在上方</div>
      )}
      {searching && searchResults.length === 0 && (
        <div className="loading">正在并发查询各站点…</div>
      )}
      {!searching && searchResults.length === 0 && !searchError && searchKw && (
        <div className="empty">
          「{searchKw}」没有搜索到结果
          <button className="btn small" style={{ marginLeft: 10 }} onClick={() => doSearch(searchKw)}>
            重新搜索
          </button>
          <button className="btn small" style={{ marginLeft: 8 }} onClick={resetSearch}>
            清空结果
          </button>
        </div>
      )}
    </div>
  );
}
