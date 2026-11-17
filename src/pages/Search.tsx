import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PosterCard from "../components/PosterCard";
import { EVENTS, onEvent } from "../api";
import { useApp } from "../store";
import type { VideoCard } from "../types";
import type { SearchProgressInfo } from "../store";

export default function Search() {
  const {
    settings,
    searchKw,
    searchResults,
    searching,
    searchError,
    searchProgress,
    lastSearched,
    runSearch,
    clearSearch,
  } = useApp();
  const [params] = useSearchParams();
  // 输入框本地草稿：优先 URL 参数，其次上次搜索词
  const [kw, setKw] = useState(() => params.get("q") ?? searchKw ?? "");
  const [progress, setProgress] = useState<SearchProgressInfo | null>(null);
  const kwRef = useRef("");

  // 仅当 URL 里的关键词与已搜索的不同时才真正发起搜索；
  // 从详情页返回（同关键词）时直接显示上次结果，不发请求。
  useEffect(() => {
    const q = (params.get("q") ?? "").trim();
    if (q && q !== lastSearched && !useApp.getState().searching) {
      kwRef.current = q;
      void runSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const doSearch = (word: string) => {
    const w = word.trim();
    if (!w) return;
    kwRef.current = w;
    void runSearch(w);
  };

  // 进度事件（写入本地 + 全局：中途离开再回来也能看到进度）
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<SearchProgressInfo>(EVENTS.SEARCH_PROGRESS, (p) => {
      setProgress(p);
      useApp.setState({ searchProgress: p });
    }).then((f) => (un = f));
    return () => un?.();
  }, []);

  // 搜索结果过滤「解说/速看/混剪」（设置页可关）
  const commentaryRe = /解说|速看|混剪|一口气/;
  const filterItems = (items: VideoCard[]): VideoCard[] =>
    settings?.hide_commentary
      ? items.filter((c) => !commentaryRe.test(c.name + c.remarks))
      : items;

  const showProgress = searching ? progress ?? searchProgress : null;

  return (
    <div>
      <h1 className="page-title">聚合搜索</h1>
      <p className="page-desc">
        并发搜索当前订阅下所有可搜索站点（CMS / 网页规则站），超时站点自动跳过；进入详情页再返回不会丢失结果
      </p>

      <div className="row" style={{ marginBottom: 18 }}>
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
        {lastSearched && !searching && (
          <button
            className="btn small"
            onClick={() => {
              clearSearch();
              setKw("");
            }}
            title="清空当前搜索结果"
          >
            清空结果
          </button>
        )}
        {showProgress && (
          <span className="search-progress" style={{ marginBottom: 0 }}>
            {showProgress.done}/{showProgress.total} · {showProgress.siteName}{" "}
            {showProgress.ok ? `找到 ${showProgress.count} 条` : "失败/超时"}
          </span>
        )}
      </div>

      {searchError && (
        <div className="toast-error" style={{ color: "var(--danger)", marginBottom: 14 }}>
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

      {!searching && searchResults.length === 0 && !searchError && (
        <div className="empty">输入关键词开始聚合搜索</div>
      )}
      {searching && searchResults.length === 0 && (
        <div className="loading">正在并发查询各站点…</div>
      )}
    </div>
  );
}
