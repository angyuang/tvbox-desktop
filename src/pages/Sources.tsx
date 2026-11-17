import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import PosterCard from "../components/PosterCard";
import { siteIsCms, siteKindOk } from "../types";
import type { CmsClass, PagedVideos, SiteConfig, SiteTestResult } from "../types";
import {
  getSiteEnabledMap,
  isSiteEnabled,
  saveSiteEnabledMap,
  type SiteEnabledMap,
} from "../local";

const BATCH_POOL = 8; // 批量测试并发数

function hostOf(api: string): string {
  try {
    return new URL(api).host;
  } catch {
    const idx = api.indexOf("://");
    return idx >= 0 ? api.slice(idx + 3).split("/")[0] : api;
  }
}

export default function Sources() {
  const { state, toast } = useApp();
  const sites: SiteConfig[] = state?.activeConfig?.sites ?? [];

  const [tab, setTab] = useState<"browse" | "manage">("manage");
  const [enabledMap, setEnabledMap] = useState<SiteEnabledMap>(getSiteEnabledMap());

  // ---------- 浏览 ----------
  const [current, setCurrent] = useState<string>("");
  const [classes, setClasses] = useState<CmsClass[]>([]);
  const [classId, setClassId] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<PagedVideos | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<string>("");

  // ---------- 源管理：批量测试 ----------
  const [results, setResults] = useState<Record<string, SiteTestResult | "testing">>({});
  const [batchDone, setBatchDone] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const [filter, setFilter] = useState("");

  const okSites = sites.filter(siteKindOk);
  const enabledCount = okSites.filter((s) => isSiteEnabled(enabledMap, s.key)).length;

  const curSite = sites.find((s) => s.key === current);

  const setEnabled = (key: string, on: boolean) => {
    const next = { ...enabledMap, [key]: on };
    setEnabledMap(next);
    saveSiteEnabledMap(next);
  };

  const setAll = (on: boolean) => {
    const next = { ...enabledMap };
    for (const s of okSites) next[s.key] = on;
    setEnabledMap(next);
    saveSiteEnabledMap(next);
    toast(on ? `已启用全部 ${okSites.length} 个可用站点` : "已停用全部站点", "success");
  };

  // ---------- 批量测试：并发池 8，逐行实时回填 ----------
  const runBatch = useCallback(async () => {
    if (batchRunning) return;
    const targets = okSites.filter((s) => isSiteEnabled(enabledMap, s.key));
    if (targets.length === 0) {
      toast("没有已启用的站点可测试", "error");
      return;
    }
    setBatchRunning(true);
    setBatchDone(0);
    setResults({});
    let idx = 0;
    let pass = 0;
    const worker = async () => {
      while (idx < targets.length) {
        const s = targets[idx++];
        setResults((prev) => ({ ...prev, [s.key]: "testing" }));
        let r: SiteTestResult;
        try {
          r = await api.testSite(s.key);
        } catch (e) {
          r = { ok: false, ms: 0, message: String(e) };
        }
        if (r.ok) pass++;
        setResults((prev) => ({ ...prev, [s.key]: r }));
        setBatchDone((d) => d + 1);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(BATCH_POOL, targets.length) }, () => worker())
    );
    setBatchRunning(false);
    toast(
      `批量测试完成：${pass}/${targets.length} 个站点正常`,
      pass === targets.length ? "success" : "info"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchRunning, enabledMap, okSites, toast]);

  const testOne = async (s: SiteConfig) => {
    setResults((prev) => ({ ...prev, [s.key]: "testing" }));
    try {
      const r = await api.testSite(s.key);
      setResults((prev) => ({ ...prev, [s.key]: r }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [s.key]: { ok: false, ms: 0, message: String(e) },
      }));
    }
  };

  // ---------- 浏览逻辑（原有） ----------
  useEffect(() => {
    if (!current && okSites.length) {
      const target =
        okSites.find((s) => siteIsCms(s) && isSiteEnabled(enabledMap, s.key)) ??
        okSites.find((s) => siteKindOk(s) && isSiteEnabled(enabledMap, s.key));
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

  useEffect(() => {
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
  }, [curSite?.key]);

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

  const testSite = async (site: SiteConfig) => {
    setTesting(site.key);
    try {
      await api.getCategories(site.key);
      toast(`站点「${site.name}」连接正常`, "success");
    } catch (e) {
      toast(`站点「${site.name}」测试失败: ${String(e)}`, "error");
    } finally {
      setTesting("");
    }
  };

  if (sites.length === 0) {
    return (
      <div className="empty">
        当前订阅没有站点。请到「设置」添加订阅。
      </div>
    );
  }

  const pages = data?.pagecount ?? 1;
  const filteredManage = okSites.filter(
    (s) => !filter.trim() || s.name.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>影视源</h1>
        <div className="spacer" />
        <div className="seg">
          <span
            className={`seg-item ${tab === "manage" ? "active" : ""}`}
            onClick={() => setTab("manage")}
          >
            源管理
          </span>
          <span
            className={`seg-item ${tab === "browse" ? "active" : ""}`}
            onClick={() => setTab("browse")}
          >
            浏览
          </span>
        </div>
      </div>
      <p className="page-desc">
        {tab === "manage"
          ? "启用/停用各站点，一键批量测试连通性与速度；停用的站点不参与聚合搜索"
          : "浏览当前订阅的站点与分类，支持分页"}
      </p>

      {tab === "manage" ? (
        <>
          <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={batchRunning} onClick={runBatch}>
              {batchRunning ? `测试中 ${batchDone}/${okSites.filter((s) => isSiteEnabled(enabledMap, s.key)).length}…` : "一键测试已启用站点"}
            </button>
            <button className="btn" onClick={() => setAll(true)}>全部启用</button>
            <button className="btn" onClick={() => setAll(false)}>全部停用</button>
            <input
              className="input"
              style={{ width: 200 }}
              placeholder="按名称过滤站点…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="batch-progress">
              已启用 {enabledCount} / {okSites.length} · 已测 {batchDone}
            </span>
          </div>

          <div className="card site-table-card">
            <table className="site-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>启用</th>
                  <th>站点名</th>
                  <th style={{ width: 90 }}>类型</th>
                  <th>接口域名</th>
                  <th style={{ width: 300 }}>状态 / 耗时 / 失败原因</th>
                  <th style={{ width: 130 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredManage.map((s) => {
                  const on = isSiteEnabled(enabledMap, s.key);
                  const r = results[s.key];
                  const kindLabel =
                    s.kind === "cms" || s.kind === "api"
                      ? "CMS"
                      : s.kind === "html"
                        ? "网页"
                        : "不支持";
                  return (
                    <tr key={s.key} className={!on ? "row-off" : ""}>
                      <td>
                        <span
                          className={`toggle ${on ? "on" : ""}`}
                          role="switch"
                          aria-checked={on}
                          title={on ? "已启用：参与聚合搜索，点击停用" : "已停用：不参与聚合搜索，点击启用"}
                          onClick={() => setEnabled(s.key, !on)}
                        />
                      </td>
                      <td className="site-name-cell" title={s.key}>
                        {s.name}
                      </td>
                      <td>
                        <span className={`badge ${siteKindOk(s) ? "" : "gray"}`}>{kindLabel}</span>
                      </td>
                      <td className="host-cell" title={s.api}>
                        {hostOf(s.api) || "-"}
                      </td>
                      <td className="status-cell">
                        {!r ? (
                          <span className="status-idle">未测试</span>
                        ) : r === "testing" ? (
                          <span className="status-testing">测试中…</span>
                        ) : r.ok ? (
                          <span className="status-ok">✓ 正常 {r.ms}ms</span>
                        ) : (
                          <span className="status-bad" title={r.message}>
                            ✗ 失败 {r.ms > 0 ? `${r.ms}ms · ` : ""}
                            {r.message.length > 60 ? r.message.slice(0, 60) + "…" : r.message}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            className="btn small"
                            disabled={!siteKindOk(s) || r === "testing"}
                            onClick={() => testOne(s)}
                          >
                            {r === "testing" ? "测试中" : "测试"}
                          </button>
                          <button
                            className="btn small"
                            disabled={!siteKindOk(s) || !on}
                            onClick={() => {
                              setCurrent(s.key);
                              setTab("browse");
                            }}
                          >
                            浏览
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="field-hint" style={{ marginTop: 8 }}>
            测试 = 请求一次该站点分类接口并计时；失败原因已分类（域名解析 / TLS / 超时 / HTTP 状态码）。
            停用的站点不参与聚合搜索与批量测试。
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 20 }}>
          {/* 站点列表 */}
          <div className="card" style={{ width: 220, flexShrink: 0, padding: 10, maxHeight: "calc(100vh - 220px)", overflowY: "auto" }}>
            {okSites.map((s) => {
              const on = isSiteEnabled(enabledMap, s.key);
              return (
                <div key={s.key}>
                  <div
                    className={`live-channel ${current === s.key ? "active" : ""}`}
                    style={{ opacity: on ? 1 : 0.4, cursor: on ? "pointer" : "not-allowed" }}
                    title={on ? s.name : "该站点已在源管理中停用"}
                    onClick={() => on && setCurrent(s.key)}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.name}
                    </span>
                    <span className="spacer" />
                    <span className="lines">
                      {siteIsCms(s) ? "CMS" : "网页"}
                      {!on && " · 停"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 分类 + 列表 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {curSite && (
              <div className="row" style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{curSite.name}</div>
                <button className="btn small" disabled={testing === curSite.key} onClick={() => testSite(curSite)}>
                  {testing === curSite.key ? "测试中…" : "测试连通"}
                </button>
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
