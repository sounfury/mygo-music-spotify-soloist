# MyGo Music 的 Spotify Soloist 插件

简体中文 · [English](README.en.md)

让 [MyGo Music](https://github.com/egoist/mygo-music) 使用 Spotify 官方 [Soloist](https://developer.spotify.com/documentation/soloist) 播放核心在后台直接播放音乐。由 Spotify Web API 提供曲库与元数据，Soloist 负责原声音频拉取、解码与输出；不依赖 librespot，无需匹配 YouTube 替代音源，亦无二次转码损耗。

> **💡 背景与适用人群**  
> 本插件专为受 [librespot-org/librespot#1649](https://github.com/librespot-org/librespot/issues/1649) 及 Spotify 协议持续变动影响、**无法正常使用 librespot** 的用户打造。借助 Spotify 官方推出的 Soloist 独立播放引擎，彻底告别逆向协议频繁失效、音源失效或掉线等问题，即刻恢复稳定原生的 Spotify 播放体验。

**注意：Soloist 官方目前仅提供 Windows x64 预览版构建（自构建日起 90 天有效）。配置 Soloist 播放器与使用 Spotify 音频播放均需拥有 Spotify Premium（高级会员）账号。**

## 核心优势与功能特性

- **⚡ 秒级起播，告别云端轮询卡顿**：点播直接走 Soloist 本地 WebSocket 通道触发，彻底绕开 Spotify 云端设备发现与云端播控接口的高延迟；支持连点切歌时的**代际抢占**（后点立刻覆盖前点），响应干脆利落。
- **🎵 官方原生音质，告别 librespot 失效**：音频直接由 Spotify 官方 Soloist 引擎拉取与解码输出，纯净无二次转码、不替代音源，不受逆向协议变动与断流困扰。
- **🚀 挂载静默预热 & 零脚本极简配置**：切换至本插件时即在后台静默拉起 Soloist 并恢复配对（无终端黑框、不抢占其他设备焦点），首播几乎零等待；支持在 MyGo 设置中直接填写 Soloist API Key 并热切换生效，OAuth PKCE 纯 JS 在沙盒内完成，日常零 PowerShell 开销。
- **🛡️ 高可靠状态机与无缝队列接管**：
  - 播放、暂停、恢复、拖动进度、音量调节与设备激活统一串行队列，杜绝并发竞态；
  - 重启 MyGo 恢复上次播放进度时解耦起播与定位，避免冷启动时因定位未就绪误报播放失败；
  - 自动拦截 Soloist 单曲播完后的 Spotify Autoplay 随机续播，将下一首切歌权完整交还给 MyGo（随机、单曲循环、列表循环、跨音源队列与手机端主动接管均准确区分）；
  - 本地 `trace` 事件流支持断线退避重连，超时命令二次核对真实状态，防止状态撕裂或“幽灵播放”。
- **📚 完整曲库与歌单管理**：支持首页个性化推荐、全局搜索（单曲 / 专辑 / 艺人 / 歌单）、个人歌单、已点赞歌曲及收藏专辑；支持新建/重命名/删除/收藏歌单、向歌单批量增删歌曲与排序移动。
- **🌐 丰富详情与可开关的三源双语同步歌词**：支持专辑和艺人主页（含关注/取消关注歌手），默认并发检索 **LRCLIB + 网易云音乐 + QQ 音乐** 同步歌词（优先匹配原词 + 中文翻译并内置缓存），并可在插件设置中通过 3 个独立开关按需单独禁用任意歌词源。
- **🔄 自动下载与无感更新 Soloist**：仓库不分发二进制文件，但插件首次检测到缺少 `bin/soloist.exe`（或 MyGo 更新插件覆盖了目录、或官方 90 天构建到期）时，会直接从 Spotify 官方 CDN 自动下载、校验 MD5 与版本签名并原子安装到 `bin/soloist.exe`；后台每 24 小时静默检查新构建，播放中仅暂存绝不打断，空闲或重启后毫秒级切换。
- **🔍 持久化诊断面板**：侧边栏内置「播放状态」页面，完整展示配对状态、当前 `soloist.exe` 版本/剩余有效期以及最近一次播控诊断（含动作、原因与退出码），排错一目了然。

## 安装与配置

在 MyGo Music 中打开 **设置 → 插件 → ＋**，输入仓库地址：

```text
sounfury/mygo-music-spotify-soloist
```

[通过 MyGo Music 一键安装](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)

> **说明**：本仓库仅分发插件源代码，不包含任何二进制文件；但**授予进程权限后，插件会自动从 Spotify 官方 CDN 下载并维护 `bin/soloist.exe`**，无需手工解压放置（离线或特殊网络环境下亦可手动放置）。

---

### 1. Soloist 官方程序（自动下载，亦支持手动放置）

- **自动方式（默认）**：完成下方第 2～3 步并勾选允许插件启动程序后，切换到 Spotify Soloist 来源时插件会自动从 [Spotify 官方下载源](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) 拉取最新的 `soloist_release_windows_x86_64.zip`，校验完整性与版本签名后自动安装到插件目录的 `bin\soloist.exe`；后续也会在后台静默检查并无感更新（不中断播放）。
- **手动方式（可选/离线兜底）**：若网络无法直连 Spotify CDN，也可手动从官方页面下载 **x86_64 Windows** 压缩包，解压出 `soloist.exe` 放入：

  ```text
  %APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe
  ```

---

### 2. 配置 Soloist API Key

1. 登录 [Spotify Soloist 控制台](https://developer.spotify.com/dashboard/soloist) 获取你的专属 API Key。（注意：**该 API Key 与下一步配置的 Web API Client ID 为两份相互独立的凭据**）。
2. **推荐方式（直接在 MyGo 设置中填写）**：在 MyGo Music 的 **设置 → 插件 → Spotify Soloist** 中找到 **Soloist API Key** 密码框，直接粘贴保存即可；修改后插件会自动使用新 Key 重启 Soloist，无需运行脚本或手动重启插件。
3. **可选方式（Windows DPAPI 本地加密脚本）**：若你希望使用 Windows DPAPI 单独加密落盘，可将设置里的 **Soloist API Key** 留空，在 PowerShell 中运行以下命令：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
   ```

   在弹出的隐藏输入提示中粘贴你的 Key 并按下回车（自定义插件目录请相应调整路径）。**请切勿将 Key 分享给他人或直接粘贴在公开 Issue 中**。

---

### 3. 授权 Spotify 音乐库

1. 访问 [Spotify 开发者后台](https://developer.spotify.com/dashboard) 创建或使用已有的应用。
2. 在应用设置中启用 Web API，并添加以下重定向回调地址（Redirect URI）：

   ```text
   http://127.0.0.1:43110/callback
   ```

3. 在 MyGo Music 的 **设置 → 插件 → Spotify Soloist** 中填入该应用的 **Client ID**，勾选允许插件启动程序，随后点击 **登录**。
4. 系统将在默认浏览器中打开授权页面，点击同意即可完成绑定。若应用处于 Development Mode（开发模式），请确认已在应用的 **User Management** 中将当前使用的 Spotify 账号添加为测试用户。

*注：本插件无需配置 Client Secret。如需更换 Client ID，修改后重新点击登录即可。*

---

### 4. 首次配对，之后在 MyGo 中随心播放

1. 将 MyGo Music 的音乐来源切换为 **Spotify Soloist**，插件挂载后会在后台自动静默预热拉起 Soloist 播放引擎（你也可以直接点击歌曲或打开 **播放状态** 页面查看当前连接状态）。
2. **首次使用配对**：请确保手机与电脑处于同一局域网下，打开手机端官方 Spotify App，在「可用设备」列表中点选 **MyGo Soloist**。配对成功后 Soloist 会在本地保存凭证，后续启动均会自动恢复连接。此后即可直接在 MyGo 中进行完整播放控制，无需常驻 Spotify 官方桌面客户端。
3. **进程生命周期**：由插件启动的 Soloist 进程为静默运行；退出 MyGo 或卸载插件时会自动结束相关子进程。若你在启动 MyGo 前已手动运行了带有本地 API 的 Soloist 实例，插件亦可直接附着连接，且不会在退出时强制结束该手动进程。

## 数据与权限说明

| 数据类型 | 本地存储路径 |
| --- | --- |
| Spotify Web API 令牌及插件设置（含界面填写的 Key） | MyGo 目录下的 `plugin-data/spotify-soloist` |
| Soloist 配对凭证与原声音频缓存（两种 Key 模式共用） | `%LOCALAPPDATA%\soloist\{data,cache}` |
| Soloist 自动更新暂存目录 | `%LOCALAPPDATA%\MyGoSoloist\staging` |
| 加密的 Soloist Key（仅可选 DPAPI 脚本模式） | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` |

- **多进程互斥**：同一数据目录在同一时间仅支持一个 Soloist 进程访问；只要保留默认路径的数据，已有的配对即可持续复用。在插件中退出 Web API 账号不会影响已建立的 Soloist 设备配对。
- **安全提示**：虽然本地落盘的 Key 已通过 Windows DPAPI 加密，但受限于 Soloist 当前机制，启动时仍需以命令行参数方式传给进程，因而本地进程监视器可能窥见该参数。请避免公开完整的进程命令行、未脱敏日志或会话目录。Spotify Web API 的访问令牌则安全存储于 MyGo 插件本地存储中。本仓库不包含任何私有 Key 或令牌。
- **系统调用与网络说明**：OAuth PKCE 鉴权由纯 JS 在沙盒内完成，登录曲库无需启动外部进程。播放音频时调用 `bin/soloist.exe`；仅在自动下载/更新官方 `soloist.exe`（从固定官方地址 `soloist-builds.spotifycdn.com` 拉取并校验 MD5 与 `--version` 签名），或未于插件设置填写 Soloist API Key 而回退读取可选 DPAPI 脚本时才会调用 `powershell.exe`。日常更新检测仅通过纯 JS 向 `soloist-builds.spotifycdn.com` 发送轻量 `HEAD` 请求。Soloist 本地控制端口仅监听 `127.0.0.1` 环回地址并采用动态随机端口。检索双语同步歌词时，会向 LRCLIB（`lrclib.net`）、网易云音乐（`music.163.com`）与 QQ 音乐（`c.y.qq.com`、`u.y.qq.com`）发送曲名、艺术家、专辑与时长等公开元数据。

## 已知限制与更新维护

- **平台支持**：当前仅支持 Windows x64 系统；暂未实现播客播放。
- **开发模式限制**：受 Spotify 开发者开发模式规则制约，部分非本人创建/非协作歌单可能无法读取，且 Spotify 官方推荐与电台类接口暂不可用。
- **播放队列机制**：点播直接通过 Soloist 本地 WebSocket 通道毫秒级起播，无需绕道云端设备轮询，由 MyGo 播放器统一管理播放队列、随机与循环切歌，不会在云端生成临时播放列表。
- **独立音频渲染**：音频流完全由 Soloist 原生引擎负责解码，MyGo 自身的软件均衡器、响度标准化及音频格式设置不会对 Soloist 生效。
- **官方 90 天有效期与自动更新**：Spotify 官方 Soloist 预览版构建自**构建日起 90 天内有效**。插件会默认每 24 小时后台静默检测更新（距过期不足 14 天时积极检测），先暂存校验，在空闲或下次冷启动时无感替换 `bin/soloist.exe`；即便本机文件已过期（退出码 `10`）或因插件升级被覆盖，也会自动重新下载恢复，同时配对与缓存保持完好。

## 常见问题排查

- **无法启动辅助程序**：请检查 `bin/soloist.exe` 是否放置在正确位置，并确认已在 MyGo 插件设置中允许该插件启动外部程序。
- **提示先保存 API Key**：请使用与启动 MyGo Music 相同的 Windows 用户身份在 PowerShell 中执行配置命令；更新或重配 Key 后，建议重启或重新启用插件。
- **提示等待配对或一直卡在正在连接**：请确保手机与电脑在同一局域网（同一 Wi-Fi 或子网），并在手机官方 Spotify App 的设备列表中选择 `MyGo Soloist`。多虚拟网卡、VPN 代理或严格的防火墙规则可能会阻碍局域网设备组播发现。
- **已成功配对但当前账号找不到设备**：插件绑定的 Web API 账号与手机端登录的 Spotify 账号必须为同一账号；此外冷启动后设备注册到云端可能需要数秒缓冲。
- **声音过小或无声**：Soloist 设备音量、Windows 应用程序音量合成器中的 MyGo 音量以及 Windows 输出设备主音量各自独立生效，请依次排查。
- **已有实例在运行**：若此前手动启动过 Soloist，请先退出手动进程再由插件统一管理。保留默认数据路径即可无缝复用已有配对。

## 开发与验证

项目背景、运行时约束与模块架构详见 [AGENTS.md](AGENTS.md)。

`index.js` 运行于 MyGo 的专属插件沙盒运行时（非标准 Node.js 环境），OAuth PKCE 与全部状态管理均在沙盒内纯 JS 实现；`scripts/soloist-host.ps1` 负责从官方 CDN 安全下载校验/原子替换 `bin/soloist.exe` 及可选的 Windows DPAPI 秘钥存取。内置 43 项回归测试覆盖自动下载与静默更新、90 天过期自愈、按源禁用歌词与缓存失效、冷启动恢复进度、超时核对与延迟起播治理、全量播控串行化、Autoplay 拦截与手机接管区分、`trace` 断线重连、艺人页分页容错、歌单增删改排序、三源双语歌词匹配清洗以及挂载后台预热，均使用 Mock 宿主环境，不消耗真实账号额度：

```bash
node --check index.js
node --test tests/plugin.test.cjs
```

本地已全面验证 Soloist 冷启动、配对自动恢复、Spotify 曲库浏览、直接队列播控、播放/暂停/拖动进度与音量调节；并已实机验证 MyGo 拉起 Soloist 子进程及音频正常播放。其他操作系统平台或特殊账号配置仍需独立验证。

安装无需发布 Release：MyGo 支持直接从默认分支的最新 Commit 进行安装。本仓库已添加 `mygo-music-plugin` 标签以便被 [MyGo 插件中心](https://mygo-music.egoist.dev/plugins) 自动收录。

## 开源许可

本项目插件源码采用 [MIT](LICENSE) 许可协议发布。本仓库不包含且不分发 Spotify Soloist 二进制文件，其使用须遵循 Spotify 官方的使用条款与许可协议。本项目与 Spotify、MyGo Music 均无官方关联。
