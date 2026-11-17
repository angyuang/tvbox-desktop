// 本地视频播放：选文件 -> asset 协议转播放地址 -> 复用 ArtPlayer 播放器
// 进度按文件路径记忆，播放列表存 localStorage；mkv 等兼容性差的格式可一键交给外部播放器
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import Player from "../components/Player";
import { openExternal } from "../api";
import { useApp } from "../store";
import {
  getLocalRecent,
  removeLocalRecent,
  upsertLocalRecent,
  type LocalRecentItem,
} from "../local";

function fileNameOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export default function LocalPlay() {
  const { toast } = useApp();
  const [recent, setRecent] = useState<LocalRecentItem[]>(getLocalRecent());
  const [playing, setPlaying] = useState<LocalRecentItem | null>(null);
  const [playUrl, setPlayUrl] = useState("");
  const [startPos, setStartPos] = useState(0);
  const busyRef = useRef(false);

  // 上报进度（Player 内部已 8 秒节流）
  const handleProgress = (pos: number, dur: number) => {
    if (!playing) return;
    upsertLocalRecent({
      name: playing.name,
      path: playing.path,
      position: pos,
      duration: dur,
    });
  };

  useEffect(() => {
    setRecent(getLocalRecent());
  }, [playing]);

  const playFile = (path: string, name?: string) => {
    if (busyRef.current) return;
    try {
      const item: LocalRecentItem = {
        name: name ?? fileNameOf(path),
        path,
        position: 0,
        duration: 0,
        ts: Date.now(),
      };
      const saved = getLocalRecent().find((x) => x.path === path);
      upsertLocalRecent({
        name: item.name,
        path,
        position: saved?.position ?? 0,
        duration: saved?.duration ?? 0,
      });
      const sp = saved && saved.position > 5 ? saved.position : 0;
      setStartPos(sp);
      setPlaying({ ...item, position: saved?.position ?? 0, duration: saved?.duration ?? 0 });
      setPlayUrl(convertFileSrc(path));
      if (sp > 5) {
        toast(`从上次位置 ${Math.floor(sp / 60)} 分钟处继续播放`, "info");
      }
    } catch (e) {
      toast(`打开本地文件失败: ${String(e)}`, "error");
    }
  };

  const pickFile = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const path = await open({
        multiple: false,
        title: "选择本地视频文件",
        filters: [
          {
            name: "视频文件",
            extensions: ["mp4", "mkv", "avi", "mov", "flv", "webm", "ts", "m2t", "wmv", "m4v", "ogv", "3gp"],
          },
        ],
      });
      if (!path) return;
      playFile(path as string);
    } catch (e) {
      toast(`选择文件失败: ${String(e)}`, "error");
    } finally {
      busyRef.current = false;
    }
  };

  const deleteItem = (path: string) => {
    removeLocalRecent(path);
    setRecent(getLocalRecent());
    if (playing?.path === path) {
      setPlaying(null);
      setPlayUrl("");
    }
  };

  return (
    <div>
      <h1 className="page-title">本地播放</h1>
      <p className="page-desc">
        播放电脑里的本地视频（类似 VLC / PotPlayer），进度自动记忆；mp4/webm 可内嵌播放，mkv 部分格式若无法播放请用外部播放器
      </p>

      <div className="row" style={{ marginBottom: 18, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={pickFile}>
          选择本地视频文件
        </button>
        <span style={{ color: "var(--text3)", fontSize: 13 }}>
          支持 mp4 / webm / mkv / avi / flv / ts 等常见格式
        </span>
      </div>

      {playing && playUrl && (
        <div style={{ marginBottom: 22 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b>正在播放：{playing.name}</b>
            <div className="spacer" />
            <button
              className="btn small"
              onClick={() => openExternal(playing.path, toast)}
              title="用 PotPlayer / VLC / mpv 打开该文件（兼容性最好）"
            >
              外部播放器打开
            </button>
            <button
              className="btn small"
              onClick={() => {
                setPlaying(null);
                setPlayUrl("");
              }}
            >
              停止
            </button>
          </div>
          <Player
            url={playUrl}
            poster={undefined}
            startPos={startPos}
            onProgress={handleProgress}
          />
        </div>
      )}

      <div className="section-title">
        <b>最近播放</b>
        <span className="section-hint">进度按文件路径记忆，点击任意一条继续观看</span>
      </div>
      {recent.length === 0 ? (
        <div className="empty">还没有播放记录，点击上方按钮选择视频文件</div>
      ) : (
        <div className="card" style={{ padding: 8 }}>
          {recent.map((r) => {
            const pct =
              r.duration > 0 ? Math.min(100, Math.round((r.position / r.duration) * 100)) : 0;
            return (
              <div key={r.path} className="local-item">
                <span
                  className="local-play-btn"
                  onClick={() => playFile(r.path, r.name)}
                  title={r.path}
                >
                  ▶ {r.name}
                </span>
                <span className="local-meta">
                  {pct > 0 ? `已看 ${pct}%` : "未开始"}
                  {pct > 0 && (
                    <span className="local-progress-track">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                <button className="btn small" onClick={() => openExternal(r.path, toast)}>
                  外部播放
                </button>
                <button className="btn small danger" onClick={() => deleteItem(r.path)}>
                  删除
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
