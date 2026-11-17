// 本地播放：选择本机视频文件，用内置播放器直接播放（无需任何订阅）
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import Player from "../components/Player";
import { useApp } from "../store";

const LS_KEY = "tvbox.localFiles";

const VIDEO_EXTS = [
  "mp4", "mkv", "flv", "avi", "ts", "webm", "mov", "wmv", "m4v", "m3u8",
  "mp3", "aac", "flac", "wav", "m4a", "ogg",
];

function loadFiles(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function baseName(p: string): string {
  const sep = p.includes("\\") ? "\\" : "/";
  return p.split(sep).pop() || p;
}

export default function LocalPlay() {
  const { toast } = useApp();
  const [files, setFiles] = useState<string[]>(loadFiles);
  const [current, setCurrent] = useState<string>("");

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(files.slice(0, 100)));
  }, [files]);

  const pick = async () => {
    try {
      const res = await open({
        multiple: true,
        filters: [{ name: "视频 / 音频文件", extensions: VIDEO_EXTS }],
      });
      if (!res) return;
      const list = Array.isArray(res) ? res : [res];
      setFiles((prev) => {
        const merged = [...prev];
        for (const f of list) if (!merged.includes(f)) merged.push(f);
        return merged;
      });
      if (list.length > 0) toast(`已添加 ${list.length} 个文件`, "success");
    } catch (e) {
      toast(`选择文件失败: ${String(e)}`, "error");
    }
  };

  const remove = (f: string) => {
    setFiles((prev) => prev.filter((x) => x !== f));
    if (current === f) setCurrent("");
  };

  return (
    <div>
      <h1 className="page-title">本地播放</h1>
      <p className="page-desc">
        把本机视频文件交给内置播放器（支持 mp4 / mkv / flv / ts / m3u8 等），列表保存在本机
      </p>

      <div className="row" style={{ marginBottom: 18 }}>
        <button className="btn primary" onClick={pick}>
          添加视频文件
        </button>
        {files.length > 0 && (
          <button className="btn" onClick={() => { setFiles([]); setCurrent(""); }}>
            清空列表
          </button>
        )}
        <span style={{ color: "var(--text3)", fontSize: 12 }}>
          共 {files.length} 个文件；可多选批量添加
        </span>
      </div>

      {current && (
        <div style={{ marginBottom: 18 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b>正在播放</b>
            <span style={{ color: "var(--text2)", fontSize: 13 }}>{baseName(current)}</span>
            <button
              className="btn small"
              onClick={() => navigator.clipboard?.writeText(current).then(() => toast("已复制文件路径", "success"))}
              title="复制完整路径，便于外部播放器打开"
            >
              复制路径
            </button>
          </div>
          <Player url={convertFileSrc(current)} />
        </div>
      )}

      {files.length === 0 ? (
        <div className="empty">还没有添加本地文件，点「添加视频文件」开始</div>
      ) : (
        <div className="card" style={{ padding: 10 }}>
          {files.map((f) => (
            <div
              key={f}
              className={`live-channel ${current === f ? "active" : ""}`}
              onClick={() => setCurrent(f)}
              title={f}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {baseName(f)}
              </span>
              <span className="spacer" />
              <span
                className="lines"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(f);
                }}
                style={{ cursor: "pointer" }}
                title="从列表移除"
              >
                移除
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
