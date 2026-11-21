# AGENTS.md

面向贡献者与 AI 编程代理的项目背景、架构说明与开发约束。

## 1. 项目背景

`mygo-music-spotify-soloist` 是桌面音乐播放器 [MyGo Music](https://github.com/egoist/mygo-music) 的第三方 Spotify 插件（MIT 许可，当前面向 Windows x64）。

### 为什么需要本插件
- 传统开源 Spotify 播放客户端多依赖逆向协议库 `librespot`，近年来受 Spotify 协议持续变动与 [librespot-org/librespot#1649](https://github.com/librespot-org/librespot/issues/1649) 影响，频繁出现登录失败或断流。
- 本插件采用 **双通道官方方案**：
  - **曲库与元数据**：通过 **Spotify Web API**（OAuth 2.0 PKCE，无需 Client Secret）浏览首页、搜索、歌单、专辑、歌手与收藏。
  - **音频拉取、解码与输出**：由 Spotify 官方独立播放核心 **[Soloist](https://developer.spotify.com/documentation/soloist)**（本地 `bin/soloist.exe`）完成，原声无二次转码，不替代音源。
- **双凭据隔离**：Web API 使用用户自建 Spotify App 的 `Client ID`；Soloist 使用独立的 `Soloist API Key`（通过 Windows DPAPI 加密存储在 `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml`）。本仓库不分发 Soloist 二进制文件，也不包含任何凭据。

---

## 2. 运行时与平台约束

修改代码前必须遵守以下硬性约束：

1. **非 Node.js 沙盒运行时**：`index.js` 运行在 MyGo Music 内置的 `moejs` JS 运行时，仅提供标准 ES 语法、定时器、`fetch` 和宿主全局对象 `host`（`host.setting`、`host.storage`、`host.spawn`、`host.t`、`host.dir`、`host.platform`、`host.openURL`、`host.waitForRedirect`、`host.signInPrompt`）。**严禁**依赖 Node.js 内置模块（`fs`、`crypto`、`Buffer`、`http`、`require` 等）。
2. **网络白名单**：所有外部 `fetch` 域名必须在 `plugin.json` 的 `permissions.network` 中显式声明（授予 `process` 权限后宿主额外放行 `127.0.0.1`/`localhost`）。
3. **子进程权限与托管**：`host.spawn` 只能调用 `plugin.json` 的 `permissions.process` 允许的程序（`bin/soloist.exe`、`powershell.exe`），且需要用户在 MyGo 设置中显式授权。插件禁用、撤权或 MyGo 退出时，宿主会自动 `killPrograms()` 回收所有子进程。
4. **插件生命周期**：MyGo 启动扫描只编译 `index.js` 不执行代码；当 Spotify Soloist 成为当前激活来源时才创建 VM、执行模块顶层代码并调用导出函数。
5. **Spotify Development Mode 限制**：部分接口有更严格上限（例如 `/artists/{id}/albums` 与 `/search` 的 `limit` 必须 `<= 10`）；非自建/非协作歌单与官方推荐接口可能不可用。
6. **Soloist 预览版特性**：当前仅支持 Windows x64；官方构建自构建日起 **90 天过期**（进程退出码 `10`）；音频播放和 Web API 播控需要 Spotify Premium 账号。

---

## 3. 仓库结构

| 路径 | 职责 |
| :--- | :--- |
| `plugin.json` | 插件清单：ID、入口、远程播放模式（`"playback": "remote"`）、网络与进程权限、设置项与侧边栏导航 |
| `index.js` | 插件完整核心逻辑（单文件 ESM），导出 MyGo `music.Source` 约定的所有方法 |
| `scripts/soloist-host.ps1` | Windows 本地辅助脚本：`setup`（DPAPI 加密保存 API Key）、`config`（解密输出配置）、`pkce`（生成 PKCE 随机串与 S256 challenge） |
| `locales/zh-CN.json` | 简体中文文案映射表，对应 `plugin.json` 与 `index.js` 中所有 `host.t(...)` / `problem(...)` 文本 |
| `tests/plugin.test.cjs` | 零依赖 Node.js 回归测试，通过 `node:vm` 模拟宿主环境测试核心逻辑 |
| `bin/.gitkeep` | 占位文件，提示用户将自行下载的 `soloist.exe` 放入 `bin/`（`.gitignore` 已忽略二进制） |
| `README.md` / `README.en.md` | 中/英文用户安装、配置与排错文档 |

---

## 4. 系统架构与核心数据流

```text
+-------------------------------------------------------------------+
|                        MyGo Music Desktop                         |
|  UI / Queue / Source Manager / moejs Sandbox (plugin runtime)     |
+-------------------------------+-----------------------------------+
                                | 导出函数调用 & host.* API
                                v
+-------------------------------------------------------------------+
|                             index.js                              |
|  1. Auth & Spotify API   : OAuth PKCE, 单飞 Token 刷新, 统一重试  |
|  2. Catalog Endpoints    : home/search/playlist/album/artist/like |
|  3. Bilingual Lyrics     : LRCLIB + 网易云 + QQ 音乐并发择优缓存  |
|  4. Soloist Controller   : 挂载预热, 守护进程管理, 事件状态机,     |
|                            串行队列与代际抢占                      |
+--------+--------------------+--------------------+----------------+
         |                    |                    |
         | HTTPS              | HTTPS              | host.spawn
         v                    v                    v
+-----------------+  +------------------+  +------------------------+
| Spotify Web API |  | Lyrics Providers |  | Windows Child Process  |
| api.spotify.com |  | - lrclib.net     |  | - soloist-host.ps1     |
| accounts.       |  | - music.163.com  |  |   (DPAPI / PKCE)       |
|   spotify.com   |  | - c.y.qq.com     |  | - bin/soloist.exe      |
|                 |  | - u.y.qq.com     |  |   (daemon + ctl trace) |
+-----------------+  +------------------+  +------------------------+
```

### 关键模块设计

1. **认证与 API 封装（`index.js` 顶部）**
   - `signIn()` 借助 `soloist-host.ps1 -Action pkce` 与 `host.waitForRedirect` 在 `127.0.0.1:43110/callback` 完成授权码交换。
   - `access()` 使用模块级 `refreshing` Promise 合并并发的 Token 刷新请求；`api()` 遇到 `401` 自动强制刷新并重试一次，遇到 `429` 或超时返回用户可读错误。
   - 使用 `problem(code, message)` 附带标准错误码（`setup` / `signIn`）供 MyGo UI 弹出对应引导。

2. **曲库接口（Catalog Endpoints）**
   - 统一通过 `track()` / `albumMap()` / `artistMap()` / `playlistMap()` 映射为 MyGo 数据结构。
   - `artist()` 遵循 Development Mode 限制（`/artists/{id}/albums` 使用 `limit: 10`，遇到 `400` 时去掉 `include_groups` 重试），搜索艺人曲目时剥离引号并分页去重；`followArtist()` 与 `artist.following` 查询对旧 Token 缺少 `user-follow-*` 权限时的 `403` 自动降级。

3. **三源并发双语歌词（Synchronized Bilingual Lyrics）**
   - `lyrics()` 通过 `Promise.allSettled` 并发查询三路数据源：
     - **LRCLIB**：先 `/api/get` 精确查询，未命中同步歌词时回退 `/api/search`；
     - **网易云音乐**：`cloudsearch/pc` 搜索 + `song/lyric` 拉取 `lrc` 与 `tlyric`；
     - **QQ 音乐**：`c.y.qq.com` `client_search_cp` 搜索 + `u.y.qq.com` `PlayLyricInfo` 拉取 Base64 原文与翻译。
   - 沙盒内零依赖实现 `decodeBase64Utf8()` 与 `decodeHtmlEntities()`，通过 `cleanQqTranslation()` 清洗 QQ 翻译中的 `[kana:...]` 与 `[mm:ss.xx]//` 占位行。
   - `pickBestSong()` 基于清洗后的歌名、±3 秒时长容差、歌手匹配度及版本标签惩罚（`Live`/`Remix`/`伴奏`/`翻唱`）打分选曲。
   - `pickBestLyrics()` 优先返回**双语同步歌词**（网易云 → QQ 音乐），无翻译时按 LRCLIB → 网易云 → QQ 音乐回退，结果写入上限 100 首的内存缓存 `lyricsCache`。

4. **Soloist 生命周期、挂载预热与播放状态机**
   - **挂载预热**：模块顶层通过 `setTimeout(warmupSoloist, 0)` 在事件循环首个宏任务静默触发 `ensureSoloist()`（登录后 `signIn()` 也会补触发一次）。仅拉起守护进程与状态监听，**不执行 `activate`**，避免抢占用户在其他设备的播放焦点；未配置 Key 或未授权时静默吞错，不影响后续显式重试。
   - **单飞启动锁**：`ensureSoloist()` 通过 `startPromise` 保证预热与并发播放请求共享同一次启动，不会重复拉起 `soloist.exe`。
   - **事件驱动状态机**：通过 `soloist.exe ctl trace` 持续消费 JSON 事件流（`auth_state`、`playback_state`、`track_changed`、`playback_changed`、`position_sync`、`volume_changed`、`device_changed`），`positionNow()` 基于本地时钟锚点 `anchoredAt` 插值计算进度，避免依赖守护进程挂钟或高频轮询云端。
   - **队列串行化与代际抢占**：`remotePlay()` 通过 `queueJob` 串行执行、通过 `playGeneration` 递增实现“后点覆盖前点”，`remotePause()` 也会递增代际以取消尚未落地的切歌请求。

---

## 5. 开发、测试与修改规范

### 验证命令
```bash
node --check index.js
node --test tests/plugin.test.cjs
```
当前单测覆盖：本地进度插值与事件状态机、队列代际抢占与暂停取消、艺人页分页与权限降级、歌词解码清洗与候选打分、三源并发与缓存、挂载后台预热与并发去重。

### 修改检查清单
- **保持单测锚点**：`tests/plugin.test.cjs` 通过字符串定位从 `index.js` 切片在 `node:vm` 中执行（依赖 `const image = items =>`、`export async function liked(`、`const LYRIC_TIMEOUT =`、`// The desktop app owns these child processes`、`const EXE = "bin/soloist.exe";`、`function onEvent(`、`async function watch(`、`async function ready()`、`let queueJob = Promise.resolve();`、`export async function remoteResume()`、`// Start Soloist in the background`）。调整结构时同步确认测试通过。
- **权限同步**：新增外部域名必须更新 `plugin.json` 的 `permissions.network`，并同步更新 `README.md` / `README.en.md` 的隐私说明。
- **国际化同步**：新增或修改任何 `t("...")`、`problem(..., "...")` 或 `plugin.json` 面向用户的英文字符串时，必须同步维护 `locales/zh-CN.json`。
- **凭据安全**：绝不在日志、错误信息或测试输出中打印 Soloist API Key、`access_token`、`refresh_token` 或带凭据的命令行参数。
