// 本地视频播放：类似 VLC / PotPlayer 的本地文件播放
// 原理：文件选择对话框 -> convertFileSrc 转为 asset:// 地址 -> ArtPlayer 页内播放
// WebView2 解不了的容器（mkv/avi/rmvb 等）可一键转交外部播放器
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import Player from "../components/Player";
import { openExternal } from "../api";
import { useApp } from "../store";

interface LocalItem {
  path: string;
  name: string;
  at: number;
}

const RECENT_KEY = "tvbox-local-recent";
// 进度记忆：路径 -> { pos, dur }（本地播放轻量记忆，存 localStorage）
const POS_KEY = "tvbox-local-pos";

const VIDEO_EXTS = [
  "mp4", "mkv", "avi", "mov", "flv", "webm", "wmv", "m4v",
  "ts", "mpg", "mpeg", "rmvb", "3gp", "m2ts", "ogv",
];

function loadRecent(): LocalItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as LocalItem[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: LocalItem[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, 20)));
}

function fileLabel(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function loadPos(path: string): { pos: number; dur: number } {
  try {
    const all = JSON.parse(localStorage.getItem(POS_KEY) || "{}");
    return all[path] ?? { pos: 0, dur: 0 };
  } catch {
    return { pos: 0, dur: 0 };
  }
}

function savePos(path: string, pos: number, dur: number) {
  try {
    const all = JSON.parse(localStorage.getItem(POS_KEY) || "{}");
    all[path] = { pos, dur, at: Date.now() };
    localStorage.setItem(POS_KEY, JSON.stringify(all));
  } catch {
    /* 忽略 */
  }
}

export default function Local() {
  const { toast } = useApp();
  const [playlist, setPlaylist] = useState<string[]>([]);
  const [playing, setPlaying] = useState<string>("");
  const [recent, setRecent] = useState<LocalItem[]>(() => loadRecent());
  const [startPos, setStartPos] = useState(0);
  const lastPathRef = useRef("");

  // 切换播放文件时恢复上次进度
  useEffect(() => {
    if (!playing || playing === lastPathRef.current) return;
    lastPathRef.current = playing;
    const p = loadPos(playing);
    setStartPos(p.pos > 10 && p.dur > 0 && p.pos < p.dur * 0.95 ? p.pos : 0);
    pushRecent(playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const pushRecent = (path: string) => {
    const items = loadRecent().filter((i) => i.path !== path);
    items.unshift({ path, name: fileLabel(path), at: Date.now() });
    saveRecent(items);
    setRecent(items.slice(0, 20));
  };

  const pickFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "视频文件", extensions: VIDEO_EXTS }],
      });
      if (!selected) return;
      const paths = (Array.isArray(selected) ? selected : [selected]).map(String);
      if (paths.length === 0) return;
      setPlaylist(paths);
      setPlaying(paths[0]);
      toast(paths.length > 1 ? `已加入 ${paths.length} 个文件到播放列表` : "开始播放", "success");
    } catch (e) {
      toast(`选择文件失败: ${String(e)}`, "error");
    }
  };

  const handleProgress = (pos: number, dur: number) => {
    if (playing && dur > 0) savePos(playing, pos, dur);
  };

  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY);
    setRecent([]);
    toast("已清空最近播放");
  };

  return (
    <div>
      <h1 className="page-title">本地播放</h1>
      <p className="page-desc">
        像 VLC / PotPlayer 一样直接播放本地视频文件；支持多选成播放列表，自动记忆播放进度
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn primary" onClick={pickFiles}>
          选择视频文件
        </button>
        {playing && (
          <button
            className="btn small"
            onClick={() => openExternal(playing, toast)}
            title="内置播放器解不了的格式（如部分 mkv/avi/rmvb），用本机播放器打开"
          >
            用外部播放器打开当前文件
          </button>
        )}
      </div>

      {playing ? (
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileLabel(playing)}
            </b>
            <div className="spacer" />
            {playlist.length > 1 && (
              <span style={{ color: "var(--text3)", fontSize: 12 }}>
                播放列表 {playlist.indexOf(playing) + 1}/{playlist.length}
              </span>
            )}
          </div>
          <Player
            url={convertFileSrc(playing)}
            startPos={startPos}
            onProgress={handleProgress}
          />
          {playlist.length > 1 && (
            <div className="card" style={{ marginTop: 14, padding: 12 }}>
              <b style={{ fontSize: 13 }}>播放列表</b>
              <div style={{ marginTop: 8 }}>
                {playlist.map((p, i) => (
                  <div
                    key={p + i}
                    className={`live-channel ${p === playing ? "active" : ""}`}
                    onClick={() => setPlaying(p)}
                  >
                    <span className="lines" style={{ width: 24 }}>
                      {i + 1}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fileLabel(p)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ color: "var(--text3)", fontSize: 12, marginTop: 8 }}>
            进度自动记忆，重进本页从上次位置继续。若画面黑屏或有声无画，多为容器/编码不被 WebView 支持，点「用外部播放器打开」交给 PotPlayer / VLC / mpv 即可。
          </div>
        </div>
      ) : (
        <div className="empty" style={{ padding: "60px 0" }}>
          点击「选择视频文件」开始播放，支持 mp4 / mkv / avi / flv / webm 等常见格式
        </div>
      )}

      {recent.length > 0 && (
        <div className="card" style={{ marginTop: 18, padding: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>最近播放</b>
            <div className="spacer" />
            <button className="btn small" onClick={clearRecent}>
              清空
            </button>
          </div>
          {recent.map((it) => (
            <div key={it.path} className="row" style={{ marginBottom: 6 }}>
              <div
                className="ep-btn"
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "left",
                  padding: "9px 12px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={it.path}
                onClick={() => setPlaying(it.path)}
              >
                ▶ {it.name}
              </div>
              <button className="btn small" onClick={() => openExternal(it.path, toast)}>
                外部播放
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
