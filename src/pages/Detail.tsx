import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Player from "../components/Player";
import { api, EVENTS, onEvent, openExternal } from "../api";
import { useApp } from "../store";
import { isRoomUrl } from "../types";
import type { VideoDetail } from "../types";

export default function Detail() {
  const { siteKey, vodId } = useParams();
  const { toast, favorites, history, reloadFavorites, state: appState } = useApp();
  const parses = appState?.activeConfig?.parses ?? [];

  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [epIdx, setEpIdx] = useState(-1);
  const [playUrl, setPlayUrl] = useState("");
  const [startPos, setStartPos] = useState(0);
  const [sniffing, setSniffing] = useState(false);
  const [foundLinks, setFoundLinks] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");

  const detailRef = useRef<VideoDetail | null>(null);
  const curRef = useRef<{ sourceIdx: number; epIdx: number }>({
    sourceIdx: 0,
    epIdx: -1,
  });
  detailRef.current = detail;
  curRef.current = { sourceIdx, epIdx };

  // 加载详情 + 历史恢复
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setDetail(null);
      setPlayUrl("");
      setEpIdx(-1);
      setStartPos(0);
      setFoundLinks([]);
      try {
        const d = await api.getDetail(siteKey!, Number(vodId));
        if (!alive) return;
        setDetail(d);
        const h = history.find(
          (x) => x.site_key === siteKey && x.vod_id === Number(vodId)
        );
        if (h) {
          const si = d.sources.findIndex((s) => s.name === h.source_name);
          const src = d.sources[si >= 0 ? si : 0];
          const ei =
            h.episode_index >= 0 && h.episode_index < (src?.episodes.length ?? 0)
              ? h.episode_index
              : 0;
          setSourceIdx(si >= 0 ? si : 0);
          setEpIdx(ei);
          setStartPos(h.position_sec > 5 ? h.position_sec : 0);
          const ep = src?.episodes[ei];
          if (ep) {
            if (ep.is_web) {
              // 网页线路不自动嗅探，让用户手动点
              toast(
                `上次看到 ${ep.name}（网页线路），请在选集区点击继续`,
                "info"
              );
            } else {
              resolveAndPlay(ep.url, ep.name);
            }
          }
        }
      } catch (e) {
        toast(String(e), "error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      api.closeSniffer().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, vodId]);

  // 解析房间号 / 直链并播放
  const resolveAndPlay = useCallback(
    async (url: string, label: string) => {
      try {
        if (isRoomUrl(url)) {
          toast(`正在解析房间 ${url} …`);
          const real = await api.resolveRoomUrl(url);
          setPlayUrl(real);
        } else {
          setPlayUrl(url);
        }
      } catch (e) {
        toast(`播放地址解析失败: ${String(e)}`, "error");
      }
      void label;
    },
    [toast]
  );

  // 进度记忆
  const handleProgress = useCallback(
    (pos: number, dur: number) => {
      const d = detailRef.current;
      const { sourceIdx: si, epIdx: ei } = curRef.current;
      if (!d || ei < 0) return;
      const src = d.sources[si];
      const ep = src?.episodes[ei];
      if (!ep) return;
      api
        .saveProgress({
          site_key: d.site_key,
          site_name: d.site_name,
          vod_id: d.vod_id,
          name: d.name,
          pic: d.pic,
          remarks: d.remarks,
          source_name: src.name,
          episode_index: ei,
          episode_name: ep.name,
          episode_url: ep.url,
          position_sec: pos,
          duration_sec: dur,
          updated_at: 0,
        })
        .catch(() => undefined);
    },
    []
  );

  // 嗅探事件（嗅探窗口找到直链）
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<string>(EVENTS.SNIFF_FOUND, (url) => {
      setFoundLinks((prev) => (prev.includes(url) ? prev : [url, ...prev]));
      toast(`嗅探到直链：${url.slice(0, 60)}…`, "success");
    }).then((f) => (un = f));
    return () => un?.();
  }, [toast]);

  // 点击选集
  const playEpisode = async (si: number, ei: number) => {
    if (!detail) return;
    const ep = detail.sources[si]?.episodes[ei];
    if (!ep) return;
    setSourceIdx(si);
    setEpIdx(ei);
    // 手动切集时清除历史起播位置，避免新集从旧位置开始
    setStartPos(0);
    setFoundLinks([]);
    if (ep.is_web) {
      setSniffing(true);
      try {
        // 主通道：HTML 直取
        const links = await api.sniffPage(ep.url);
        if (links.length > 0) {
          setFoundLinks(links);
          toast(`HTML 直取嗅探到 ${links.length} 条直链，请选择`, "success");
        } else if (parses.length > 0) {
          // 解析接口兜底：依次尝试订阅里的 parses，失败的自动换下一个
          toast("页面未含直链，尝试解析接口…");
          let resolved: string | null = null;
          for (const p of parses) {
            if (!p.url) continue;
            try {
              const u = await api.resolveParse(p.url, ep.url);
              if (u) {
                resolved = u;
                toast(`已用解析接口「${p.name || "未命名"}」取得直链`, "success");
                break;
              }
            } catch {
              /* 换下一个接口 */
            }
          }
          if (resolved) {
            setPlayUrl(resolved);
          } else {
            toast("解析接口均未命中，已打开嗅探窗口…");
            await api.openSniffer(ep.url);
          }
        } else {
          // 增强通道：嗅探窗口
          toast("页面未直接包含直链，已打开嗅探窗口…");
          await api.openSniffer(ep.url);
        }
      } catch (e) {
        toast(`嗅探失败: ${String(e)}，请尝试外部播放`, "error");
      } finally {
        setSniffing(false);
      }
    } else if (isRoomUrl(ep.url)) {
      resolveAndPlay(ep.url, ep.name);
    } else {
      setPlayUrl(ep.url);
    }
  };

  // 上/下一集
  const stepEpisode = (delta: number) => {
    if (!detail) return;
    const { sourceIdx: si, epIdx: ei } = curRef.current;
    const s = detail.sources[si];
    if (!s || ei < 0) return;
    const ni = Math.min(s.episodes.length - 1, Math.max(0, ei + delta));
    if (ni !== ei) playEpisode(si, ni);
  };

  // 复制直链
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(playUrl);
      toast("已复制播放地址", "success");
    } catch {
      toast("复制失败，请手动选择地址复制", "error");
    }
  };

  // AI 总结本集（只发送元信息，不发送播放地址）
  const runAiSummary = async () => {
    if (!detail || aiBusy) return;
    setAiBusy(true);
    setAiText("");
    const { sourceIdx: si, epIdx: ei } = curRef.current;
    const ep = detail.sources[si]?.episodes[ei];
    try {
      const text = await api.aiSummary({
        name: detail.name,
        episode: ep?.name ?? "",
        typeName: detail.type_name,
        year: detail.year,
        actor: detail.actor,
        content: detail.content,
      });
      setAiText(text);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setAiBusy(false);
    }
  };

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

  if (loading) return <div className="loading">加载详情…</div>;
  if (!detail) return <div className="empty">详情加载失败，请重试</div>;

  const src = detail.sources[sourceIdx];
  const curEp = src?.episodes[epIdx];

  // 海报 + 收藏（两种布局共用）
  const posterBlock = (
    <div>
      {detail.pic ? (
        <img className="detail-poster" src={detail.pic} alt={detail.name} />
      ) : (
        <div className="detail-poster" />
      )}
      <button
        className="btn"
        style={{ marginTop: 12, width: "100%" }}
        onClick={toggleFav}
      >
        {isFav ? "★ 已收藏（点击取消）" : "☆ 收藏"}
      </button>
    </div>
  );

  // 影片元信息（不含选集区）
  const infoBlock = (
    <div className="detail-info">
      <h2>{detail.name}</h2>
      <div className="tags">
        {detail.type_name && <span className="tag">{detail.type_name}</span>}
        {detail.year && <span className="tag">{detail.year}</span>}
        {detail.area && <span className="tag">{detail.area}</span>}
        {detail.remarks && <span className="tag">{detail.remarks}</span>}
        {detail.score && !["0", "0.0"].includes(detail.score) && (
          <span className="tag">★ {detail.score}</span>
        )}
      </div>
      {detail.actor && <div className="desc">演员：{detail.actor}</div>}
      {detail.director && <div className="desc">导演：{detail.director}</div>}
      {detail.content && <div className="desc">{detail.content}</div>}
    </div>
  );

  // 嗅探直链选择（播放视图内展示）
  const sniffCard = (sniffing || foundLinks.length > 0) && (
    <div className="card" style={{ marginTop: 14, padding: 16 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <b>嗅探结果</b>
        {sniffing && (
          <span style={{ color: "var(--text2)" }}>嗅探中…</span>
        )}
        <div className="spacer" />
        <button
          className="btn small"
          onClick={() => {
            setFoundLinks([]);
            api.closeSniffer().catch(() => undefined);
          }}
        >
          关闭
        </button>
      </div>
      {foundLinks.length === 0 ? (
        <div className="loading" style={{ padding: 14 }}>
          正在嗅探网页线路，若窗口打开请等待页面播放出现直链…
        </div>
      ) : (
        foundLinks.map((u, i) => (
          <div key={i} className="row" style={{ marginBottom: 8 }}>
            <div
              className="ep-btn"
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "left",
                padding: "10px 12px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              onClick={() => {
                setPlayUrl(u);
                setFoundLinks([]);
                api.closeSniffer().catch(() => undefined);
              }}
            >
              ▶ 内置播放：{u}
            </div>
            <button className="btn small" onClick={() => openExternal(u, toast)}>
              外部播放
            </button>
          </div>
        ))
      )}
    </div>
  );

  const aiCards = (
    <>
      {aiBusy && (
        <div className="card ai-card" style={{ marginTop: 12 }}>
          AI 正在生成这一集的剧情梗概…（首次调用可能需要几十秒）
        </div>
      )}
      {aiText && (
        <div className="card ai-card" style={{ marginTop: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b>AI 剧情梗概</b>
            <div className="spacer" />
            <button className="btn small" onClick={() => setAiText("")}>
              收起
            </button>
          </div>
          <div style={{ lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiText}</div>
        </div>
      )}
    </>
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn small" onClick={() => window.history.back()}>
          ← 返回
        </button>
        <span style={{ color: "var(--text2)", fontSize: 13 }}>
          来源：{detail.site_name}
        </span>
      </div>

      {playUrl && src ? (
        /* ============ 播放视图：播放器在上，选集面板在右（同页内嵌，不弹窗） ============ */
        <div className="play-layout">
          <div className="play-main">
            <Player
              url={playUrl}
              poster={detail.pic}
              startPos={startPos}
              onProgress={handleProgress}
            />
            <div className="row" style={{ flexWrap: "wrap", marginTop: 4 }}>
              <button
                className="btn small"
                disabled={epIdx <= 0}
                onClick={() => stepEpisode(-1)}
                title="上一集"
              >
                ◀ 上一集
              </button>
              <button
                className="btn small"
                disabled={epIdx < 0 || epIdx >= src.episodes.length - 1}
                onClick={() => stepEpisode(1)}
                title="下一集"
              >
                下一集 ▶
              </button>
              <span className="play-now">
                正在播放：{src.name} · {curEp?.name ?? ""}
              </span>
              <div className="spacer" />
              <button
                className="btn small"
                disabled={aiBusy}
                onClick={runAiSummary}
                title="把片名/集名/类型/年份/演员/简介发给已配置的 AI 模型，生成本集剧情梗概（设置页配置 API Key）"
              >
                {aiBusy ? "AI 总结中…" : "AI 总结本集"}
              </button>
              <button
                className="btn small"
                onClick={() => openExternal(playUrl, toast)}
                title="用 PotPlayer / VLC / mpv 打开当前直链（命令可在设置页配置）"
              >
                外部播放
              </button>
              <button className="btn small" onClick={copyUrl}>
                复制地址
              </button>
            </div>
            <div className="play-url" title={playUrl}>
              直链：{playUrl}
            </div>

            {sniffCard}
            {aiCards}
          </div>

          <aside className="play-side card">
            <div className="side-title">
              选集
              {detail.sources.length > 1 && (
                <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                  点下方片源标签可切换
                </span>
              )}
            </div>
            <div className="src-tabs" style={{ marginBottom: 10 }}>
              {detail.sources.map((s, i) => (
                <span
                  key={s.name + i}
                  className={`chip ${i === sourceIdx ? "active" : ""}`}
                  onClick={() => setSourceIdx(i)}
                >
                  {s.name}（{s.episodes.length}集）
                </span>
              ))}
            </div>
            <div className="ep-grid">
              {src.episodes.map((ep, ei) => (
                <span
                  key={ei}
                  className={`ep-btn ${ei === epIdx ? "active" : ""}`}
                  onClick={() => playEpisode(sourceIdx, ei)}
                  title={ep.is_web ? "网页线路：点击嗅探直链" : ep.url}
                >
                  {ep.is_web && <span className="web-flag">嗅</span>}
                  {ep.name}
                </span>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        /* ============ 未播放：海报 + 简介 + 选集 ============ */
        <div className="detail-layout">
          {posterBlock}
          <div>
            {infoBlock}
            <div className="episodes">
              <div className="src-tabs">
                {detail.sources.map((s, i) => (
                  <span
                    key={s.name + i}
                    className={`chip ${i === sourceIdx ? "active" : ""}`}
                    onClick={() => setSourceIdx(i)}
                  >
                    {s.name}（{s.episodes.length}集）
                  </span>
                ))}
                {detail.sources.length === 0 && (
                  <span style={{ color: "var(--text3)" }}>没有可播放的选集</span>
                )}
              </div>
              {src && (
                <div className="ep-grid">
                  {src.episodes.map((ep, ei) => (
                    <span
                      key={ei}
                      className={`ep-btn ${ei === epIdx ? "active" : ""}`}
                      onClick={() => playEpisode(sourceIdx, ei)}
                      title={ep.is_web ? "网页线路：点击嗅探直链" : ep.url}
                    >
                      {ep.is_web && <span className="web-flag">嗅</span>}
                      {ep.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 播放时的影片信息卡（海报 + 简介；选集已在右侧面板） */}
      {playUrl && (
        <div className="detail-layout play-info-card">
          {posterBlock}
          {infoBlock}
        </div>
      )}

      {playUrl && (
        <div style={{ color: "var(--text3)", fontSize: 12, marginTop: 8 }}>
          观看进度每 8 秒自动保存；网页线路（选集右上角标“嗅”）会先嗅探直链再播放，嗅探不到时依次尝试解析接口，也可一键交给外部播放器。
        </div>
      )}
    </div>
  );
}
