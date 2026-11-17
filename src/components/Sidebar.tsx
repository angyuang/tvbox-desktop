import { NavLink } from "react-router-dom";
import { useApp } from "../store";

const items: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "首页", icon: "⌂" },
  { to: "/browse", label: "分类浏览", icon: "▦" },
  { to: "/sources", label: "影视源", icon: "▤" },
  { to: "/search", label: "聚合搜索", icon: "⌕" },
  { to: "/live", label: "直播电视", icon: "◉" },
  { to: "/local", label: "本地播放", icon: "▶" },
  { to: "/favorites", label: "收藏", icon: "♥" },
  { to: "/history", label: "历史", icon: "↺" },
  { to: "/settings", label: "设置", icon: "⚙" },
];

export default function Sidebar() {
  const active = useApp((s) => s.state?.activeConfig);
  const subName = active?.name ?? "未选择订阅";

  return (
    <aside className="sidebar">
      <div className="logo">
        TV<span>Box</span>
      </div>
      <nav>
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === "/"}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <span style={{ width: 18, textAlign: "center" }}>{it.icon}</span>
            {it.label}
          </NavLink>
        ))}
      </nav>
      <div className="sub-note">
        当前订阅
        <br />
        {subName}
        <br />
        <span style={{ fontSize: 11 }}>Tauri 2 · Rust · React</span>
      </div>
    </aside>
  );
}
