import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import PosterCard from "../components/PosterCard";
import { siteIsCms, siteKindOk } from "../types";
import type { CmsClass, PagedVideos, SiteConfig } from "../types";

export default function Sources() {
  const { state, toast } = useApp();
  const sites: SiteConfig[] = state?.activeConfig?.sites ?? [];

  const [current, setCurrent] = useState<string>("");
  const [classes, setClasses] = useState<CmsClass[]>([]);
  const [classId, setClassId] = useState<number>(0);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PagedVideos | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<string>("");

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

  return (
    <div>
      <h1 className="page-title">影视源</h1>
      <p className="page-desc">浏览当前订阅的站点与分类，支持分页与站点连通性测试</p>

      <div style={{ display: "flex", gap: 20 }}>
        {/* 站点列表 */}
        <div className="card" style={{ width: 220, flexShrink: 0, padding: 10, maxHeight: "calc(100vh - 190px)", overflowY: "auto" }}>
          {sites.map((s) => {
            const ok = siteKindOk(s);
            return (
              <div key={s.key}>
                <div
                  className={`live-channel ${current === s.key ? "active" : ""}`}
                  style={{ opacity: ok ? 1 : 0.45, cursor: ok ? "pointer" : "not-allowed" }}
                  title={ok ? s.name : s.unsupported_reason || "不支持"}
                  onClick={() => ok && setCurrent(s.key)}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                  <span className="spacer" />
                  <span className="lines">
                    {s.kind === "cms" || s.kind === "api"
                      ? "CMS"
                      : s.kind === "html"
                        ? "网页"
                        : "不支持"}
                  </span>
                </div>
                {!ok && (
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
    </div>
  );
}
