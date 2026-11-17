import { useCallback, useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { siteKindOk } from "../types";
import type { SiteConfig } from "../types";

// 站点测速状态：ok + 延迟毫秒（复用直播线路测速 speed_test_lines，GET Range 探测）
interface SpeedState {
  testing: boolean;
  ok: boolean;
  ms: number; // -1 = 失败
}

// 站点启用开关：开 = 主题色高亮，关 = 灰色，一眼区分
function SiteToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span
      className={`toggle ${on ? "on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      role="switch"
      aria-checked={on}
      title={on ? "已启用，点击停用" : "已停用，点击启用"}
    />
  );
}

export default function Sources() {
  const { state, toast, reloadState } = useApp();
  const sites: SiteConfig[] = state?.activeConfig?.sites ?? [];

  // 筛选：搜索名称/key/接口 + 类型 + 只看已启用
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "cms" | "html">("all");
  const [onlyEnabled, setOnlyEnabled] = useState(false);

  // 测速：站点 key -> 状态（并发 4 路）
  const [speedMap, setSpeedMap] = useState<Record<string, SpeedState>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDone, setBatchDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [busyToggles, setBusyToggles] = useState(false);

  const siteEnabled = (s: SiteConfig) => s.enabled == null || s.enabled !== 0;

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return sites.filter((s) => {
      if (kw) {
        const hay = `${s.name} ${s.key} ${s.api}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      if (kind === "cms" && !siteKindOk(s)) return false;
      if (kind === "html" && s.kind !== "html") return false;
      if (onlyEnabled && !siteEnabled(s)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, q, kind, onlyEnabled]);

  // 测一个站点：GET Range 探测接口地址，报告延迟
  const testSite = useCallback(
    async (site: SiteConfig) => {
      setSpeedMap((m) => ({
        ...m,
        [site.key]: { testing: true, ok: false, ms: -1 },
      }));
      try {
        const res = await api.speedTestLines([site.api]);
        const r = res[0];
        setSpeedMap((m) => ({
          ...m,
          [site.key]: {
            testing: false,
            ok: !!r?.ok,
            ms: r?.delay_ms ?? -1,
          },
        }));
      } catch {
        setSpeedMap((m) => ({
          ...m,
          [site.key]: { testing: false, ok: false, ms: -1 },
        }));
      }
    },
    []
  );

  // 批量测速：并发 4 路，逐个显示
  const batchTest = useCallback(
    async (list: SiteConfig[]) => {
      const targets = list.filter(siteKindOk);
      if (targets.length === 0) return;
      setBatchRunning(true);
      setBatchDone(0);
      setBatchTotal(targets.length);
      setSpeedMap((m) => {
        const next = { ...m };
        for (const s of targets) next[s.key] = { testing: true, ok: false, ms: -1 };
        return next;
      });
      const queue = [...targets];
      let done = 0;
      const worker = async () => {
        while (queue.length > 0) {
          const s = queue.shift()!;
          try {
            const res = await api.speedTestLines([s.api]);
            const r = res[0];
            setSpeedMap((m) => ({
              ...m,
              [s.key]: { testing: false, ok: !!r?.ok, ms: r?.delay_ms ?? -1 },
            }));
          } catch {
            setSpeedMap((m) => ({
              ...m,
              [s.key]: { testing: false, ok: false, ms: -1 },
            }));
          }
          done += 1;
          setBatchDone(done);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(4, targets.length) }, () => worker())
      );
      setBatchRunning(false);
    },
    []
  );

  // 批量启用/停用（顺序写入，避免并发写坏 subscriptions.json）
  const batchSetEnabled = useCallback(
    async (list: SiteConfig[], enable: boolean) => {
      const targets = list.filter((s) => siteEnabled(s) !== enable);
      if (targets.length === 0) {
        toast(enable ? "所选站点均已启用" : "所选站点均已停用");
        return;
      }
      setBusyToggles(true);
      let okCount = 0;
      try {
        for (const s of targets) {
          try {
            await api.setSiteEnabled(s.key, enable);
            okCount++;
          } catch {
            /* 单个失败继续 */
          }
        }
        await reloadState();
        toast(
          enable
            ? `已批量启用 ${okCount} 个站点`
            : `已批量停用 ${okCount} 个站点（不参与聚合搜索与浏览）`,
          "success"
        );
      } finally {
        setBusyToggles(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 单独启用/停用
  const toggleSite = async (site: SiteConfig) => {
    const next = !siteEnabled(site);
    try {
      await api.setSiteEnabled(site.key, next);
      await reloadState();
      toast(
        next
          ? `站点「${site.name}」已启用（聚合搜索将包含该站点）`
          : `站点「${site.name}」已停用`,
        "success"
      );
    } catch (e) {
      toast(`切换站点状态失败: ${String(e)}`, "error");
    }
  };

  if (sites.length === 0) {
    return (
      <div className="empty">当前订阅没有站点。请到「设置」添加订阅。</div>
    );
  }

  const enabledCount = sites.filter(siteEnabled).length;
  const kindOkCount = sites.filter(siteKindOk).length;
  const htmlCount = sites.filter((s) => s.kind === "html").length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 4, flexWrap: "wrap" }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          影视源
        </h1>
        <div className="spacer" />
        <button
          className="btn"
          disabled={batchRunning}
          onClick={() => {
            reloadState();
            toast("站点列表已刷新", "success");
          }}
        >
          ⟳ 刷新列表
        </button>
        <button
          className="btn"
          disabled={batchRunning || busyToggles || filtered.length === 0}
          onClick={() => batchTest(filtered)}
        >
          {batchRunning
            ? `测试中 ${batchDone}/${batchTotal}…`
            : `✓ 测试当前列表 (${filtered.length})`}
        </button>
        <button
          className="btn"
          disabled={batchRunning || busyToggles || filtered.length === 0}
          onClick={() => batchSetEnabled(filtered, true)}
        >
          全部启用
        </button>
        <button
          className="btn danger"
          disabled={batchRunning || busyToggles || filtered.length === 0}
          onClick={() => batchSetEnabled(filtered, false)}
        >
          全部禁用
        </button>
      </div>
      <p className="page-desc">
        共 {sites.length} 个站点 · 启用 {enabledCount} 个 · 当前列表{" "}
        {filtered.length} 个；停用的站点不参与聚合搜索与分类浏览，开关状态持久化到订阅配置
      </p>

      {/* 筛选行 */}
      <div className="row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ width: 280 }}
          placeholder="搜索站点名称 / key / 接口"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span
          className={`chip ${kind === "all" ? "active" : ""}`}
          onClick={() => setKind("all")}
        >
          全部类型 {sites.length}
        </span>
        <span
          className={`chip ${kind === "cms" ? "active" : ""}`}
          onClick={() => setKind("cms")}
        >
          苹果CMS {kindOkCount}
        </span>
        <span
          className={`chip ${kind === "html" ? "active" : ""}`}
          onClick={() => setKind("html")}
        >
          网页 {htmlCount}
        </span>
        <div className="spacer" />
        <span
          className={`chip ${onlyEnabled ? "active" : ""}`}
          onClick={() => setOnlyEnabled((v) => !v)}
        >
          只看已启用
        </span>
      </div>

      {/* 站点列表 */}
      <div className="card site-list">
        {filtered.map((s) => {
          const enabled = siteEnabled(s);
          const ok = siteKindOk(s);
          const sp = speedMap[s.key];
          return (
            <div key={s.key} className="site-row">
              <SiteToggle on={enabled} onClick={() => toggleSite(s)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span
                    className="site-name"
                    style={{ opacity: ok ? 1 : 0.5 }}
                    title={
                      ok
                        ? s.name
                        : s.unsupported_reason || "不支持"
                    }
                  >
                    {s.name}
                  </span>
                  <span className="kind-tag">
                    {s.kind === "cms" || s.kind === "api"
                      ? "苹果CMS"
                      : s.kind === "html"
                        ? "网页"
                        : "不支持"}
                  </span>
                  {s.searchable === 1 && (
                    <span className="kind-tag green">可搜索</span>
                  )}
                </div>
                <div className="site-api" title={s.api}>
                  {s.key} · {s.api}
                </div>
              </div>
              <div className="site-speed" title="接口连通测速（GET 探测）">
                {sp?.testing ? (
                  <span className="spin">⟳</span>
                ) : sp ? (
                  sp.ok ? (
                    <span className="speed-val">
                      <span className="dot ok" />
                      {sp.ms >= 0 ? `${sp.ms}ms` : "成功"}
                    </span>
                  ) : (
                    <span className="speed-val bad">
                      <span className="dot bad" />
                      失败
                    </span>
                  )
                ) : (
                  <span style={{ color: "var(--text3)", fontSize: 12 }}>未测</span>
                )}
              </div>
              <button
                className="btn small"
                disabled={!ok || (sp?.testing ?? false)}
                onClick={() => testSite(s)}
              >
                {sp?.testing ? "测试中" : "测试"}
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty">没有符合筛选条件的站点</div>
        )}
      </div>
    </div>
  );
}
