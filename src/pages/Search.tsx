import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EVENTS, onEvent } from "../api";
import {
  useApp,
  useSearch,
  loadSearchHistory,
  removeSearchHistory,
} from "../store";
import type { SearchProgress } from "../store";
import type { SearchResultGroup, VideoCard } from "../types";

// 合并后的结果卡片：同名影片跨站点聚合
interface MergedCard {
  title: string;
  pic: string;
  remarks: string;
  score: string;
  sites: { siteKey: string; siteName: string; vodId: number }[];
}

const commentaryRe = /解说|速看|混剪|一口气/;

export default function Search() {
  const nav = useNavigate();
  const { settings } = useApp();
  const {
    kw,
    results,
    searching,
    error,
    progress,
    searchedKw,
    setKw,
    setProgress,
    search,
    clearResults,
  } = useSearch();
  const [params] = useSearchParams();
  const [hist, setHist] = useState<string[]>(() => loadSearchHistory());
  // 解说过滤：初始值取设置页「过滤解说」，工具栏 chip 可临时开关
  const [filterOn, setFilterOn] = useState<boolean>(
    settings?.hide_commentary ?? true
  );
  // 来源站点筛选（空 = 全部站点）
  const [siteFilter, setSiteFilter] = useState("");

  const refreshHist = () => setHist(loadSearchHistory());

  // 进度事件 -> 写入全局 store（切走页面也能继续收）
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<SearchProgress>(EVENTS.SEARCH_PROGRESS, (p) => setProgress(p)).then(
      (f) => (un = f)
    );
    return () => un?.();
  }, [setProgress]);

  const doSearch = useCallback(
    async (word: string) => {
      setSiteFilter("");
      await search(word);
      refreshHist();
    },
    [search]
  );

  // 带 q 参数进入：只有与已缓存关键词不同才重新搜索（状态保活，避免无谓重搜）
  useEffect(() => {
    const q = params.get("q");
    if (q && q.trim() && q.trim() !== searchedKw) doSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, searchedKw]);

  // 设置变化时同步过滤开关
  useEffect(() => {
    if (settings) setFilterOn(settings.hide_commentary);
  }, [settings]);

  // 统计 + 合并（同名影片归并为一张卡）
  const {
    responded,
    totalSites,
    hits,
    hidden,
    merged,
    chipGroups,
  } = useMemo(() => {
    const kept = (items: VideoCard[]) =>
      filterOn ? items.filter((c) => !commentaryRe.test(c.name + c.remarks)) : items;

    let hits = 0;
    let hidden = 0;
    const byTitle = new Map<string, MergedCard>();
    const merged: MergedCard[] = [];
    const chipGroups: {
      siteKey: string;
      siteName: string;
      count: number;
      ok: boolean;
    }[] = [];

    for (const g of results as SearchResultGroup[]) {
      const items = kept(g.items);
      hidden += g.items.length - items.length;
      chipGroups.push({
        siteKey: g.site_key,
        siteName: g.site_name,
        count: g.ok ? items.length : 0,
        ok: g.ok,
      });
      if (!g.ok) continue;
      hits += items.length;
      for (const c of items) {
        const key = c.name.replace(/\s+/g, "");
        let m = byTitle.get(key);
        if (!m) {
          m = { title: c.name, pic: "", remarks: "", score: "", sites: [] };
          byTitle.set(key, m);
          merged.push(m);
        }
        m.sites.push({ siteKey: c.site_key, siteName: c.site_name, vodId: c.vod_id });
        if (!m.pic && c.pic) m.pic = c.pic;
        if (!m.remarks && c.remarks) m.remarks = c.remarks;
        if ((!m.score || m.score === "0") && c.score && c.score !== "0") {
          m.score = c.score;
        }
      }
    }
    const totalSites = results.length;
    const responded = results.filter((g) => g.ok).length;
    return { responded, totalSites, hits, hidden, merged, chipGroups };
  }, [results, filterOn]);

  // 展示的卡片：按来源站点筛选
  const visible = useMemo(
    () =>
      siteFilter
        ? merged.filter((m) => m.sites.some((s) => s.siteKey === siteFilter))
        : merged,
    [merged, siteFilter]
  );

  // 点击卡片：筛选了某站点时优先用该站点的 vod，否则用第一个来源站点
  const openCard = (m: MergedCard) => {
    const target = siteFilter
      ? m.sites.find((s) => s.siteKey === siteFilter)
      : m.sites[0];
    if (target) nav(`/detail/${target.siteKey}/${target.vodId}`);
  };

  return (
    <div>
      <h1 className="page-title">聚合搜索</h1>
      <p className="page-desc">
        并发搜索当前订阅下所有可搜索站点，同名影片自动合并为一张卡片；切换页面后搜索结果保留
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
      </div>

      {/* 搜索历史：点击回填关键词重新搜索 */}
      {hist.length > 0 && (
        <div className="search-history">
          <span className="search-history-label">搜索历史</span>
          <div className="search-history-chips">
            {hist.slice(0, 10).map((w) => (
              <span
                key={w}
                className="chip hist-chip"
                onClick={() => doSearch(w)}
                title={`点击重新搜索「${w}」`}
              >
                {w}
                <span
                  className="hist-del"
                  title="删除该条记录"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSearchHistory(w);
                    refreshHist();
                  }}
                >
                  ×
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          className="toast-error"
          style={{ color: "var(--danger)", marginBottom: 14 }}
        >
          搜索失败：{error}
        </div>
      )}

      {/* 统计行 + 工具行 */}
      {(results.length > 0 || searching) && (
        <div className="search-stats-bar">
          <div className="search-stats">
            {kw.trim() && <b>「{kw.trim()}」</b>}
            <span>
              · {responded}/{totalSites} 个站点有响应 · 命中 {hits} 条 · 合并后{" "}
              {merged.length} 部
              {filterOn && hidden > 0 && ` · 已挡掉 ${hidden} 条解说`}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {searching && progress && (
              <span className="search-live">
                <span className="spin">⟳</span> 正在搜索 {progress.done}/
                {progress.total}
              </span>
            )}
            {results.length > 0 && (
              <>
                <button
                  className="btn small"
                  onClick={() => {
                    clearResults();
                    setSiteFilter("");
                  }}
                >
                  清空结果
                </button>
                <span
                  className={`chip ${filterOn ? "active" : ""}`}
                  onClick={() => setFilterOn((v) => !v)}
                  title="过滤标题/备注含「解说、速看、混剪」的结果（默认值在设置页修改）"
                >
                  {filterOn ? "过滤解说" : "不过滤解说"}
                  {filterOn && hidden > 0 ? ` ${hidden}` : ""}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* 来源站点筛选标签 */}
      {results.length > 0 && (
        <div className="src-chips">
          <span
            className={`chip ${siteFilter === "" ? "active" : ""}`}
            onClick={() => setSiteFilter("")}
          >
            全部站点 {merged.length}
          </span>
          {chipGroups.map((g) => (
            <span
              key={g.siteKey}
              className={`chip ${siteFilter === g.siteKey ? "active" : ""}`}
              onClick={() =>
                setSiteFilter((v) => (v === g.siteKey ? "" : g.siteKey))
              }
              title={
                g.ok
                  ? `${g.siteName}：命中 ${g.count} 条`
                  : `${g.siteName}：失败/超时`
              }
            >
              <span
                className={`dot ${g.ok && g.count > 0 ? "ok" : "bad"}`}
              />
              {g.siteName} {g.count}
            </span>
          ))}
        </div>
      )}

      {/* 合并后的海报网格 */}
      {visible.length > 0 && (
        <div className="grid">
          {visible.map((m) => {
            const entry = siteFilter
              ? m.sites.find((s) => s.siteKey === siteFilter)
              : m.sites[0];
            return (
              <div
                key={m.title + m.sites[0]?.siteKey}
                className="poster-card"
                onClick={() => openCard(m)}
                title={`${m.title}（${m.sites.length} 个源）`}
              >
                {m.pic ? (
                  <img
                    className="cover"
                    src={m.pic}
                    alt={m.title}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                ) : (
                  <div className="cover-empty">▶</div>
                )}
                {m.remarks && (
                  <span className="remarks-badge">{m.remarks}</span>
                )}
                <div className="info">
                  <div className="title">{m.title}</div>
                  <div className="meta merged-meta">
                    {m.remarks && <span>{m.remarks}</span>}
                    {m.score && m.score !== "0" && (
                      <span className="score">{m.score}</span>
                    )}
                  </div>
                  <div className="merged-tags">
                    {entry && <span className="mini-tag">{entry.siteName}</span>}
                    <span className="mini-tag accent">
                      {m.sites.length} 个源
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!searching && results.length === 0 && !error && (
        <div className="empty">输入关键词开始聚合搜索</div>
      )}
      {searching && results.length === 0 && (
        <div className="loading">正在并发查询各站点…</div>
      )}
      {!searching && results.length > 0 && visible.length === 0 && (
        <div className="empty">该站点没有命中的结果</div>
      )}
    </div>
  );
}
