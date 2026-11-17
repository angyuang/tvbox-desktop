import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PosterCard from "../components/PosterCard";
import { api, EVENTS, onEvent } from "../api";
import {
  useApp,
  useSearch,
  loadSearchHistory,
  removeSearchHistory,
} from "../store";
import type { SearchProgress } from "../store";
import type { VideoDetail, VideoCard } from "../types";

// 搜索结果内展开的详情缓存（siteKey:vodId -> detail）
const expandCache = new Map<string, VideoDetail>();

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
  } = useSearch();
  const [params] = useSearchParams();
  const [hist, setHist] = useState<string[]>(() => loadSearchHistory());
  // 展开选集面板的 key（siteKey:vodId）+ 面板状态
  const [expanded, setExpanded] = useState("");
  const [expDetail, setExpDetail] = useState<VideoDetail | null>(null);
  const [expLoading, setExpLoading] = useState(false);
  const [expErr, setExpErr] = useState("");
  const [srcIdx, setSrcIdx] = useState(0);

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
      setExpanded("");
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

  // 展开/收起某个结果的选集面板（详情只拉一次，缓存复用）
  const toggleExpand = async (gSiteKey: string, c: VideoCard) => {
    const key = `${gSiteKey}:${c.vod_id}`;
    if (expanded === key) {
      setExpanded("");
      return;
    }
    setExpanded(key);
    setExpErr("");
    setSrcIdx(0);
    const cached = expandCache.get(key);
    if (cached) {
      setExpDetail(cached);
      return;
    }
    setExpDetail(null);
    setExpLoading(true);
    try {
      const d = await api.getDetail(gSiteKey, c.vod_id);
      expandCache.set(key, d);
      setExpDetail(d);
    } catch (e) {
      setExpErr(String(e));
    } finally {
      setExpLoading(false);
    }
  };

  // 从搜索结果直接点集数 -> 与详情页完全同一条播放管线（?auto=1 自动播放）
  const playFromSearch = (
    siteKey: string,
    vodId: number,
    si: number,
    ei: number
  ) => {
    nav(`/detail/${siteKey}/${vodId}?src=${si}&ep=${ei}&auto=1`);
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
        并发搜索当前订阅下所有可搜索站点（CMS / 网页规则站），超时站点自动跳过；切换页面后搜索结果保留
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

      {results.map((g) => {
        const items = filterItems(g.items);
        const panelVid = expanded.startsWith(`${g.site_key}:`)
          ? Number(expanded.slice(g.site_key.length + 1))
          : null;
        return (
          <div className="search-group" key={g.site_key}>
            <div className="search-group-head">
              <span style={{ fontWeight: 700 }}>{g.site_name}</span>
              {g.ok ? (
                <span className="cnt">
                  {items.length} 条结果
                  {items.length < g.items.length && (
                    <span className="filtered-hint">
                      （已隐藏 {g.items.length - items.length} 条解说类）
                    </span>
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
                    onClick={() => toggleExpand(g.site_key, c)}
                  />
                ))}
              </div>
            )}

            {/* 展开的选集面板：片源标签 + 集数按钮，与详情页同一套数据 */}
            {panelVid !== null && (
              <div
                className="card search-ep-panel"
                style={{ marginTop: 14, padding: 16 }}
              >
                <div className="row" style={{ marginBottom: 10 }}>
                  <b>选择片源与集数</b>
                  {expLoading && (
                    <span style={{ color: "var(--text2)" }}>加载选集中…</span>
                  )}
                  <div className="spacer" />
                  <button className="btn small" onClick={() => setExpanded("")}>
                    收起
                  </button>
                </div>
                {expErr && (
                  <div style={{ color: "var(--danger)", fontSize: 13 }}>
                    加载失败：{expErr}
                  </div>
                )}
                {expDetail && expDetail.sources.length === 0 && (
                  <div style={{ color: "var(--text3)", fontSize: 13 }}>
                    该结果没有可播放的选集
                  </div>
                )}
                {expDetail && expDetail.sources.length > 0 && (
                  <>
                    <div className="src-tabs">
                      {expDetail.sources.map((s, i) => (
                        <span
                          key={s.name + i}
                          className={`chip ${i === srcIdx ? "active" : ""}`}
                          onClick={() => setSrcIdx(i)}
                        >
                          {s.name}（{s.episodes.length}集）
                        </span>
                      ))}
                    </div>
                    {expDetail.sources[srcIdx] && (
                      <div className="ep-grid" style={{ maxHeight: 220 }}>
                        {expDetail.sources[srcIdx].episodes.map((ep, ei) => (
                          <span
                            key={ei}
                            className="ep-btn"
                            title={
                              ep.is_web
                                ? "网页线路：进入播放页自动嗅探直链"
                                : ep.url
                            }
                            onClick={() =>
                              playFromSearch(
                                g.site_key,
                                expDetail.vod_id,
                                srcIdx,
                                ei
                              )
                            }
                          >
                            {ep.is_web && <span className="web-flag">嗅</span>}
                            {ep.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="btn small"
                        onClick={() =>
                          nav(`/detail/${g.site_key}/${expDetail.vod_id}`)
                        }
                      >
                        查看详情页
                      </button>
                      <span style={{ color: "var(--text3)", fontSize: 12 }}>
                        点击集数后进入播放页内嵌播放，与详情页选集行为一致
                      </span>
                    </div>
                  </>
                )}
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
