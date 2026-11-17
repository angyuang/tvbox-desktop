import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PosterCard from "../components/PosterCard";
import { api, EVENTS, onEvent } from "../api";
import { useApp } from "../store";
import type { SearchResultGroup, VideoCard } from "../types";

interface ProgressInfo {
  done: number;
  total: number;
  siteKey: string;
  siteName: string;
  ok: boolean;
  count: number;
}

export default function Search() {
  const { settings } = useApp();
  const [params] = useSearchParams();
  const [kw, setKw] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<SearchResultGroup[]>([]);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const kwRef = useRef("");

  const doSearch = useCallback(async (word: string) => {
    const w = word.trim();
    if (!w) return;
    kwRef.current = w;
    setResults([]);
    setError("");
    setSearching(true);
    setProgress(null);
    try {
      const res = await api.aggregateSearch(w);
      // 只保留当前关键词的结果，防止竞态
      if (kwRef.current === w) setResults(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
      setProgress(null);
    }
  }, []);

  // 初始自动搜索
  useEffect(() => {
    const q = params.get("q");
    if (q) doSearch(q);
  }, [params, doSearch]);

  // 进度事件
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<ProgressInfo>(EVENTS.SEARCH_PROGRESS, (p) => setProgress(p)).then(
      (f) => (un = f)
    );
    return () => un?.();
  }, []);

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
        并发搜索当前订阅下所有可搜索站点（CMS / 网页规则站），超时站点自动跳过
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
        {searching && progress && (
          <span className="search-progress" style={{ marginBottom: 0 }}>
            {progress.done}/{progress.total} · {progress.siteName}{" "}
            {progress.ok ? `找到 ${progress.count} 条` : "失败/超时"}
          </span>
        )}
      </div>

      {error && (
        <div className="toast-error" style={{ color: "var(--danger)", marginBottom: 14 }}>
          搜索失败：{error}
        </div>
      )}

      {results.map((g) => {
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

      {!searching && results.length === 0 && !error && (
        <div className="empty">输入关键词开始聚合搜索</div>
      )}
      {searching && results.length === 0 && (
        <div className="loading">正在并发查询各站点…</div>
      )}
    </div>
  );
}
