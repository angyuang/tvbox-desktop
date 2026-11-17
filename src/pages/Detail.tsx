import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Player from "../components/Player";
import { api, EVENTS, onEvent, openExternal } from "../api";
import { useApp } from "../store";
import { isRoomUrl } from "../types";
import type { PlaySource, VideoDetail } from "../types";

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
  const [needManual, setNeedManual] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiText, setAiText] = useState("");

  const detailRef = useRef<VideoDetail | null>(null);
  const curRef = useRef<{ sourceIdx: number; epIdx: number }>({
    sourceIdx: 0,
    epIdx: -1,
  });
  const sniffingRef = useRef(false);
  const foundLinksRef = useRef<string[]>([]);
  detailRef.current = detail;
  curRef.current = { sourceIdx, epIdx };
  sniffingRef.current = sniffing;
  foundLinksRef.current = foundLinks;

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
      setNeedManual(false);
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

  // 嗅探窗口捕获直链：首条自动播放，后续进列表可切换
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<string>(EVENTS.SNIFF_FOUND, (url) => {
      const prev = foundLinksRef.current;
      const next = prev.includes(url) ? prev : [url, ...prev];
      foundLinksRef.current = next;
      setFoundLinks(next);
      setNeedManual(false);
      if (prev.length === 0) {
        setPlayUrl(url);
        toast("嗅探窗口已捕获直链，开始播放", "success");
      } else {
        toast(`嗅探窗口又捕获 1 条直链，共 ${next.length} 条`, "info");
      }
    }).then((f) => (un = f));
    return () => un?.();
  }, [toast]);

  // 点击选集：直链直接播；网页线路 HTML 直取嗅探 -> 1 条自动播放，
  // 多条自动播最优线路并给出更换列表；彻底失败才请用户手动开嗅探窗口
  const playEpisode = async (si: number, ei: number) => {
    if (!detail) return;
    if (sniffingRef.current) {
      toast("正在嗅探上一集，请稍候…");
      return;
    }
    const ep = detail.sources[si]?.episodes[ei];
    if (!ep) return;
    setSourceIdx(si);
    setEpIdx(ei);
    setFoundLinks([]);
    foundLinksRef.current = [];
    setNeedManual(false);
    setStartPos(0); // 手动切集从头播（历史续播位置只在恢复流程使用）
    if (ep.is_web) {
      setSniffing(true);
      try {
        // 主通道：HTML 直取（服务端已做转义还原/解包裹/排序）
        const links = await api.sniffPage(ep.url);
        if (links.length === 1) {
          setPlayUrl(links[0]);
          toast("已嗅探到直链，开始播放", "success");
          return;
        }
        if (links.length > 1) {
          // 已按 m3u8 优先排序：自动播第一条，其余留在列表里随时换
          setFoundLinks(links);
          setPlayUrl(links[0]);
          toast(
            `已嗅探到 ${links.length} 条直链，已自动播放最优先线路，可在下方列表更换`,
            "success"
          );
          return;
        }
        // 0 条：解析接口兜底，依次尝试订阅里的 parses
        if (parses.length > 0) {
          toast("页面未直接含直链，尝试解析接口…");
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
            return;
          }
        }
        // 彻底失败：不再自动弹嗅探窗口（避免"突然弹窗播放"），把选择权留给用户
        setNeedManual(true);
        toast("未能自动取得直链，可在下方打开嗅探窗口重试，或用外部播放器", "error");
      } catch (e) {
        setNeedManual(true);
        toast(`嗅探失败: ${String(e)}`, "error");
      } finally {
        setSniffing(false);
      }
    } else if (isRoomUrl(ep.url)) {
      resolveAndPlay(ep.url, ep.name);
    } else {
      setPlayUrl(ep.url);
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

  // 复制直链
  const copyUrl = async () => {
    if (!playUrl) return;
    try {
      await navigator.clipboard.writeText(playUrl);
      toast("直链已复制到剪贴板", "success");
    } catch {
      toast("复制失败，请手动复制", "error");
    }
  };

  if (loading) return <div className="loading">加载详情…</div>;
  if (!detail) return <div className="empty">详情加载失败，请重试</div>;

  const src: PlaySource | undefined = detail.sources[sourceIdx];

  // 片源标签 + 选集网格（详情布局 / 播放布局两处复用）
  const renderSourceTabs = () => (
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
  );
  const renderEpGrid = (tall?: boolean) => (
    <div className={`ep-grid ${tall ? "tall" : ""}`}>
      {src?.episodes.map((ep, ei) => (
        <span
          key={ei}
          className={`ep-btn ${ei === epIdx ? "active" : ""}`}
          onClick={() => playEpisode(sourceIdx, ei)}
          title={ep.is_web ? "网页线路：点击自动嗅探直链并播放" : ep.url}
        >
          {ep.is_web && <span className="web-flag">嗅</span>}
          {ep.name}
        </span>
      ))}
    </div>
  );
  const renderInfoTags = () => (
    <>
      {detail.type_name && <span className="tag">{detail.type_name}</span>}
      {detail.year && <span className="tag">{detail.year}</span>}
      {detail.area && <span className="tag">{detail.area}</span>}
      {detail.remarks && <span className="tag">{detail.remarks}</span>}
      {detail.score && !["0", "0.0"].includes(detail.score) && (
        <span className="tag">★ {detail.score}</span>
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

      {playUrl ? (
        // ---------- 播放布局：播放器 + 右侧选集面板 ----------
        <>
          <div className="play-layout">
            <div className="play-main">
              <Player
                url={playUrl}
                poster={detail.pic}
                startPos={startPos}
                onProgress={handleProgress}
              />
              <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="btn small"
                  disabled={epIdx <= 0}
                  onClick={() => playEpisode(sourceIdx, epIdx - 1)}
                >
                  ◀ 上一集
                </button>
                <button
                  className="btn small"
                  disabled={!src || epIdx < 0 || epIdx >= src.episodes.length - 1}
                  onClick={() => playEpisode(sourceIdx, epIdx + 1)}
                >
                  下一集 ▶
                </button>
                <span className="playing-label">
                  正在播放：{src?.name} · {src?.episodes[epIdx]?.name ?? "…"}
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
                <button className="btn small" onClick={copyUrl} title="复制当前直链">
                  复制地址
                </button>
              </div>
              <div className="play-durl" title={playUrl}>
                直链：{playUrl}
              </div>

              <div className="play-info card">
                {detail.pic ? (
                  <img src={detail.pic} alt={detail.name} className="play-info-poster" />
                ) : (
                  <div className="play-info-poster" />
                )}
                <div className="detail-info" style={{ minWidth: 0, flex: 1 }}>
                  <h2 style={{ fontSize: 18 }}>{detail.name}</h2>
                  <div className="tags">{renderInfoTags()}</div>
                  {detail.actor && <div className="desc">演员：{detail.actor}</div>}
                  {detail.director && <div className="desc">导演：{detail.director}</div>}
                  {detail.content && <div className="desc">{detail.content}</div>}
                  <button className="btn small" onClick={toggleFav}>
                    {isFav ? "★ 已收藏（点击取消）" : "☆ 收藏"}
                  </button>
                </div>
              </div>
            </div>

            <aside className="play-side card">
              <div className="row" style={{ marginBottom: 10 }}>
                <b>选集</b>
                <span className="side-hint">点下方片源标签可切换</span>
              </div>
              {renderSourceTabs()}
              {renderEpGrid(true)}
            </aside>
          </div>
        </>
      ) : (
        // ---------- 详情布局：海报 + 信息 + 选集 ----------
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
              <div className="tags">{renderInfoTags()}</div>
              {detail.actor && (
                <div className="desc">演员：{detail.actor}</div>
              )}
              {detail.director && (
                <div className="desc">导演：{detail.director}</div>
              )}
              {detail.content && <div className="desc">{detail.content}</div>}
            </div>

            <div className="episodes">
              {renderSourceTabs()}
              {renderEpGrid()}
            </div>
          </div>
        </div>
      )}

      {/* 嗅探结果 / 手动重试入口 */}
      {(sniffing || foundLinks.length > 0 || needManual) && (
        <div className="card" style={{ marginTop: 18, padding: 16 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <b>嗅探结果</b>
            {sniffing && <span style={{ color: "var(--text2)" }}>嗅探中…</span>}
            {foundLinks.length > 1 && (
              <span style={{ color: "var(--text2)", fontSize: 12 }}>
                共 {foundLinks.length} 条，已自动播放第 1 条，可点下面任意一条更换
              </span>
            )}
            <div className="spacer" />
            <button
              className="btn small"
              onClick={() => {
                setFoundLinks([]);
                setNeedManual(false);
                api.closeSniffer().catch(() => undefined);
              }}
            >
              关闭
            </button>
          </div>
          {sniffing && foundLinks.length === 0 ? (
            <div className="loading" style={{ padding: 14 }}>
              正在读取网页线路并提取直链，一般 1–3 秒完成…
            </div>
          ) : foundLinks.length > 0 ? (
            foundLinks.map((u, i) => (
              <div key={i} className="row" style={{ marginBottom: 8 }}>
                <div
                  className={`ep-btn ${i === 0 && playUrl === u ? "active" : ""}`}
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
                  }}
                  title={u}
                >
                  {playUrl === u ? "▶ 正在播放：" : "▶ 换这条播放："}
                  {u}
                </div>
                <button className="btn small" onClick={() => openExternal(u, toast)}>
                  外部播放
                </button>
              </div>
            ))
          ) : (
            needManual && (
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button
                  className="btn primary"
                  disabled={sniffing}
                  onClick={async () => {
                    const { sourceIdx: si, epIdx: ei } = curRef.current;
                    const ep = detail.sources[si]?.episodes[ei];
                    if (!ep) return;
                    setSniffing(true);
                    toast("嗅探窗口已打开，找到直链后会自动回来播放…");
                    try {
                      await api.openSniffer(ep.url);
                    } catch (e) {
                      toast(String(e), "error");
                    } finally {
                      setSniffing(false);
                    }
                  }}
                >
                  打开嗅探窗口重试
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const { sourceIdx: si, epIdx: ei } = curRef.current;
                    const ep = detail.sources[si]?.episodes[ei];
                    if (ep) openExternal(ep.url, toast);
                  }}
                >
                  用外部播放器打开本集
                </button>
                <button
                  className="btn"
                  disabled={sniffing}
                  onClick={() => {
                    const { sourceIdx: si, epIdx: ei } = curRef.current;
                    if (si >= 0 && ei >= 0) playEpisode(si, ei);
                  }}
                >
                  重新嗅探
                </button>
              </div>
            )
          )}
        </div>
      )}

      {/* AI 输出 */}
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

      {playUrl && (
        <div style={{ color: "var(--text3)", fontSize: 12, marginTop: 8 }}>
          观看进度每 8 秒自动保存；网页线路（选集右上角标“嗅”）会自动嗅探直链并直接播放，嗅探不到时依次尝试解析接口，仍失败可手动开嗅探窗口或交给外部播放器。
        </div>
      )}
    </div>
  );
}
