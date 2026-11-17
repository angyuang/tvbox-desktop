import { useCallback, useEffect, useRef, useState } from "react";
import Player from "../components/Player";
import { api, EVENTS, onEvent, openExternal } from "../api";
import { useApp } from "../store";
import { isRoomUrl } from "../types";
import type { LiveChannelGroup, LineSpeed } from "../types";

export default function Live() {
  const { toast } = useApp();
  const [groups, setGroups] = useState<LiveChannelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [curChannel, setCurChannel] = useState<{ g: number; c: number } | null>(null);
  const [curLine, setCurLine] = useState(0);
  const [playUrl, setPlayUrl] = useState("");
  const [speeds, setSpeeds] = useState<Record<string, LineSpeed>>({});
  const [testing, setTesting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const g = await api.getLiveChannels();
        setGroups(g);
      } catch (e) {
        toast(`直播源加载失败: ${String(e)}`, "error");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ch =
    curChannel != null ? groups[curChannel.g]?.channels[curChannel.c] : null;
  const lines = ch?.lines ?? [];
  const curUrl = lines[curLine] ?? "";

  // 房间号频道 -> 解析真实直链
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!curUrl) {
        setPlayUrl("");
        return;
      }
      if (isRoomUrl(curUrl)) {
        try {
          toast(`正在解析房间 ${curUrl} …`);
          const real = await api.resolveRoomUrl(curUrl);
          if (alive) setPlayUrl(real);
        } catch (e) {
          toast(`房间解析失败: ${String(e)}`, "error");
          if (alive) setPlayUrl("");
        }
      } else {
        setPlayUrl(curUrl);
      }
    })();
    return () => {
      alive = false;
    };
  }, [curUrl, toast]);

  const selectChannel = (g: number, c: number) => {
    setCurChannel({ g, c });
    setCurLine(0);
    setSpeeds({});
  };

  // 测速当前频道全部线路
  const speedTest = useCallback(async () => {
    if (lines.length === 0) return;
    setTesting(true);
    setSpeeds({});
    try {
      const res = await api.speedTestLines(lines);
      const map: Record<string, LineSpeed> = {};
      res.forEach((r) => (map[r.url] = r));
      setSpeeds(map);
    } catch (e) {
      toast(`测速失败: ${String(e)}`, "error");
    } finally {
      setTesting(false);
    }
  }, [lines, toast]);

  // 测速进度事件（用于提示）
  useEffect(() => {
    let un: (() => void) | undefined;
    onEvent<{ done: number; total: number }>(EVENTS.LIVE_SPEED, (p) => {
      setTesting(p.done < p.total);
    }).then((f) => (un = f));
    return () => un?.();
  }, []);

  const kw = filter.trim().toLowerCase();

  return (
    <div>
      <h1 className="page-title">直播电视</h1>
      <p className="page-desc">
        m3u / txt 直播源自动解析，同名频道多线路合并；虎牙/抖音房间号自动换取直播流
      </p>

      {loading ? (
        <div className="loading">正在拉取直播频道…</div>
      ) : groups.length === 0 ? (
        <div className="empty">
          当前订阅没有可用的直播频道。请到「设置」更换订阅或检查直播源地址。
        </div>
      ) : (
        <div className="live-layout">
          {/* 频道列表 */}
          <div className="card live-list" ref={listRef}>
            <input
              className="input"
              style={{ width: "100%", marginBottom: 8 }}
              placeholder="搜索频道…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {groups.map((g, gi) => {
              const channels = kw
                ? g.channels.filter((c) => c.name.toLowerCase().includes(kw))
                : g.channels;
              if (kw && channels.length === 0) return null;
              return (
                <div key={g.group + gi}>
                  <div className="live-group-title">
                    {g.group}（{channels.length}）
                  </div>
                  {channels.map((c, ci) => (
                    <div
                      key={c.name + ci}
                      className={`live-channel ${
                        curChannel &&
                        curChannel.g === gi &&
                        groups[gi].channels[ci]?.name === c.name
                          ? "active"
                          : ""
                      }`}
                      onClick={() => selectChannel(gi, ci)}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </span>
                      <span className="spacer" />
                      {c.lines.length > 1 && (
                        <span className="lines">{c.lines.length} 线路</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* 播放区 */}
          <div className="live-side">
            {playUrl ? (
              <Player url={playUrl} />
            ) : (
              <div
                className="card"
                style={{ aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}
              >
                左侧选择频道开始播放
              </div>
            )}

            {ch && (
              <div>
                <div className="row" style={{ marginTop: 12 }}>
                  <b style={{ fontSize: 15 }}>{ch.name}</b>
                  {lines.length > 1 && (
                    <span style={{ color: "#6b7280", fontSize: 12 }}>
                      {lines.length} 条线路
                    </span>
                  )}
                  <div className="spacer" />
                  <button
                    className="btn small"
                    disabled={!playUrl}
                    onClick={() => playUrl && openExternal(playUrl, toast)}
                    title="用 PotPlayer / VLC / mpv 打开当前直播流"
                  >
                    外部播放
                  </button>
                  <button className="btn small" disabled={testing} onClick={speedTest}>
                    {testing ? "测速中…" : "线路测速"}
                  </button>
                </div>

                <div className="live-lines">
                  {lines.map((u, i) => {
                    const sp = speeds[u];
                    return (
                      <span
                        key={i}
                        className={`chip ${i === curLine ? "active" : ""}`}
                        onClick={() => setCurLine(i)}
                        style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}
                        title={u}
                      >
                        线路 {i + 1}
                        {sp && (
                          <span className={`speed-tag ${i === curLine ? "" : sp.ok ? "speed-ok" : "speed-bad"}`}>
                            {" "}
                            {sp.ok ? `${sp.delay_ms}ms` : "失败"}
                          </span>
                        )}
                        {isRoomUrl(u) && <span className="speed-tag"> 房间</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
