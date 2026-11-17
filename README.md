# TVBox Desktop（Tauri 2 重写版）

原 [hgtuj5688/tvbox-desktop](https://github.com/hgtuj5688/tvbox-desktop)（Electron 44 + React 19）的**全功能对齐重写版**：使用 **Tauri 2 + Rust + React 18 + TypeScript**，目标是更小的安装包（约 10MB 级别 vs Electron 100MB+）、更低的内存占用与三平台原生打包。

> 本项目遵循原项目 MIT 协议，内置订阅示例改写自原项目 `samples/public-sources.json` 并注明出处。

## 功能对照

| 功能 | 原版（Electron） | 本重写版（Tauri 2） |
| --- | --- | --- |
| 订阅源管理（URL / 本地 / 粘贴 / 刷新 / 激活 / 重命名） | ✅ | ✅ |
| 订阅启用开关 + 同步时间显示 | ✅ | ✅ |
| 解析接口（parses）：播放嗅探失败后依次兜底 | ✅ | ✅（Rust resolve_parse，多接口自动回退） |
| 通用设置（并发数 / 超时 / 密度 / 强调色 / 过滤解说 / 自定义 UA） | ✅ | ✅（settings.json 持久化） |
| 外部播放器命令模板（{url} 占位）+ 本机播放器检测 | ✅ | ✅ |
| AI 总结本集（DeepSeek / OpenAI 兼容） | ✅ | ✅（Rust 侧调用，只发元信息） |
| 关于页（版本 / 数据目录 / 免责声明） | ✅ | ✅（open_data_dir） |
| TVBox A/B 双格式配置兼容 | ✅ | ✅ |
| 站点类型矩阵（cms/api/html 支持，spider/unknown 灰显） | ✅ | ✅ |
| 分类浏览 + 分页 | ✅ | ✅ |
| 聚合搜索（并发 + 超时 + 进度事件） | ✅ | ✅（Rust tokio 并发，6 路并发、12s 单站超时） |
| 详情 + 多播放源 + 选集 | ✅ | ✅ |
| ArtPlayer + hls.js 播放 | ✅ | ✅ |
| 观看进度记忆 + 自动续播 | ✅ | ✅（8 秒节流上报，详情页自动恢复） |
| 收藏 / 历史 | ✅ | ✅ |
| 直播电视（m3u / txt，多线路合并） | ✅ | ✅ |
| 直播线路测速 | ✅ | ✅（Rust 并发测速，Range 请求 6s 超时） |
| 虎牙/抖音房间号（huya:// douyin://） | ✅ | ✅（页面结构解析，实验性） |
| 首页推荐位（tvboxDesktop.home.sections） | ✅ | ✅（无 sections 时自动回退到站点最新列表） |
| 网页线路嗅探 | ✅（Electron webContents） | ✅ 双通道简易版：HTML 直取正则提取 + Webview hook 窗口（详见下文） |
| 一键外部播放器 | ✅ | ✅ Rust 直接拉起 PotPlayer / VLC / mpv / IINA（自动探测 + 设置页可指定路径） |
| 深色/浅色主题（标题栏同步） | ❌ | ✅ 默认深色，设置页切换，Windows 标题栏颜色跟随 |
| 聚合搜索历史记录 | ❌ | ✅ 最近搜索关键词可点击重搜/删除，最多 20 条持久化 |
| 聚合搜索结果跨页面保活 | ❌ | ✅ 切页面回来关键词与结果还在，不无谓重搜 |
| 搜索结果内直接选集播放 | ❌ | ✅ 结果卡片展开片源标签+选集，点击后走与详情页同一条解析管线内嵌播放；嗅探单直链自动选路 |
| 站点启用开关（亮/灰区分） | ❌ | ✅ 影视源页每个站点独立开关，停用站点不参与搜索/浏览，状态持久化 |
| 站点批量连通测试 | ❌ | ✅ 并发 4 路逐站显示 ✓/✗/… |
| 本地播放（本机视频文件） | ❌ | ✅ 选本机视频/音频用内置播放器播，列表本机保存 |
| 版本号 + 检查更新 | ❌ | ✅ 关于页显示版本，update_url 支持 JSON 清单/纯文本版本号，发现新版可打开下载页 |
| 配置文件可编辑 + 热重载 | ❌ | ✅ 关于页展示数据目录/四个配置文件，一键打开目录 +「重新加载配置」无需重启；支持便携模式（exe 同目录 data 文件夹） |

## 技术栈

- **桌面壳**：Tauri 2（WebView2 / WKWebView / webkit2gtk）
- **核心逻辑**：Rust（reqwest + rustls、tokio、scraper、encoding_rs、regex）
- **前端**：React 18 + TypeScript + Vite 5 + zustand + react-router（Hash 模式）
- **播放**：ArtPlayer 5 + hls.js 1.5
- **本地存储**：`app_data_dir`（或便携模式下的 exe 同目录 `data/`）下的 JSON 文件（subscriptions / favorites / history / settings）

## 目录结构

```
├── index.html                  # Vite 入口
├── package.json                # 前端依赖 + tauri CLI 脚本
├── vite.config.ts
├── src/                        # React 前端
│   ├── api.ts                  # invoke / event 封装（与 Rust 命令一一对应）
│   ├── types.ts                # 与 Rust serde 模型对齐的类型
│   ├── store.ts                # zustand 全局状态 + toast
│   ├── components/             # Sidebar / PosterCard / Player(ArtPlayer+hls.js)
│   └── pages/                  # Home / Sources / Search / Detail / Live / LocalPlay / Favorites / History / Settings
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json         # 窗口/打包/图标配置（NSIS + dmg + deb/appimage）
│   ├── capabilities/default.json
│   └── src/
│       ├── lib.rs              # 装配 + 38 个 command 注册 + 便携模式数据目录解析
│       ├── models.rs           # TVBox 配置 serde 模型（A/B 双格式）
│       ├── cms.rs              # 苹果CMS v10 JSON 客户端 + 播放地址解析（含单元测试）
│       ├── htmlsite.rs         # 网页规则站 CSS 选择器搜索
│       ├── search.rs           # 聚合搜索并发调度 + 进度事件
│       ├── live.rs             # 直播 m3u/txt 解析 + 测速（含单元测试）
│       ├── room.rs             # 虎牙/抖音房间号解析
│       ├── sniffer.rs          # 简易嗅探：HTML 直取 + Webview hook 窗口
│       ├── external.rs         # 外部播放器：命令模板 {url} + 自动探测 PotPlayer/VLC/mpv
│       ├── settings.rs         # 应用设置 settings.json（并发/超时/UA/强调色/AI 配置）
│       ├── parse.rs            # 解析接口兜底：嗅探失败后依次尝试 parses
│       ├── ai.rs               # AI 剧情总结（OpenAI 兼容 /chat/completions）
│       ├── storage.rs          # JSON 文件存储
│       ├── http.rs             # 统一 HTTP（UA/超时/GBK 编码兜底）
│       ├── builtin/            # 内置订阅 JSON
│       └── commands.rs         # 全部 Tauri command
├── samples/                    # 示例配置（demo-config.json / public-sources.json）
├── docs/ARCHITECTURE.md        # 架构与数据流说明
└── scripts/gen_icons.py        # 图标生成脚本（ico/icns/png）
```

## 本地构建

前置条件：

- Node.js >= 18、npm
- Rust >= 1.77（rustup）
- 平台依赖：
  - Windows：WebView2（Win10/11 自带）、MSVC Build Tools
  - macOS：Xcode Command Line Tools
  - Linux：`libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`（Debian/Ubuntu）

```bash
npm install            # 安装前端依赖

npm run tauri:dev      # 开发模式（Rust 变更会自动重编译）

npm run tauri:build    # 三平台打包
# 产物：src-tauri/target/release/bundle/
#   Windows → nsis/*.exe
#   macOS   → dmg/*.dmg
#   Linux   → deb/ appimage/
```

Rust 端单元测试（CMS 地址构造 / 播放地址解析 / 直播解析）：

```bash
cd src-tauri && cargo test
```

## 数据目录与配置文件（支持便携模式）

应用启动时按以下顺序决定配置目录：

1. **便携模式**：若 exe 同目录存在 `data` 文件夹，所有配置都存在 `data/` 里，可随目录整体拷贝、直接编辑；
2. 否则用系统数据目录：Windows 为 `%APPDATA%\com.tvbox.desktop`，macOS 为 `~/Library/Application Support/com.tvbox.desktop`，Linux 为 `~/.local/share/com.tvbox.desktop`。

目录内文件：

| 文件 | 内容 |
| --- | --- |
| `subscriptions.json` | 订阅列表与站点配置（active_id / subscriptions） |
| `settings.json` | 应用设置（主题、强调色、UA、update_url 更新地址、AI Key 等） |
| `favorites.json` / `history.json` | 收藏 / 观看历史 |

设置 → 关于 页可以看到实际路径、一键「打开目录」，并提供「重新加载配置」按钮：手工修改 JSON 保存后点击即可生效，无需重启应用。

「检查更新」使用的更新地址（settings.json 的 `update_url`）支持两种格式：

- JSON 清单：`{"version":"1.7.0","notes":"修复说明","url":"下载页链接"}`
- 纯文本：直接返回版本号（如 `1.7.0`）

## 配置格式

完整兼容原项目两种格式：

- **A 格式**：直接使用安卓 TVBox 订阅地址（解析 sites / lives；csp spider 站点会灰显）
- **B 格式**（`tvbox-desktop/1`）：扩展字段统一放在 `tvboxDesktop` 键下，包括首页推荐位：

```json
{
  "format": "tvbox-desktop/1",
  "name": "我的订阅",
  "sites": [
    { "key": "example_cms", "name": "示例站", "type": "cms",
      "api": "https://example.com/api.php/provide/vod", "searchable": 1 },
    { "key": "tpl", "name": "占位符写法", "type": 3,
      "api": "https://x.com/vod?ac={ac}&t={t}&pg={pg}&wd={wd}&ids={ids}", "searchable": 1 }
  ],
  "lives": [{ "name": "直播源", "type": 0, "url": "https://example.com/live.txt" }],
  "tvboxDesktop": {
    "home": {
      "sections": [
        { "title": "电影 · 最近更新", "site": "example_cms" },
        { "title": "电影 · 动作片", "site": "example_cms", "typeId": 6 }
      ]
    }
  }
}
```
# 如有侵权联系必删除

# **支持正版，反对盗版**

## 订阅源说明
**本项目为壳项目不内置订阅源**
如有需求请自行收集[苹果CMSV10(MACcmsV10)](https://github.com/magicblack/maccms10)源，[参考源](https://github.com/hafrey1/LunaTV-config)
## 苹果cmsv10（MACcmsv10）源路径 
> windows文件路径：C:\Users\用户名\AppData\Roaming\com.tvbox.desktop\subscriptions.json
```json
{
  "active_id": null,
  "subscriptions": [
    {
      "id": "builtin:public-sources",
      "name": "内置推荐订阅（公开采集站）",
      "url": "builtin:public-sources",
      "created_at": 1794894800672,
      "updated_at": 1794894800672,
      "enabled": true,
      "config": {
        "format": "tvbox-desktop/1",
        "name": "公开可用源（苹果CMS 采集站）",
        "sites": [
          {
            "key": "aexample",
            "name": "aexample资源",
            "api": "https://api.aexample.com/api.php/provide/vod",
            "type": "cms",
            "searchable": 1,
            "quick_search": 0,
            "filterable": 0,
            "categories": [],
            "header": {},
            "timeout": null,
            "enabled": null,
            "kind": "cms",
            "rules": null,
            "unsupported_reason": ""
          },
          {
            "key": "bexample",
            "name": "bexample资源",
            "api": "https://cj.bexample.com/api.php/provide/vod",
            "type": "cms",
            "searchable": 1,
            "quick_search": 0,
            "filterable": 0,
            "categories": [],
            "header": {},
            "timeout": null,
            "enabled": null,
            "kind": "cms",
            "rules": null,
            "unsupported_reason": ""
          }
        ],
        "lives": [
          {
            "name": "公开直播源·IPv4（txt）",
            "url": "https://live.cexample.top/tv/iptv4.txt",
            "type": 0,
            "groups": []
          }
        ],
        "parses": [],
        "headers": [],
        "tvboxDesktop": {
          "accent": null,
          "density": null,
          "home": {
            "sections": [
              {
                "title": "电影 · 最近更新",
                "site": "dyttzy",
                "type_id": null
              },
              {
                "title": "电影 · 动作片",
                "site": "ffzy",
                "type_id": 6
              },
              {
                "title": "电视剧 · 国产剧",
                "site": "lzi",
                "type_id": 13
              },
              {
                "title": "动漫 · 日本",
                "site": "guangsu",
                "type_id": 42
              },
              {
                "title": "综艺 · 最近更新",
                "site": "subo",
                "type_id": null
              }
            ]
          }
        },
        "spider": null,
        "wallpaper": null,
        "warningText": null
      }
    }
  ]
}

```
站点类型对照（与原项目 README 一致）：

| type | 含义 | 桌面端 |
| --- | --- | --- |
| `3` / `"cms"` | 苹果CMS（api 可写基地址或 `{ac}{wd}{pg}{t}{ids}` 占位符模板） | ✅ 搜索 + 分类浏览 |
| `1` / `"html"` | 网页规则站（rules 里 CSS 选择器） | ✅ 仅搜索 |
| `4` / `"api"` | CMS 变体 | ✅ 搜索 + 分类浏览 |
| `0` / `"spider"`（含 `csp_` 开头） | 需要配套 jar/dex | ❌ 灰显并说明 |
| 其它 | 未知 | ❌ 灰显并说明 |

## 外部播放器

详情页「用外部播放器打开」/ 直播页「外部播放」/ 嗅探结果里的「外部播放」按钮，会把当前直链交给本机播放器：

1. 设置页可手动指定播放器程序路径（Windows 下常指 PotPlayer 的 `PotPlayerMini64.exe`）；
2. 未指定时按常见安装位置自动探测：PotPlayer → VLC → mpv（macOS 为 IINA → mpv → VLC，Linux 为 mpv → VLC → Celluloid → SMPlayer）；
3. 全部未命中时返回明确错误，提示到设置页指定路径。适合内网/需要硬解的场景，播放行为与进度记忆均由外部播放器接管。

## 嗅探功能说明（Tauri 下的已知限制）

Electron 通过 `webContents` 可以完整拦截网络请求；Tauri 2 没有等价的 webview 网络层 API，本版本采用**双通道简易嗅探**：

1. **HTML 直取（主通道，稳定）**：Rust reqwest 抓取网页源码，正则提取 m3u8/mp4/flv 直链，并追踪一层 iframe。大多数采集站的播放页源码里直接包含直链，命中率较高。
2. **Webview hook（增强通道）**：创建独立嗅探窗口并注入 `initialization_script`，hook `fetch` / `XMLHttpRequest` / `HTMLMediaElement.src`，捕获到直链后以 `sniff://found?u=...` 触发导航，Rust 端 `on_navigation` 拦截并通过事件回传主窗口。该通道依赖系统 WebView 行为（WebView2 / WKWebView / webkit2gtk 兼容性差异需真机验证），失败时主通道仍可用。

已知差距（v2 方向）：部分站点直链由 JS 动态计算且依赖 Referer/UA 校验，简易嗅探可能拿不到可用地址；后续可扩展 wry 自定义协议层拦截。

## 与原版的行为差异

1. **聚合搜索**：原版 Electron 在 renderer 里并发，本版本移到 Rust（`buffer_unordered(6)`），进度通过 `search:progress` 事件回传。
2. **进度存储**：原版可能存 Electron userData；本版本统一存 Tauri `app_data_dir`（Windows: `%APPDATA%/com.tvbox.desktop`，macOS: `~/Library/Application Support/com.tvbox.desktop`，Linux: `~/.config/com.tvbox.desktop`），**首次运行不迁移原版数据**。
3. **直播 txt 分隔符**：支持 `,` 后 `#` `|` `$` 分隔多线路，与常见直播源格式兼容。
4. **XML CMS**（`at=xml`）暂不支持，主流采集站均为 JSON。

## Roadmap

- [x] 外部播放器一键切换（Rust `std::process` 拉起，自动探测 + 手动指定）
- [ ] 直播频道收藏
- [ ] 配置定时自动刷新
- [ ] wry 自定义协议层嗅探（替代简易正则）
- [ ] 原版 Electron 数据迁移工具
# 免责声明
- 本项目只是一个播放器壳，不含任何影视内容，也不提供、不托管、不存储任何视频资源。
- 所有内容都来自使用者自己添加的第三方配置订阅。软件按订阅里写的地址去请求，就像浏览器按你输入的网址去访问一样。
- 内置的「公开可用源」是一份实测存活的公开采集接口清单，仅作为上手示例。这些站点随时可能失效或变更，项目的维护者不对其可用性、合法性、内容负责。
- 请仅将本项目用于学习 Tauri 2/Rust/React 18/TypeScript 的桌面开发，并遵守你所在地区的法律法规。请通过官方渠道观看正版内容。
- 因使用本项目产生的任何后果，由使用者自行承担。
- 严禁传播黄赌毒相关视频内容，违者请举报。
- 所有以任何方式查看本仓库内容的人、或直接或间接使用本仓库内容的使用者都应仔细阅读此声明。本仓库管理者保留随时更改或补充此免责声明的权利。一旦使用、复制、修改了本仓库内容，则视为您已接受此免责声明。
- 本仓库管理者不能保证本仓库内容的合法性、准确性、完整性和有效性，请根据情况自行判断。本仓库内容，仅用于测试和学习研究，禁止用于商业用途，不得将其用于违反国家、地区、组织等的法律法规或相关规定的其他用途，禁止任何公众号、自媒体进行任何形式的转载、发布，请不要在中华人民共和国境内使用本仓库内容，否则后果自负。
- 本仓库内容中涉及的第三方硬件、软件等，与本仓库内容没有任何直接或间接的关系。本仓库内容仅对部署和使用过程进行客观描述，不代表支持使用任何第三方硬件、软件。使用任何第三方硬件、软件，所造成的一切后果由使用的个人或组织承担，与本仓库内容无关。
- 所有直接或间接使用本仓库内容的个人和组织，应 24 小时内完成学习和研究，并及时删除本仓库内容。如对本仓库内容的功能有需求，应自行开发相关功能。所有基于本仓库内容的源代码，进行的任何修改，为其他个人或组织的自发行为，与本仓库内容没有任何直接或间接的关系，所造成的一切后果亦与本仓库内容和本仓库管理者无关。
