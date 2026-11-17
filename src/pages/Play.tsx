import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Player from "../components/Player";
import { api, EVENTS, onEvent, openExternal } from "../api";
import { useApp } from "../store";
import { isRoomUrl } from "../types";
import { getSourcePool } from "./pool";
import type { PoolEntry, VideoDetail } from "../types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export default function Play() {
  const { siteKey, vodId } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { toast, history } = useApp();
  const parses = useApp((s) => s.state?.activeConfig?.parses) ?? [];

  // 搜索页/详情页跳转的自动播放参数：?src=线路序号&ep=集序号&auto=1
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
  const [pool, setPool] = useState<PoolEntry[] | null>(null);

  const detailRef = useRef<VideoDetail | null>(null);
  const curRef = useRef<{ sourceIdx: number; epIdx: number }>({
    sourceIdx: 0,
    epIdx: -1,
  });
  detailRef.current = detail;
  curRef.current = { sourceIdx, epIdx };

  // 指向最新一版 playEpisode，供详情加载 effect 调用（避免依赖顺序问题）
  const playRef = useRef<(si: number, ei: number) => void>(() => undefined);

  // 加载详情 + 自动播放（来自详情页/搜索页）+ 历史恢复
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
          // 带参数自动播放：按指定线路/集数
          const si = clamp(
            Number(srcParam) || 0,
            0,
            Math.max(0, d.sources.length - 1)
          );
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
            // 有观看记录：从上次位置继续
            const si = d.sources.findIndex((s) => s.name === h.source_name);
            const useSi = si >= 0 ? si : 0;
            const src = d.sources[useSi];
            const ei =
              h.episode_index >= 0 && h.episode_index < (src?.episodes.length ?? 0)
                ? h.episode_index
                : 0;
            setSourceIdx(useSi);
            setEpIdx(ei);
            setStartPos(h.position_sec > 5 ? h.position_sec : 0);
            const ep = src?.episodes[ei];
            if (ep) {
              if (ep.is_web) {
                toast(`上次看到 ${ep.name}（网页线路），请点击选集继续`, "info");
              } else {
                playRef.current(useSi, ei);
              }
            }
          } else if (d.sources.length > 0 && d.sources[0].episodes.length > 0) {
            // 无记录：直接播第 1 集（对应详情页「立即播放」）
            setSourceIdx(0);
            setEpIdx(0);
            playRef.current(0, 0);
          }
        }
      } catch (e) {
        if (alive) toast(String(e), "error");
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

  // 后台聚合跨站片源池（右侧「片源」chips）
  useEffect(() => {
    if (!detail?.name) return;
    let alive = true;
    setPool(null);
    getSourcePool(detail.name)
      .then((list) => {
        if (alive) setPool(list);
      })
      .catch(() => {
        if (alive) setPool([]);
      });
    return () => {
      alive = false;
    };
  }, [detail?.name]);

  // 嗅探事件（嗅探窗口找到直链）
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<string>(EVENTS.SNIFF_FOUND, (url) => {
      setFoundLinks((prev) => (prev.includes(url) ? prev : [url, ...prev]));
      toast(`嗅探到直链：${url.slice(0, 60)}…`, "success");
    }).then((f) => (un = f));
    return () => un?.();
  }, [toast]);

  // 点击选集（完整解析管线：直链 -> HTML 嗅探 -> 解析接口 -> 嗅探窗口）
  const playEpisode = async (si: number, ei: number) => {
    if (!detail) return;
    const ep = detail.sources[si]?.episodes[ei];
    if (!ep) return;
    setSourceIdx(si);
    setEpIdx(ei);
    setStartPos(0);
    setFoundLinks([]);
    if (ep.is_web) {
      setSniffing(true);
      try {
        // 主通道：HTML 直取
        const links = await api.sniffPage(ep.url);
        if (links.length === 1) {
          setPlayUrl(links[0]);
          toast("已自动选择嗅探到的直链播放", "success");
        } else if (links.length > 1) {
          setFoundLinks(links);
          toast(`HTML 直取嗅探到 ${links.length} 条直链，请选择`, "success");
        } else if (parses.length > 0) {
          // 解析接口兜底：依次尝试订阅里的 parses
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
          toast("页面未直接包含直链，已打开嗅探窗口…");
          await api.openSniffer(ep.url);
        }
      } catch (e) {
        toast(`嗅探失败: ${String(e)}，请尝试外部播放`, "error");
      } finally {
        setSniffing(false);
      }
    } else if (isRoomUrl(ep.url)) {
      try {
        toast(`正在解析房间 ${ep.url} …`);
        const real = await api.resolveRoomUrl(ep.url);
        setPlayUrl(real);
      } catch (e) {
        toast(`播放地址解析失败: ${String(e)}`, "error");
      }
    } else {
      setPlayUrl(ep.url);
    }
  };

  playRef.current = playEpisode;

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

  // 上一集 / 下一集
  const stepEpisode = (delta: number) => {
    if (!detail) return;
    const si = curRef.current.sourceIdx;
    const cur = curRef.current.epIdx;
    const next = cur + delta;
    if (next < 0) {
      toast("已经是第一集");
      return;
    }
    if (next >= (detail.sources[si]?.episodes.length ?? 0)) {
      toast("已经是最后一集");
      return;
    }
    playEpisode(si, next);
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

  const copyUrl = async () => {
    if (!playUrl) return;
    try {
      await navigator.clipboard.writeText(playUrl);
      toast("已复制播放地址", "success");
    } catch {
      toast("复制失败，请手动选择地址文本复制", "error");
    }
  };

  if (loading) return <div className="loading">加载详情…</div>;
  if (!detail) return <div className="empty">详情加载失败，请重试</div>;

  const src = detail.sources[sourceIdx];
  const curEp = src?.episodes[epIdx];
  const totalEp = src?.episodes.length ?? 0;
  const poolChips = pool ?? [];

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={() => window.history.back()}>
          ← 返回
        </button>
        <b>{detail.name}</b>
        {src && (
          <span style={{ color: "var(--text2)", fontSize: 13 }}>
            {src.name}
            {curEp ? ` · ${curEp.name}` : ""}
          </span>
        )}
      </div>

      <div className="play-layout">
        {/* 左：内嵌播放器 + 操作 */}
        <div style={{ minWidth: 0 }}>
          {playUrl ? (
            <Player
              url={playUrl}
              poster={detail.pic}
              startPos={startPos}
              onProgress={handleProgress}
            />
          ) : (
            <div className="player-box play-idle">
              <div className="play-idle-hint">
                {sniffing ? "正在嗅探网页直链…" : "在右侧选集列表中点击集数开始播放"}
              </div>
            </div>
          )}

          <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => stepEpisode(-1)}>
              ‹ 上一集
            </button>
            <button className="btn small" onClick={() => stepEpisode(1)}>
              下一集 ›
            </button>
            <div className="spacer" />
            {playUrl && (
              <>
                <button
                  className="btn small"
                  onClick={() => openExternal(playUrl, toast)}
                  title="用 PotPlayer / VLC / mpv 打开当前直链（命令可在设置页配置）"
                >
                  外部播放器
                </button>
                <button className="btn small" onClick={copyUrl}>
                  复制地址
                </button>
              </>
            )}
          </div>

          {playUrl && (
            <div className="url-row">
              <code className="url-text" title={playUrl}>
                {playUrl}
              </code>
              <button
                className="btn small"
                onClick={() => api.openInBrowser(playUrl).catch((e) => toast(String(e), "error"))}
              >
                浏览器打开
              </button>
            </div>
          )}

          {/* 嗅探直链选择（网页线路嗅到多条时） */}
          {(sniffing || foundLinks.length > 0) && (
            <div className="card" style={{ marginTop: 12, padding: 14 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <b>嗅探结果</b>
                {sniffing && (
                  <span style={{ color: "var(--text3)" }}>嗅探中…</span>
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
                <div className="loading" style={{ padding: 10 }}>
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
                    <button
                      className="btn small"
                      onClick={() => openExternal(u, toast)}
                    >
                      外部播放
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* AI 剧情总结 */}
          <div className="card ai-card" style={{ marginTop: 12, padding: 14 }}>
            <div className="row" style={{ marginBottom: curEp ? 6 : 0 }}>
              <b>AI 剧情总结</b>
              <div className="spacer" />
              {curEp && (
                <>
                  <button
                    className="btn small"
                    disabled={aiBusy}
                    onClick={() =>
                      toast(`第 ${epIdx + 1} 集「${curEp.name}」：${detail.name}，${detail.remarks || "无备注"}`, "info")
                    }
                    title="只看本集资料，不调用 AI"
                  >
                    只看资料
                  </button>
                  <button
                    className="btn small primary"
                    disabled={aiBusy}
                    onClick={runAiSummary}
                    title="把片名/集名/类型/年份/演员/简介发给已配置的 AI 模型，生成本集剧情梗概（设置页配置 API Key）"
                  >
                    {aiBusy ? "AI 总结中…" : "看一遍再总结"}
                  </button>
                </>
              )}
            </div>
            {curEp && (
              <div style={{ color: "var(--text2)", fontSize: 13 }}>
                {curEp.name} · 让 DeepSeek 看一遍这一集
                {aiBusy && "（首次调用可能需要几十秒）"}
              </div>
            )}
            {aiText && (
              <div
                style={{
                  lineHeight: 1.8,
                  whiteSpace: "pre-wrap",
                  marginTop: 10,
                }}
              >
                {aiText}
              </div>
            )}
          </div>

          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
            观看进度每 8 秒自动保存；网页线路（选集右上角标“嗅”）会先嗅探直链再播放，嗅探不到时依次尝试解析接口，也可一键交给外部播放器。
          </div>
        </div>

        {/* 右：片源 + 选集 */}
        <div className="card play-side">
          <div className="row" style={{ marginBottom: 12 }}>
            {detail.pic ? (
              <img
                className="side-poster"
                src={detail.pic}
                alt={detail.name}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="side-poster" />
            )}
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {detail.name}
              </div>
              <div style={{ color: "var(--text3)", fontSize: 12, marginTop: 4 }}>
                {src?.name}
                <br />
                第 {epIdx >= 0 ? epIdx + 1 : 1} / {totalEp} 集
              </div>
            </div>
          </div>

          {/* 片源（跨站点，一个站点多条线路时会有多个 chip） */}
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>片源</b>
            <div className="spacer" />
            <span style={{ color: "var(--text3)", fontSize: 12 }}>
              {pool === null ? "匹配中…" : `${poolChips.length} 条线路`}
            </span>
          </div>
          <div className="pool-chips">
            {poolChips.map((e) =>
              e.lines.map((l, li) => {
                const isCur =
                  e.site_key === detail.site_key && li === sourceIdx;
                const isCurSite = e.site_key === detail.site_key;
                return (
                  <span
                    key={`${e.site_key}-${e.vod_id}-${li}`}
                    className={`chip mini ${isCur ? "active" : ""}`}
                    title={`${e.site_name} · ${l.name}（${l.count}集）${
                      e.vod_name !== detail.name ? ` · 片名: ${e.vod_name}` : ""
                    }`}
                    onClick={() => {
                      if (isCur) return;
                      if (isCurSite) {
                        // 同站点换线路：直接切
                        playEpisode(li, 0);
                      } else {
                        nav(
                          `/play/${e.site_key}/${e.vod_id}?src=${li}&ep=0&auto=1`
                        );
                      }
                    }}
                  >
                    {isCurSite && (isCur ? "✓ " : "")}
                    {e.site_name}
                  </span>
                );
              })
            )}
            {pool !== null && poolChips.length === 0 && (
              <span style={{ color: "var(--text3)", fontSize: 12 }}>
                其它站点没有匹配到这部影片
              </span>
            )}
          </div>

          {/* 选集网格（当前线路） */}
          <div className="row" style={{ margin: "14px 0 8px" }}>
            <b style={{ fontSize: 14 }}>选集</b>
            <div className="spacer" />
            <span style={{ color: "var(--text3)", fontSize: 12 }}>
              共 {totalEp} 集
            </span>
          </div>
          {src && (
            <div className="ep-grid side-ep-grid">
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
  );
}
