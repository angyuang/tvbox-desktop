import { useNavigate } from "react-router-dom";
import type { VideoCard, HistoryItem } from "../types";

interface Props {
  card: Pick<
    VideoCard,
    "site_key" | "site_name" | "vod_id" | "name" | "pic" | "remarks"
  >;
  showSite?: boolean;
  progress?: HistoryItem; // 历史进度（可选）
  width?: number;
  /** 自定义点击行为（不传则跳详情页） */
  onClick?: () => void;
}

export default function PosterCard({ card, showSite, progress, width, onClick }: Props) {
  const nav = useNavigate();
  const pct =
    progress && progress.duration_sec > 0
      ? Math.min(100, (progress.position_sec / progress.duration_sec) * 100)
      : 0;

  return (
    <div
      className="poster-card"
      style={width ? { width, flexShrink: 0 } : undefined}
      onClick={onClick ?? (() => nav(`/detail/${card.site_key}/${card.vod_id}`))}
      title={card.name}
    >
      {card.pic ? (
        <img
          className="cover"
          src={card.pic}
          alt={card.name}
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="cover-empty">▶</div>
      )}
      {card.remarks && <span className="remarks-badge">{card.remarks}</span>}
      {showSite && <span className="site-badge">{card.site_name}</span>}
      {pct > 0 && (
        <div className="progress-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="info">
        <div className="title">{card.name}</div>
        <div className="meta">
          {progress?.episode_name
            ? `看到 ${progress.episode_name}`
            : progress?.remarks || card.remarks || "\u00A0"}
        </div>
      </div>
    </div>
  );
}
