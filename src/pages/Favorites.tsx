import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { api } from "../api";

export default function Favorites() {
  const nav = useNavigate();
  const { favorites, reloadFavorites, toast } = useApp();

  // 进入页面时重新拉取，避免显示启动时的过期快照
  useEffect(() => {
    reloadFavorites();
  }, [reloadFavorites]);

  return (
    <div>
      <h1 className="page-title">收藏</h1>
      <p className="page-desc">点击卡片进入详情页继续观看</p>

      {favorites.length === 0 ? (
        <div className="empty">
          还没有收藏。在详情页点击「收藏」即可保存。
        </div>
      ) : (
        <div className="grid">
          {favorites.map((f) => (
            <div
              key={`${f.site_key}-${f.vod_id}`}
              className="poster-card"
              onClick={() => nav(`/detail/${f.site_key}/${f.vod_id}`)}
              title={f.name}
            >
              {f.pic ? (
                <img
                  className="cover"
                  src={f.pic}
                  alt={f.name}
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="cover-empty">▶</div>
              )}
              <span className="site-badge">{f.site_name}</span>
              <div className="info">
                <div className="title">{f.name}</div>
                <div className="meta">{f.remarks || "\u00A0"}</div>
                <button
                  className="btn small danger"
                  style={{ marginTop: 6, width: "100%" }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.removeFavorite(f.site_key, f.vod_id);
                    toast("已删除收藏");
                    reloadFavorites();
                  }}
                >
                  取消收藏
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
