import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../store";
import { getSourcePool } from "./pool";
import type { PoolEntry, VideoDetail } from "../types";

export default function Detail() {
  const { siteKey, vodId } = useParams();
  const nav = useNavigate();
  const { toast, favorites, reloadFavorites } = useApp();

  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [lineIdx, setLineIdx] = useState(0);
  // 跨站片源池：同一部影片在各站点的线路（异步聚合 + 缓存）
  const [pool, setPool] = useState<PoolEntry[] | null>(null);
  const [poolErr, setPoolErr] = useState(false);

  // 加载详情
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setDetail(null);
      setLineIdx(0);
      try {
        const d = await api.getDetail(siteKey!, Number(vodId));
        if (!alive) return;
        setDetail(d);
      } catch (e) {
        if (alive) toast(String(e), "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, vodId]);

  // 后台聚合跨站片源池（不阻塞详情展示）
  useEffect(() => {
    if (!detail?.name) return;
    let alive = true;
    setPool(null);
    setPoolErr(false);
    getSourcePool(detail.name)
      .then((list) => {
        if (alive) setPool(list);
      })
      .catch(() => {
        if (alive) setPoolErr(true);
      });
    return () => {
      alive = false;
    };
  }, [detail?.name]);

  // 收藏
  const isFav =
    detail &&
    favorites.some(
      (f) => f.site_key === detail.site_key && f.vod_id === detail.vod_id
    );
  const toggleFav = async () => {
    if (!detail) return;
    if (isFav) {
      await api.removeFavorite(detail.site_key, detail.vod_id);
      toast("已取消收藏");
    } else {
      await api.addFavorite({
        site_key: detail.site_key,
        site_name: detail.site_name,
        vod_id: detail.vod_id,
        name: detail.name,
        pic: detail.pic,
        remarks: detail.remarks,
        added_at: 0,
      });
      toast("已收藏", "success");
    }
    reloadFavorites();
  };

  const lineCount = detail?.sources.length ?? 0;
  const epCount = useMemo(
    () => detail?.sources.reduce((n, s) => n + s.episodes.length, 0) ?? 0,
    [detail]
  );
  const otherPoolCount = pool?.length ?? 0;

  if (loading) return <div className="loading">加载详情…</div>;
  if (!detail) return <div className="empty">详情加载失败，请重试</div>;

  const src = detail.sources[lineIdx];

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn small" onClick={() => window.history.back()}>
          ← 返回
        </button>
        <span style={{ color: "#6b7280", fontSize: 13 }}>
          {detail.site_name}（{detail.type_name || "影视源"}）
        </span>
      </div>

      {/* 上：视频介绍 */}
      <div className="detail-layout">
        <div>
          {detail.pic ? (
            <img className="detail-poster" src={detail.pic} alt={detail.name} />
          ) : (
            <div className="detail-poster" />
          )}
        </div>

        <div className="detail-info">
          <h2>{detail.name}</h2>
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            {detail.score && !["0", "0.0"].includes(detail.score) && (
              <span className="big-score">{detail.score}</span>
            )}
            <div className="tags" style={{ margin: 0 }}>
              {detail.year && <span className="tag">{detail.year}</span>}
              {detail.area && <span className="tag">{detail.area}</span>}
              {detail.type_name && (
                <span className="tag">{detail.type_name}</span>
              )}
              {detail.remarks && <span className="tag">{detail.remarks}</span>}
            </div>
          </div>
          {detail.director && (
            <div className="desc">导演 {detail.director}</div>
          )}
          {detail.actor && <div className="desc">主演 {detail.actor}</div>}
          {detail.content && <div className="desc">{detail.content}</div>}

          <div className="row" style={{ marginTop: 4, flexWrap: "wrap" }}>
            <button
              className="btn primary"
              onClick={() => nav(`/play/${detail.site_key}/${detail.vod_id}`)}
              title="进入播放页：有观看记录则从上次位置继续，否则从第 1 集开始"
            >
              ▶ 立即播放
            </button>
            <button className="btn" onClick={toggleFav}>
              {isFav ? "★ 已收藏（点击取消）" : "☆ 收藏"}
            </button>
            <span style={{ color: "var(--text3)", fontSize: 13 }}>
              共 {lineCount} 条线路，{epCount} 个剧集
            </span>
          </div>
          {otherPoolCount > 1 && (
            <div style={{ color: "var(--text3)", fontSize: 13, marginTop: 10 }}>
              还有 {otherPoolCount - 1} 个片源 在下面选一个片源
            </div>
          )}
        </div>
      </div>

      {/* 中：选择片源（跨站点换源） */}
      <div className="section-title" style={{ marginTop: 26 }}>
        <b>选择片源</b>
        <div className="spacer" />
        <span className="section-hint">
          {pool === null
            ? poolErr
              ? "片源匹配失败，可稍后重试"
              : "正在匹配同一部影片的其它站点…"
            : otherPoolCount > 0
              ? `同一部影片在 ${otherPoolCount} 个站点上都有，点一下换源，选集进度会重新加载`
              : "其它站点没有匹配到这部影片"}
        </span>
      </div>
      {pool && pool.length > 0 && (
        <div className="pool-grid">
          {pool.map((e) => {
            const isCur = e.site_key === detail.site_key;
            return (
              <div
                key={`${e.site_key}-${e.vod_id}`}
                className={`pool-card ${isCur ? "active" : ""}`}
                onClick={() => {
                  if (isCur) return;
                  nav(`/detail/${e.site_key}/${e.vod_id}`);
                }}
                title={
                  e.lines.length > 0
                    ? `${e.site_name} · ${e.lines
                        .map((l) => `${l.name}(${l.count}集)`)
                        .join(" / ")}`
                    : e.site_name
                }
              >
                <span className="pool-play">{isCur ? "✓" : "▶"}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="pool-name">
                    {e.site_name}
                    {isCur && <span className="pool-cur">正在看</span>}
                  </div>
                  <div className="pool-sub">
                    {e.remarks ||
                      (e.vod_name !== detail.name ? `该源片名: ${e.vod_name}` : "")}
                  </div>
                </div>
                {!isCur && <span className="pool-switch">切换 ›</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* 下：选集（当前站点的线路 + 集数） */}
      <div className="section-title" style={{ marginTop: 26 }}>
        <b>选集</b>
        <div className="spacer" />
        <span className="section-hint">点击集数进入播放页内嵌播放</span>
      </div>
      <div className="episodes">
        <div className="src-tabs">
          {detail.sources.map((s, i) => (
            <span
              key={s.name + i}
              className={`chip ${i === lineIdx ? "active" : ""}`}
              onClick={() => setLineIdx(i)}
            >
              {s.name}（{s.episodes.length}集）
            </span>
          ))}
          {detail.sources.length === 0 && (
            <span style={{ color: "#9ca3af" }}>没有可播放的选集</span>
          )}
        </div>

        {src && (
          <div className="ep-grid">
            {src.episodes.map((ep, ei) => (
              <span
                key={ei}
                className="ep-btn"
                onClick={() =>
                  nav(
                    `/play/${detail.site_key}/${detail.vod_id}?src=${lineIdx}&ep=${ei}&auto=1`
                  )
                }
                title={ep.is_web ? "网页线路：进入播放页自动嗅探直链" : ep.url}
              >
                {ep.is_web && <span className="web-flag">嗅</span>}
                {ep.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
