import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import Player from "../components/Player";
import { api, EVENTS, onEvent, openExternal } from "../api";
import { useApp } from "../store";
import { isRoomUrl } from "../types";
import type { VideoDetail } from "../types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export default function Detail() {
  const { siteKey, vodId } = useParams();
  const [sp] = useSearchParams();
  const { toast, favorites, history, reloadFavorites, state: appState } = useApp();
  const parses = appState?.activeConfig?.parses ?? [];

  // 搜索页跳转的自动播放参数：?src=片源序号&ep=集序号&auto=1
  const autoKey = `${sp.get("auto") ?? ""}|${sp.get("src") ?? ""}|${sp.get("ep") ?? ""}`;

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

  // 指向最新一版 playEpisode，供详情加载 effect 调用（避免依赖顺序问题）
  const playRef = useRef<(si: number, ei: number) => void>(() => undefined);

  // 加载详情 + 自动播放（来自搜索页）+ 历史恢复
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
        const [auto, srcParam, epParam] = autoKey.split("|");
        if (auto === "1") {
          // 从聚合搜索点进来的：直接按指定片源/集数播放（与详情页选集同一条管线）
          const si = clamp(Number(srcParam) || 0, 0, Math.max(0, d.sources.length - 1));
          const srcObj = d.sources[si];
          const ei = clamp(
            Number(epParam) || 0,
            0,
            Math.max(0, (srcObj?.episodes.length ?? 1) - 1)
          );
          setSourceIdx(si);
          setEpIdx(ei);
          if (srcObj) playRef.current(si, ei);
        } else {
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
  }, [siteKey, vodId, autoKey]);

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
        setStartPos((p) => p); // 保持
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
    setFoundLinks([]);
    if (ep.is_web) {
      setSniffing(true);
      try {
        // 主通道：HTML 直取
        const links = await api.sniffPage(ep.url);
        if (links.length === 1) {
          // 只嗅探到 1 条直链：无需让用户选择，直接内嵌播放
          setPlayUrl(links[0]);
          toast("已自动选择嗅探到的直链播放", "success");
        } else if (links.length > 1) {
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

  playRef.current = playEpisode;

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

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn small" onClick={() => window.history.back()}>
          ← 返回
        </button>
        <span style={{ color: "#6b7280", fontSize: 13 }}>
          来源：{detail.site_name}
        </span>
      </div>

      <div className="detail-layout">
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

        <div>
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
            {detail.actor && (
              <div className="desc">演员：{detail.actor}</div>
            )}
            {detail.director && (
              <div className="desc">导演：{detail.director}</div>
            )}
            {detail.content && <div className="desc">{detail.content}</div>}
          </div>

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
                <span style={{ color: "#9ca3af" }}>没有可播放的选集</span>
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

      {/* 嗅探直链选择 */}
      {(sniffing || foundLinks.length > 0) && (
        <div className="card" style={{ marginTop: 18, padding: 16 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <b>嗅探结果</b>
            {sniffing && <span style={{ color: "#6b7280" }}>嗅探中…</span>}
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
      )}

      {/* 播放器 */}
      {playUrl && (
        <div style={{ marginTop: 20 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b>正在播放</b>
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
              用外部播放器打开
            </button>
          </div>
          <Player
            url={playUrl}
            poster={detail.pic}
            startPos={startPos}
            onProgress={handleProgress}
          />
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
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
            观看进度每 8 秒自动保存；网页线路（选集右上角标“嗅”）会先嗅探直链再播放，嗅探不到时依次尝试解析接口，也可一键交给外部播放器。
          </div>
        </div>
      )}
    </div>
  );
}
