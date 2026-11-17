import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useApp } from "../store";
import { siteKindOk } from "../types";
import type { AppInfo, AppSettings } from "../types";

// 相对时间：x 分钟前 / x 小时前 / x 天前
function relTime(ms: number): string {
  if (!ms) return "从未同步";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

// 简易开关
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <span
      className={`toggle ${on ? "on" : ""}`}
      onClick={onClick}
      role="switch"
      aria-checked={on}
    />
  );
}

export default function Settings() {
  const { state, settings, reloadAll, reloadSettings, applyAppearance, toast } = useApp();
  const [url, setUrl] = useState("");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState("");

  // 通用/AI 设置草稿：加载后可编辑，点「保存设置」一次性写入
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [detected, setDetected] = useState<string[] | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  useEffect(() => {
    api.getAppInfo().then(setAppInfo).catch(() => undefined);
  }, []);

  const subs = state?.subscriptions ?? [];
  const activeId = state?.activeId ?? null;
  const activeCfg = state?.activeConfig ?? null;
  const okCount = activeCfg?.sites.filter(siteKindOk).length ?? 0;

  const set = (patch: Partial<AppSettings>) => {
    if (draft) setDraft({ ...draft, ...patch });
  };

  const saveAll = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      const saved = await api.saveSettings(draft);
      setDraft(saved);
      applyAppearance(saved);
      await reloadSettings();
      toast("设置已保存", "success");
    } catch (e) {
      toast(`保存失败: ${String(e)}`, "error");
    } finally {
      setBusy("");
    }
  };

  const addUrl = async () => {
    if (!url.trim()) return;
    setBusy("url");
    try {
      const sub = await api.addSubscriptionUrl(url.trim());
      toast(`订阅「${sub.name}」添加成功`, "success");
      setUrl("");
      await reloadAll();
    } catch (e) {
      toast(`添加失败: ${String(e)}`, "error");
    } finally {
      setBusy("");
    }
  };

  const addRaw = async () => {
    if (!raw.trim()) return;
    setBusy("raw");
    try {
      const sub = await api.addSubscriptionRaw(raw);
      toast(`订阅「${sub.name}」添加成功`, "success");
      setRaw("");
      await reloadAll();
    } catch (e) {
      toast(`添加失败: ${String(e)}`, "error");
    } finally {
      setBusy("");
    }
  };

  const addLocal = async () => {
    setBusy("local");
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "TVBox 配置", extensions: ["json"] }],
      });
      if (!path) return;
      const sub = await api.addSubscriptionLocal(path as string);
      toast(`订阅「${sub.name}」添加成功`, "success");
      await reloadAll();
    } catch (e) {
      toast(`添加失败: ${String(e)}`, "error");
    } finally {
      setBusy("");
    }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy("op");
    try {
      await fn();
      await reloadAll();
    } catch (e) {
      toast(`${msg}: ${String(e)}`, "error");
    } finally {
      setBusy("");
    }
  };

  const renameSub = async (id: string, oldName: string) => {
    const name = window.prompt("修改订阅名称", oldName);
    if (name == null || !name.trim() || name === oldName) return;
    await act(() => api.renameSubscription(id, name.trim()), "重命名失败");
  };

  return (
    <div>
      <h1 className="page-title">设置</h1>
      <p className="page-desc">
        配置源、解析接口、播放与界面偏好；支持 TVBox 标准 JSON 与本项目 tvbox-desktop/1 简洁格式
      </p>

      {/* ============ 配置源 ============ */}
      <div className="section-title">
        <b>配置源</b>
        <span className="section-hint">
          支持 TVBox 标准 JSON 与 tvbox-desktop/1 简洁格式
        </span>
      </div>
      <div className="card" style={{ padding: 18, marginBottom: 12 }}>
        <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 320 }}
            placeholder="订阅链接，如 https://example.com/config.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
          />
          <button className="btn primary" disabled={busy === "url"} onClick={addUrl}>
            {busy === "url" ? "添加中…" : "添加链接"}
          </button>
          <button className="btn" disabled={busy === "local"} onClick={addLocal}>
            {busy === "local" ? "选择中…" : "选择本地 JSON"}
          </button>
        </div>
        <textarea
          className="input"
          placeholder="或粘贴 TVBox 配置 JSON 内容…"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy === "raw" || !raw.trim()} onClick={addRaw}>
            {busy === "raw" ? "添加中…" : "添加粘贴的配置"}
          </button>
        </div>
      </div>

      <b style={{ display: "block", marginBottom: 12 }}>
        我的订阅（当前生效配置含 {activeCfg?.sites.length ?? 0} 个站点，其中 {okCount} 个桌面端可用）
      </b>
      {subs.map((s) => {
        const isActive = s.enabled && s.id === activeId;
        const okSites = s.config.sites.filter(siteKindOk).length;
        return (
          <div className={`card sub-item ${!s.enabled ? "disabled" : ""}`} key={s.id}>
            <Toggle
              on={s.enabled}
              onClick={() =>
                act(
                  () => api.setSubscriptionEnabled(s.id, !s.enabled),
                  s.enabled ? "禁用失败" : "启用失败"
                )
              }
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row">
                <span className="name" style={{ cursor: "pointer" }} onClick={() => renameSub(s.id, s.name)} title="点击重命名">
                  {s.name}
                </span>
                {isActive && <span className="badge">使用中</span>}
                {!s.enabled && <span className="badge gray">已停用</span>}
                <span className="badge gray">
                  站点 {s.config.sites.length} · 直播 {s.config.lives?.length ?? 0} · 解析 {s.config.parses?.length ?? 0}
                </span>
                <span className="badge gray">{okSites} 可用</span>
              </div>
              <div className="url" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.url}>
                {s.url}
              </div>
              <div style={{ color: "var(--text3)", fontSize: 12, marginTop: 2 }}>
                同步：{relTime(s.updated_at)}
              </div>
            </div>
            <button
              className="btn small"
              disabled={!s.enabled || isActive || busy === "op"}
              title={!s.enabled ? "请先启用该订阅" : ""}
              onClick={() => act(() => api.setActiveSubscription(s.id), "激活失败")}
            >
              激活
            </button>
            <button
              className="btn small"
              disabled={busy === "op"}
              onClick={() => act(() => api.refreshSubscription(s.id), "刷新失败")}
            >
              刷新
            </button>
            <button
              className="btn small danger"
              disabled={busy === "op"}
              onClick={() => act(() => api.removeSubscription(s.id), "删除失败")}
            >
              删除
            </button>
          </div>
        );
      })}
      {subs.length === 0 && <div className="empty">暂无订阅，请先添加</div>}

      {/* ============ 解析接口 ============ */}
      <div className="section-title" style={{ marginTop: 28 }}>
        <b>解析接口</b>
        <span className="section-hint">{activeCfg?.parses?.length ?? 0} 条</span>
      </div>
      <div className="card" style={{ padding: 18, marginBottom: 12 }}>
        <div style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.7 }}>
          有些采集站给的线路不是直链，而是一个分享页地址。播放时会<b>先自己读一遍那个页面</b>
          （简易嗅探），读不出来才按下面的顺序依次解析接口；失败的接口本轮会排到后面。
          接口来自当前激活订阅的 <code>parses</code> 字段。
        </div>
        {(activeCfg?.parses?.length ?? 0) === 0 ? (
          <div className="empty" style={{ marginTop: 12 }}>
            当前订阅没有解析接口。如果你的 TVBox 订阅里有 parses 字段，刷新订阅后会自动出现在这里。
          </div>
        ) : (
          activeCfg!.parses.map((p, i) => (
            <div className="card sub-item" key={i} style={{ marginTop: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row">
                  <span className="name">{p.name || `接口 ${i + 1}`}</span>
                  <span className="badge gray">第 {i + 1} 顺位</span>
                </div>
                <div className="url" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.url}>
                  {p.url}
                </div>
              </div>
              <button
                className="btn small"
                disabled={busy === "test"}
                onClick={async () => {
                  setBusy("test");
                  try {
                    const r = await api.resolveParse(p.url, "https://example.com/play/1");
                    toast(`接口连通，示例解析返回：${r.slice(0, 60)}…`, "success");
                  } catch (e) {
                    toast(`接口测试失败（示例地址无真实内容，属常见现象）：${String(e).slice(0, 80)}`, "error");
                  } finally {
                    setBusy("");
                  }
                }}
              >
                测试
              </button>
            </div>
          ))
        )}
      </div>

      {/* ============ 通用 ============ */}
      <div className="section-title" style={{ marginTop: 28 }}>
        <b>通用</b>
        <span className="section-hint">修改后点击底部「保存设置」生效</span>
      </div>
      {draft && (
        <div className="card" style={{ padding: 18, marginBottom: 12 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 18, marginBottom: 14 }}>
            <div>
              <label className="field-label">聚合搜索并发数（1–32）</label>
              <input
                className="input"
                type="number"
                min={1}
                max={32}
                style={{ width: 160 }}
                value={draft.search_concurrency}
                onChange={(e) => set({ search_concurrency: Number(e.target.value) || 8 })}
              />
              <div className="field-hint">同时请求的站点数，过大可能被部分站点限流</div>
            </div>
            <div>
              <label className="field-label">请求超时（秒）</label>
              <input
                className="input"
                type="number"
                min={1}
                max={120}
                style={{ width: 160 }}
                value={draft.request_timeout}
                onChange={(e) => set({ request_timeout: Number(e.target.value) || 20 })}
              />
              <div className="field-hint">单站点搜索/详情请求的最长等待</div>
            </div>
            <div>
              <label className="field-label">界面密度</label>
              <select
                className="input"
                style={{ width: 200 }}
                value={draft.density}
                onChange={(e) => set({ density: e.target.value })}
              >
                <option value="cozy">舒适（默认）</option>
                <option value="compact">紧凑（信息更多）</option>
              </select>
            </div>
            <div>
              <label className="field-label">主题</label>
              <select
                className="input"
                style={{ width: 200 }}
                value={draft.theme === "dark" ? "dark" : "light"}
                onChange={(e) => set({ theme: e.target.value })}
              >
                <option value="light">浅色（默认）</option>
                <option value="dark">深色（夜间护眼）</option>
              </select>
              <div className="field-hint">深色主题全局生效，含海报页与播放页</div>
            </div>
            <div>
              <label className="field-label">强调色</label>
              <div className="row">
                <input
                  type="color"
                  style={{ width: 42, height: 34, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)" }}
                  value={draft.accent}
                  onChange={(e) => set({ accent: e.target.value })}
                />
                <span style={{ fontSize: 13, color: "var(--text2)" }}>{draft.accent}</span>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginBottom: 14 }}>
            <Toggle
              on={draft.hide_commentary}
              onClick={() => set({ hide_commentary: !draft.hide_commentary })}
            />
            <div>
              <b style={{ fontSize: 14 }}>搜索结果过滤解说</b>
              <div className="field-hint">
                采集站常把「XX解说」「一口气看完」和正片放一起，开启后自动挡掉
              </div>
            </div>
          </div>

          <label className="field-label">User-Agent（部分站点会校验，异常时可恢复默认）</label>
          <textarea
            className="input"
            style={{ marginBottom: 14 }}
            placeholder="留空使用内置默认 UA"
            value={draft.ua}
            onChange={(e) => set({ ua: e.target.value })}
          />

          <label className="field-label">外部播放器命令</label>
          <input
            className="input"
            style={{ marginBottom: 6 }}
            placeholder="留空则自动探测 PotPlayer / VLC / mpv"
            value={draft.ext_player}
            onChange={(e) => set({ ext_player: e.target.value })}
          />
          <div className="field-hint" style={{ marginBottom: 8 }}>
            参数模板用 <code>{"{url}"}</code> 代表播放地址，多个参数用空格分隔，例如 <code>--fullscreen {"{url}"}</code>
          </div>
          <div className="row" style={{ marginBottom: 4 }}>
            <button
              className="btn small"
              onClick={async () => {
                try {
                  const list = await api.detectPlayers();
                  setDetected(list);
                } catch (e) {
                  toast(`检测失败: ${String(e)}`, "error");
                }
              }}
            >
              检测本机播放器
            </button>
            {detected && (
              <span style={{ fontSize: 13, color: "var(--text2)" }}>
                {detected.length === 0 ? "未检测到已知播放器，请手动填写命令" : `检测到 ${detected.length} 个：${detected.join("；")}`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ============ AI 总结 ============ */}
      <div className="section-title" style={{ marginTop: 28 }}>
        <b>AI 总结</b>
        <span className="section-hint">
          {draft?.ai.api_key ? "已配置 API Key" : "还没配置 API Key"}
        </span>
      </div>
      {draft && (
        <div className="card" style={{ padding: 18, marginBottom: 12 }}>
          <label className="field-label">DeepSeek API Key（兼容任何 OpenAI 格式服务）</label>
          <div className="row" style={{ marginBottom: 6 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 320 }}
              type={showKey ? "text" : "password"}
              placeholder="sk-…"
              value={draft.ai.api_key}
              onChange={(e) => set({ ai: { ...draft.ai, api_key: e.target.value } })}
            />
            <button className="btn small" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
          <div className="field-hint" style={{ marginBottom: 14 }}>
            在 platform.deepseek.com 的「API keys」里创建。只保存在本机 settings.json，不会上传到任何地方。
          </div>

          <div className="row" style={{ flexWrap: "wrap", gap: 18, marginBottom: 14 }}>
            <div>
              <label className="field-label">模型</label>
              <input
                className="input"
                style={{ width: 220 }}
                placeholder="deepseek-flash"
                value={draft.ai.model}
                onChange={(e) => set({ ai: { ...draft.ai, model: e.target.value } })}
              />
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label className="field-label">接口地址</label>
              <input
                className="input"
                placeholder="留空 = https://api.deepseek.com，自动拼 /chat/completions"
                value={draft.ai.base_url}
                onChange={(e) => set({ ai: { ...draft.ai, base_url: e.target.value } })}
              />
              <div className="field-hint">换成任何 OpenAI 兼容的服务都可以</div>
            </div>
          </div>

          <div
            style={{
              background: "var(--accent-soft)",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              color: "var(--text2)",
            }}
          >
            点播放页的「AI 总结本集」时，会把片名、集名、类型、年份、演员和站点简介发给模型，用来生成这一集的剧情梗概。不会发送播放地址，也不会在后台自动调用。
          </div>
        </div>
      )}

      {draft && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button className="btn primary" disabled={busy === "save"} onClick={saveAll}>
            {busy === "save" ? "保存中…" : "保存设置"}
          </button>
          <button className="btn" onClick={() => setDraft(settings)}>
            放弃修改
          </button>
        </div>
      )}

      {/* ============ 关于 ============ */}
      <div className="section-title" style={{ marginTop: 28 }}>
        <b>关于</b>
      </div>
      <div className="card" style={{ padding: 18, marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            <tr>
              <td className="about-key">版本</td>
              <td className="about-val">{appInfo?.version ?? "…"}</td>
            </tr>
            <tr>
              <td className="about-key">运行环境</td>
              <td className="about-val">{appInfo?.runtime ?? "…"} · {appInfo?.os ?? ""}</td>
            </tr>
            <tr>
              <td className="about-key">数据目录</td>
              <td className="about-val">
                <span style={{ wordBreak: "break-all" }}>{appInfo?.dataDir ?? "…"}</span>
                <button className="btn small" style={{ marginLeft: 10 }} onClick={() => api.openDataDir().catch((e) => toast(String(e), "error"))}>
                  打开目录
                </button>
              </td>
            </tr>
            <tr>
              <td className="about-key">开源组件</td>
              <td className="about-val">Tauri 2 · Rust · React · ArtPlayer · hls.js</td>
            </tr>
          </tbody>
        </table>
        <div className="field-hint" style={{ marginTop: 10 }}>
          本软件是纯粹的空壳播放器，不内置、不提供、不分发任何影视内容。请自行添加合法的配置源。
        </div>
      </div>
    </div>
  );
}
