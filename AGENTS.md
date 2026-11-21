# AGENTS.md

面向贡献者与 AI 编程代理的项目背景、架构说明与开发约束。

## 1. 项目背景

`mygo-music-spotify-soloist` 是桌面音乐播放器 [MyGo Music](https://github.com/egoist/mygo-music) 的第三方 Spotify 插件（MIT 许可，支持 **Windows x64** 与 **Apple Silicon macOS**）。

### 为什么需要本插件
- 传统开源 Spotify 播放客户端多依赖逆向协议库 `librespot`，近年来受 Spotify 协议持续变动与 [librespot-org/librespot#1649](https://github.com/librespot-org/librespot/issues/1649) 影响，频繁出现登录失败或断流。
- 本插件采用 **双通道官方方案**：
  - **曲库与元数据**：通过 **Spotify Web API**（OAuth 2.0 PKCE，无需 Client Secret）浏览首页、搜索、歌单、专辑、歌手与收藏。
  - **音频拉取、解码与输出**：由 Spotify 官方独立播放核心 **[Soloist](https://developer.spotify.com/documentation/soloist)**（本地 `bin/soloist.exe`）完成，原声无二次转码，不替代音源。
- **双凭据隔离**：Web API 使用用户自建 Spotify App 的 `Client ID`；Soloist 使用独立的 `Soloist API Key`（可直接在 MyGo 插件设置密码框中填写，也可通过 Windows DPAPI 脚本加密存储在 `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml`，前者优先且无需启动 PowerShell）。本仓库不分发 Soloist 二进制文件，也不包含任何凭据。

---

## 2. 运行时与平台约束

修改代码前必须遵守以下硬性约束：

1. **非 Node.js 沙盒运行时**：`index.js` 运行在 MyGo Music 内置的 `moejs` JS 运行时，仅提供标准 ES 语法、定时器、`fetch` 和宿主全局对象 `host`（`host.setting`、`host.storage`、`host.spawn`、`host.t`、`host.dir`、`host.platform`、`host.openURL`、`host.waitForRedirect`、`host.signInPrompt`）。**严禁**依赖 Node.js 内置模块（`fs`、`crypto`、`Buffer`、`http`、`require` 等）。
2. **网络白名单**：所有外部 `fetch` 域名必须在 `plugin.json` 的 `permissions.network` 中显式声明（授予 `process` 权限后宿主额外放行 `127.0.0.1`/`localhost`）。
3. **子进程权限与托管**：`host.spawn` 只能调用 `plugin.json` 的 `permissions.process` 允许的程序（`bin/soloist.exe`、`bin/soloist`、`powershell.exe`、`/bin/sh`），且需要用户在 MyGo 设置中显式授权。插件禁用、撤权或 MyGo 退出时，宿主会自动 `killPrograms()` 回收所有子进程。
4. **插件生命周期**：MyGo 启动扫描只编译 `index.js` 不执行代码；当 Spotify Soloist 成为当前激活来源时才创建 VM、执行模块顶层代码并调用导出函数。
5. **Spotify Development Mode 限制**：部分接口有更严格上限（例如 `/artists/{id}/albums` 与 `/search` 的 `limit` 必须 `<= 10`）；非自建/非协作歌单与官方推荐接口可能不可用。
6. **Soloist 预览版特性**：当前支持 Windows x64 与 Apple Silicon（arm64，macOS 13+）macOS（官方暂未提供 Intel Mac 构建）；官方构建自构建日起 **90 天过期**（进程退出码 `10`）；音频播放和 Web API 播控需要 Spotify Premium 账号。

---

## 3. 仓库结构

| 路径 | 职责 |
| :--- | :--- |
| `plugin.json` | 插件清单：ID、入口、远程播放模式（`"playback": "remote"`）、网络与进程权限、设置项与侧边栏导航 |
| `index.js` | 插件完整核心逻辑（单文件 ESM），导出 MyGo `music.Source` 约定的所有方法 |
| `scripts/soloist-host.ps1` | Windows 辅助脚本：`stage`/`install`（从 Spotify 官方 CDN 安全下载、MD5 与 `--version` 校验并原子安装/更新 `bin/soloist.exe`），以及可选的 DPAPI `setup`/`config`（本地加密读写 API Key） |
| `scripts/soloist-host.sh` | macOS Apple Silicon 辅助脚本（纯 POSIX sh，零第三方依赖、强制 LF 行尾）：`stage`/`install`（从官方 CDN 下载 `soloist_release_osx_arm64.tar.gz`、MD5 与 `--version` 校验、清除 quarantine 并原子安装/更新 `bin/soloist`），以及可选的 macOS Keychain `setup`/`config` |
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
   - `createPkce()` 采用**纯 JS 实现 RFC 7636 PKCE + FIPS 180-4 SHA-256**（优先 `crypto.getRandomValues`，无 Web Crypto 时使用哈希白化熵回退），登录完全不依赖子进程；`signIn()` 配合 `host.waitForRedirect` 在 `127.0.0.1:43110/callback` 完成授权码交换。
   - `access()` 使用 `authGeneration` 代际隔离与单飞 `refreshing` 合并并发 Token 刷新，确保退出登录或更换 `Client ID` 后，进行中的旧刷新不会把旧凭据写回 `host.storage`；`api()` 自动处理 `401` 刷新重试、`403 PREMIUM_REQUIRED`、`429` 限流与请求超时。
   - `spawnProcess()` 统一拦截并分类进程启动异常（未授权进程权限、缺少 `bin/soloist.exe`、通用启动失败），均通过 `problem(code, message)` 返回带 `setup`/`signIn` 错误码的本地化提示。

2. **曲库与歌单编辑接口（Catalog Endpoints）**
   - 统一通过 `track()` / `albumMap()` / `artistMap()` / `playlistMap()` 映射为 MyGo 数据结构，并通过 `inLibrary(uri)` 容错查询 `/me/library/contains`，确保专辑详情 `saved`、歌单详情 `saved` 与艺人 `following` 状态准确（且搜索出的陌生歌单不会误标 `saved: true`）。
   - 完整实现歌单与资料库交互：`createPlaylist`（`POST /me/playlists`）、`renamePlaylist`（`PUT /playlists/{id}`）、`deletePlaylist` / `savePlaylist`（`/me/library`）、`addToPlaylist` / `removeFromPlaylist`（`/playlists/{id}/items`，按 100 首分批）、`movePlaylistTrack`（将 MyGo 目标索引转换为 Spotify `insert_before = from < to ? to + 1 : to`）。
   - `artist()` 遵循 Development Mode 限制（`/artists/{id}/albums` 使用 `limit: 10`，遇到 `400` 时去掉 `include_groups` 重试），搜索艺人曲目时剥离引号并分页去重。

3. **三源并发双语歌词（Synchronized Bilingual Lyrics）**
   - `lyrics()` 通过 `Promise.allSettled` 并发查询三路数据源：
     - **LRCLIB**：先 `/api/get` 精确查询，未命中同步歌词时回退 `/api/search`；
     - **网易云音乐**：`cloudsearch/pc` 搜索 + `song/lyric` 拉取 `lrc` 与 `tlyric`；
     - **QQ 音乐**：`c.y.qq.com` `client_search_cp` 搜索 + `u.y.qq.com` `PlayLyricInfo` 拉取 Base64 原文与翻译。
   - 沙盒内零依赖实现 `decodeBase64Utf8()` 与 `decodeHtmlEntities()`，通过 `cleanQqTranslation()` 清洗 QQ 翻译中的 `[kana:...]` 与 `[mm:ss.xx]//` 占位行。
   - `pickBestSong()` 基于清洗后的歌名、±3 秒时长容差、歌手匹配度及版本标签惩罚（`Live`/`Remix`/`伴奏`/`翻唱`）打分选曲。
   - `pickBestLyrics()` 优先返回**双语同步歌词**（网易云 → QQ 音乐），无翻译时按 LRCLIB → 网易云 → QQ 音乐回退，结果写入上限 100 首的内存缓存 `lyricsCache`。插件设置提供 `disableLrclibLyrics` / `disableNeteaseLyrics` / `disableQqLyrics` 三个独立开关，禁用的源不发起网络请求，切换开关时 `setSetting()` 立即清空 `lyricsCache`。

4. **Soloist 生命周期、自动下载更新与高可靠播放状态机**
   - **自动下载与静默更新**：`ensureSoloist()` 在检测到缺少 `bin/soloist.exe`（`missingBinary`）或 90 天过期（退出码 `10`）时通过 `scripts/soloist-host.ps1 -Action install` 自动从固定官方 CDN（`soloist-builds.spotifycdn.com`）下载、校验 MD5 与 `--version` 签名并原子安装；`checkForSoloistUpdate()` 每 24 小时（距过期 ≤14 天时积极检查）通过纯 JS `HEAD` 比对 `ETag`/`Last-Modified`，播放中仅后台 `stage` 到 `%LOCALAPPDATA%\MyGoSoloist\staging` 不中断听歌，空闲或下次冷启动时瞬间替换；「播放状态」页展示当前引擎版本与剩余有效天数。
   - **API Key 双源解析与热切换**：`resolveConfig()` 优先读取插件设置中的 `soloistApiKey`（零 PowerShell 开销，且不覆写 `-D`/`-C`，直接沿用 Soloist 官方默认目录 `%LOCALAPPDATA%\soloist\{data,cache}`），留空时自动回退到 `soloist-host.ps1 -Action config`（同样指向 `%LOCALAPPDATA%\soloist\{data,cache}`），两种方式完全共享配对凭证与缓存。修改 `soloistApiKey` 时 `setSetting()` 调用 `stopSoloist()` 递增 `startGeneration`、安全回收旧 `watcher`/`daemon` 并立即以新 Key 后台预热。
   - **挂载预热、单飞启动与断线自愈**：模块顶层通过 `setTimeout(warmupSoloist, 0)` 静默触发 `ensureSoloist()` 并在成功后执行 `checkForSoloistUpdate()`，不执行 `activate`；`watch()` 断线时采用退避自动重连并按 `watcher === p` 隔离旧追踪器，启动/探活失败自动回收所属子进程。
   - **全量串行播控与状态一致**：所有写操作（`remotePlay` / `remotePause` / `remoteResume` / `remoteSeek` / `remoteVolume` / `remoteUse`）共享串行队列 `enqueue()` 与代际/会话校验；`playTarget()` 解耦起播确认与进度恢复（定位失败保留播放并记录诊断），对超时或延迟起播进行快照核对与保护，并基于完整快照与 `context.uri` 准确拦截 Spotify Autoplay 续播交由 MyGo 推进队列，同时保留手机端主动接管识别。

---

## 5. 开发、测试与修改规范

### 验证命令
```bash
node --check index.js
node --test tests/plugin.test.cjs
```
当前 45 项单测覆盖：Windows 与 Apple Silicon macOS 双平台适配与不支持架构拦截、本地进度插值与事件状态机、冷启动恢复进度解耦、超时核对与延迟起播抑制、全量播控串行化与代际抢占、Autoplay 拦截与手机接管区分、`trace` 断线重连、Soloist 自动下载/静默更新与 90 天过期自愈、按源禁用歌词与缓存失效、艺人页分页与权限降级、歌单 CRUD/分批增删/排序索引换算与资料库收藏状态、歌词解码清洗与候选打分、挂载后台预热与并发去重、纯 JS PKCE（RFC 7636/NIST 向量）、API Key UI 直填与热切换隔离、`spawnProcess` 错误分类以及 `signOut` 刷新代际隔离。

### 修改检查清单
- **保持单测锚点**：`tests/plugin.test.cjs` 通过字符串定位从 `index.js` 切片在 `node:vm` 中执行（依赖 `const image = items =>`、`export async function liked(`、`const LYRIC_TIMEOUT =`、`// The desktop app owns these child processes`、`const EXE =`、`function onEvent(`、`async function watch(`、`async function ready()`、`let queueJob = Promise.resolve();`、`export async function remoteResume()`、`// Start Soloist in the background`）。调整结构时同步确认测试通过。
- **权限同步**：新增外部域名必须更新 `plugin.json` 的 `permissions.network`，并同步更新 `README.md` / `README.en.md` 的隐私说明。
- **国际化同步**：新增或修改任何 `t("...")`、`problem(..., "...")` 或 `plugin.json` 面向用户的英文字符串时，必须同步维护 `locales/zh-CN.json`。
- **凭据安全**：绝不在日志、错误信息或测试输出中打印 Soloist API Key、`access_token`、`refresh_token` 或带凭据的命令行参数。
