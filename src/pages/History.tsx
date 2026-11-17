import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { api } from "../api";

export default function History() {
  const nav = useNavigate();
  const { history, reloadHistory, toast } = useApp();

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 0 }}>
            观看历史
          </h1>
          <p className="page-desc" style={{ marginBottom: 0 }}>
            最多保留 200 条，点击卡片从上次位置继续播放
          </p>
        </div>
        <div className="spacer" />
        {history.length > 0 && (
          <button
            className="btn danger"
            onClick={async () => {
              await api.clearHistory();
              toast("历史已清空");
              reloadHistory();
            }}
          >
            清空历史
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="empty">暂无观看记录</div>
      ) : (
        <div className="grid">
          {history.map((h) => {
            const pct =
              h.duration_sec > 0
                ? Math.min(100, (h.position_sec / h.duration_sec) * 100)
                : 0;
            return (
              <div
                key={`${h.site_key}-${h.vod_id}`}
                className="poster-card"
                onClick={() => nav(`/play/${h.site_key}/${h.vod_id}`)}
                title={h.name}
              >
                {h.pic ? (
                  <img
                    className="cover"
                    src={h.pic}
                    alt={h.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                ) : (
                  <div className="cover-empty">▶</div>
                )}
                {h.remarks && <span className="remarks-badge">{h.remarks}</span>}
                {pct > 0 && (
                  <div className="progress-bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="info">
                  <div className="title">{h.name}</div>
                  <div className="meta">
                    {h.episode_name} ·{" "}
                    {Math.floor(h.position_sec / 60)}分
                    {Math.floor(h.position_sec % 60)}秒
                    {h.duration_sec > 0 &&
                      ` / ${Math.floor(h.duration_sec / 60)}分`}
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="btn small"
                      onClick={(e) => {
                        e.stopPropagation();
                        nav(`/detail/${h.site_key}/${h.vod_id}`);
                      }}
                    >
                      继续
                    </button>
                    <button
                      className="btn small danger"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await api.removeHistory(h.site_key, h.vod_id);
                        reloadHistory();
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
