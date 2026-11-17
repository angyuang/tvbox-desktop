import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import PosterCard from "../components/PosterCard";
import { siteIsCms, siteKindOk } from "../types";
import type { CmsClass, PagedVideos, SiteConfig } from "../types";

// 站点测试状态
type TestState = {
  status: "idle" | "testing" | "ok" | "fail";
  ms?: number;
  msg?: string;
};

function MiniToggle({
  on,
  onClick,
}: {
  on: boolean;
  onClick: () => void;
}) {
  return (
    <span
      className={`toggle ${on ? "on" : ""}`}
      onClick={onClick}
      role="switch"
      aria-checked={on}
    />
  );
}

export default function Sources() {
  const { state, toast, reloadState } = useApp();
  const sites: SiteConfig[] = state?.activeConfig?.sites ?? [];
  const [tab, setTab] = useState<"manage" | "browse">("manage");

  // ================= 站点管理（表格 + 批量测试） =================
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const stopRef = useRef(false);

  const siteOn = (s: SiteConfig) => (s.enabled ?? 1) !== 0;
  const kindLabel = (s: SiteConfig) =>
    s.kind === "cms" || s.kind === "api"
      ? "CMS"
      : s.kind === "html"
        ? "网页"
        : s.kind === "spider"
          ? "不支持"
          : "未知";
  const hostOf = (u: string) => {
    try {
      return new URL(u).host || u || "—";
    } catch {
      return u || "—";
    }
  };

  const testOne = async (site: SiteConfig) => {
    setTests((m) => ({ ...m, [site.key]: { status: "testing" } }));
    try {
      const r = await api.testSite(site.key);
      setTests((m) => ({
        ...m,
        [site.key]: r.ok
          ? { status: "ok", ms: r.ms }
          : { status: "fail", ms: r.ms, msg: r.message || "测试失败" },
      }));
    } catch (e) {
      setTests((m) => ({
        ...m,
        [site.key]: { status: "fail", msg: String(e) },
      }));
    }
  };

  // 一键测试当前列表：只测「启用 + 桌面端可用」的站点，6 路并发，实时回填
  const batchTest = async () => {
    if (batchRunning) return;
    const targets = sites.filter((s) => siteOn(s) && siteKindOk(s));
    if (targets.length === 0) {
      toast("没有启用的可用站点", "error");
      return;
    }
    stopRef.current = false;
    setBatchRunning(true);
    setBatchTotal(targets.length);
    setBatchDone(0);
    const queue = [...targets];
    let done = 0;
    const worker = async () => {
      while (queue.length > 0 && !stopRef.current) {
        const s = queue.shift();
        if (!s) break;
        await testOne(s);
        done += 1;
        setBatchDone(done);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, targets.length) }, () => worker())
    );
    setBatchRunning(false);
  };

  const toggleSite = async (site: SiteConfig) => {
    const next = !siteOn(site);
    try {
      await api.setSiteEnabled(site.key, next);
      await reloadState();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const toggleAll = async (enabled: boolean) => {
    try {
      await api.setAllSitesEnabled(enabled);
      await reloadState();
      toast(enabled ? "已全部启用" : "已全部禁用", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  // ================= 分类浏览（原功能保留） =================
  const [current, setCurrent] = useState<string>("");
  const [classes, setClasses] = useState<CmsClass[]>([]);
  const [classId, setClassId] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<PagedVideos | null>(null);
  const [loading, setLoading] = useState(false);

  const curSite = sites.find((s) => s.key === current);

  // 默认选中第一个可用 CMS 站点
  useEffect(() => {
    if (!current && sites.length) {
      const target = sites.find(siteIsCms) ?? sites.find(siteKindOk);
      if (target) setCurrent(target.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites]);

  const loadList = useCallback(
    async (siteKey: string, typeId: number, pg: number) => {
      setLoading(true);
      setData(null);
      try {
        setData(await api.getVideolist(siteKey, typeId, pg));
      } catch (e) {
        toast(String(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  // 切站点 -> 拉分类
  useEffect(() => {
    if (tab !== "browse") return;
    if (!curSite || !siteIsCms(curSite)) {
      setClasses([]);
      return;
    }
    (async () => {
      try {
        const cls = await api.getCategories(curSite.key);
        setClasses(cls);
        const first = cls[0]?.type_id ?? 0;
        setClassId(first);
        setPage(1);
        loadList(curSite.key, first, 1);
      } catch (e) {
        setClasses([]);
        toast(`站点 ${curSite.name} 拉取分类失败: ${String(e)}`, "error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curSite?.key, tab]);

  const switchClass = (id: number) => {
    if (!curSite) return;
    setClassId(id);
    setPage(1);
    loadList(curSite.key, id, 1);
  };

  const switchPage = (pg: number) => {
    if (!curSite || !data) return;
    setPage(pg);
    loadList(curSite.key, classId, pg);
    document.querySelector(".main")?.scrollTo({ top: 0 });
  };

  if (sites.length === 0) {
    return (
      <div className="empty">
        当前订阅没有站点。请到「设置」添加订阅。
      </div>
    );
  }

  const pages = data?.pagecount ?? 1;
  const enabledCount = sites.filter(siteOn).length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          影视源
        </h1>
        <span className="page-desc" style={{ margin: 0 }}>
          共 {sites.length} 个站点 · 已启用 {enabledCount}
        </span>
      </div>
      <p className="page-desc">
        一键测试多个站点的连通性与响应时间；站点开关会写入当前订阅配置，禁用的站点不参与搜索与浏览
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <span
          className={`chip ${tab === "manage" ? "active" : ""}`}
          onClick={() => setTab("manage")}
        >
          站点管理
        </span>
        <span
          className={`chip ${tab === "browse" ? "active" : ""}`}
          onClick={() => setTab("browse")}
        >
          分类浏览
        </span>
        <div className="spacer" />
        {tab === "manage" && (
          <>
            {batchRunning ? (
              <>
                <span className="search-progress" style={{ marginBottom: 0 }}>
                  已测 {batchDone}/{batchTotal}
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    stopRef.current = true;
                  }}
                >
                  停止
                </button>
              </>
            ) : (
              <button className="btn primary small" onClick={batchTest}>
                测试当前列表
              </button>
            )}
            <button className="btn small" onClick={() => toggleAll(true)}>
              全部启用
            </button>
            <button className="btn small" onClick={() => toggleAll(false)}>
              全部禁用
            </button>
          </>
        )}
      </div>

      {tab === "manage" && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="site-table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>启用</th>
                <th>站点</th>
                <th style={{ width: 72 }}>类型</th>
                <th>接口域名</th>
                <th style={{ minWidth: 180 }}>测试状态</th>
                <th style={{ width: 76 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => {
                const t = tests[s.key] ?? { status: "idle" as const };
                const on = siteOn(s);
                const ok = siteKindOk(s);
                return (
                  <tr key={s.key} className={on ? "" : "disabled"}>
                    <td>
                      <MiniToggle on={on} onClick={() => toggleSite(s)} />
                    </td>
                    <td
                      className="site-name"
                      title={ok ? s.name : s.unsupported_reason || "不支持"}
                    >
                      {s.name}
                    </td>
                    <td>
                      <span className="badge gray">{kindLabel(s)}</span>
                    </td>
                    <td className="site-host" title={s.api}>
                      {hostOf(s.api)}
                    </td>
                    <td>
                      {t.status === "idle" && (
                        <span className="muted">未测试</span>
                      )}
                      {t.status === "testing" && (
                        <span className="muted">测试中…</span>
                      )}
                      {t.status === "ok" && (
                        <span className="ms-ok">{t.ms} ms</span>
                      )}
                      {t.status === "fail" && (
                        <span className="ms-fail" title={t.msg}>
                          失败：{t.msg?.slice(0, 60)}
                          {(t.msg?.length ?? 0) > 60 ? "…" : ""}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn small"
                        disabled={!ok || t.status === "testing" || !on}
                        title={!ok ? s.unsupported_reason || "不支持" : ""}
                        onClick={() => testOne(s)}
                      >
                        {t.status === "testing" ? "测试中" : "测试"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "browse" && (
        <div style={{ display: "flex", gap: 20 }}>
          {/* 站点列表 */}
          <div
            className="card"
            style={{ width: 220, flexShrink: 0, padding: 10, maxHeight: "calc(100vh - 240px)", overflowY: "auto" }}
          >
            {sites.map((s) => {
              const ok = siteKindOk(s) && siteOn(s);
              return (
                <div key={s.key}>
                  <div
                    className={`live-channel ${current === s.key ? "active" : ""}`}
                    style={{ opacity: ok ? 1 : 0.45, cursor: ok ? "pointer" : "not-allowed" }}
                    title={ok ? s.name : s.unsupported_reason || "已禁用"}
                    onClick={() => ok && setCurrent(s.key)}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.name}
                    </span>
                    <span className="spacer" />
                    <span className="lines">{kindLabel(s)}</span>
                  </div>
                  {!siteKindOk(s) && (
                    <div style={{ fontSize: 11, color: "var(--text3)", padding: "0 10px 6px 22px" }}>
                      {s.unsupported_reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 分类 + 列表 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {curSite && (
              <div className="row" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{curSite.name}</div>
                {curSite.kind === "html" && (
                  <span style={{ color: "var(--text3)", fontSize: 12 }}>
                    网页规则站仅支持聚合搜索，不支持分类浏览
                  </span>
                )}
              </div>
            )}

            {classes.length > 0 && (
              <div className="row" style={{ flexWrap: "wrap", marginBottom: 16 }}>
                {classes.map((c) => (
                  <span
                    key={c.type_id}
                    className={`chip ${classId === c.type_id ? "active" : ""}`}
                    onClick={() => switchClass(c.type_id)}
                  >
                    {c.type_name}
                  </span>
                ))}
              </div>
            )}

            {loading ? (
              <div className="loading">加载中…</div>
            ) : data && data.items.length > 0 ? (
              <>
                <div className="grid">
                  {data.items.map((c) => (
                    <PosterCard key={`${c.site_key}-${c.vod_id}`} card={c} />
                  ))}
                </div>
                <div className="row" style={{ marginTop: 20, justifyContent: "center" }}>
                  <button className="btn" disabled={page <= 1} onClick={() => switchPage(page - 1)}>
                    上一页
                  </button>
                  <span style={{ color: "var(--text2)", fontSize: 13 }}>
                    第 {data.page} / {pages} 页 · 共 {data.total} 部
                  </span>
                  <button className="btn" disabled={page >= pages} onClick={() => switchPage(page + 1)}>
                    下一页
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">暂无内容</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
