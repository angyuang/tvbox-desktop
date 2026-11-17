import { useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { useApp } from "./store";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import Browse from "./pages/Browse";
import Sources from "./pages/Sources";
import Search from "./pages/Search";
import Detail from "./pages/Detail";
import Play from "./pages/Play";
import Live from "./pages/Live";
import LocalPlay from "./pages/LocalPlay";
import Favorites from "./pages/Favorites";
import History from "./pages/History";
import Settings from "./pages/Settings";

export default function App() {
  const { toasts, reloadAll } = useApp();

  useEffect(() => {
    reloadAll();
  }, [reloadAll]);

  return (
    <HashRouter>
      <div className="app">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/search" element={<Search />} />
            <Route path="/detail/:siteKey/:vodId" element={<Detail />} />
            <Route path="/play/:siteKey/:vodId" element={<Play />} />
            <Route path="/live" element={<Live />} />
            <Route path="/local" element={<LocalPlay />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <div className="toast-wrap">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </HashRouter>
  );
}
