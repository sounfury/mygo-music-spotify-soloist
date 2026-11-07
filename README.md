# MyGo Music 的 Spotify Soloist 插件

简体中文 · [English](README.en.md)

让 [MyGo Music](https://github.com/egoist/mygo-music) 使用 Spotify 官方 [Soloist](https://developer.spotify.com/documentation/soloist) 播放核心在后台直接播放音乐。由 Spotify Web API 提供曲库与元数据，Soloist 负责原声音频拉取、解码与输出；不依赖 librespot，无需匹配 YouTube 替代音源，亦无二次转码损耗。

> **💡 背景与适用人群**  
> 本插件专为受 [librespot-org/librespot#1649](https://github.com/librespot-org/librespot/issues/1649) 及 Spotify 协议持续变动影响、**无法正常使用 librespot** 的用户打造。借助 Spotify 官方推出的 Soloist 独立播放引擎，彻底告别逆向协议频繁失效、音源失效或掉线等问题，即刻恢复稳定原生的 Spotify 播放体验。

**注意：当前为 Windows x64 预览版。配置 Soloist 播放器与使用本插件的 Web API 播放控制均需拥有 Spotify Premium（高级会员）账号。**

## 功能特性

- **官方原生音质**：音频直接由 Spotify Soloist 获取与解码输出，纯净保真，杜绝二次转码与音质损耗。
- **完整曲库交互**：支持首页个性化推荐、全局搜索（单曲 / 专辑 / 艺人 / 歌单）、个人歌单、已点赞歌曲及收藏专辑。
- **丰富详情与歌词**：支持专辑和艺人主页，并自动接入 LRCLIB 同步滚动歌词。
- **完善的播放控制**：支持播放、暂停、继续、进度拖动、音量调节，深度融入 MyGo 播放队列。
- **静默后台运行**：后台静默拉起 Soloist 进程，无任何终端黑框干扰；自动恢复已保存的 Spotify Connect 配对状态。
- **本地事件驱动**：基于本地事件毫秒级同步播放状态与进度，无需频繁轮询 Spotify 云端 API，低延迟且节省流量。
- **专属诊断面板**：内置“播放状态”页面，提供清晰的连接状态展示与简体中文操作反馈。

## 安装与配置

在 MyGo Music 中打开 **设置 → 插件 → ＋**，输入仓库地址：

```text
sounfury/mygo-music-spotify-soloist
```

[通过 MyGo Music 一键安装](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)

> **说明**：本仓库仅分发插件源代码，**Soloist 可执行程序需自行前往 Spotify 官方获取**。

---

### 1. 放置 Soloist 官方程序

1. 从 [Spotify 官方下载页面](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) 获取 **x86_64 Windows** 版本的程序压缩包。
2. 解压得到 `soloist.exe`。
3. 在 MyGo Music 中点击 **设置 → 插件 → ＋ → 显示插件文件夹**，进入 `spotify-soloist` 目录。在其中新建 `bin` 文件夹（若已存在则直接打开），将 `soloist.exe` 放入：

   ```text
   spotify-soloist/
     plugin.json
     index.js
     scripts/
     bin/
       soloist.exe
   ```

默认情况下，该文件的完整路径为：

```text
%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe
```

---

### 2. 保存 Soloist API Key

1. 登录 [Spotify Soloist 控制台](https://developer.spotify.com/dashboard/soloist) 获取你的专属 API Key。（注意：**该 API Key 与下一步配置的 Web API Client ID 为两份相互独立的凭据**）。
2. 若使用默认插件目录，直接在 PowerShell 中运行以下命令：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
   ```

3. 在弹出的隐藏输入提示中粘贴你的 Key 并按下回车。若插件安装在自定义路径，请相应调整脚本路径。脚本会使用 Windows DPAPI 对 Key 进行本地用户级加密存储。**请切勿将 Key 分享给他人或直接粘贴在公开 Issue 中**。

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

1. 将 MyGo Music 的音乐来源切换为 **Spotify Soloist**，点击任意歌曲或打开 **播放状态** 页面，插件将自动在后台拉起 Soloist 播放引擎。
2. **首次使用配对**：请确保手机与电脑处于同一局域网下，打开手机端官方 Spotify App，在「可用设备」列表中点选 **MyGo Soloist**。配对成功后 Soloist 会在本地保存凭证，后续启动均会自动恢复连接。此后即可直接在 MyGo 中进行完整播放控制，无需常驻 Spotify 官方桌面客户端。
3. **进程生命周期**：由插件启动的 Soloist 进程为静默运行；退出 MyGo 或卸载插件时会自动结束相关子进程。若你在启动 MyGo 前已手动运行了带有本地 API 的 Soloist 实例，插件亦可直接附着连接，且不会在退出时强制结束该手动进程。

## 数据与权限说明

| 数据类型 | 本地存储路径 |
| --- | --- |
| 加密的 Soloist Key | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` |
| Soloist 配对凭证与持久化数据 | `%LOCALAPPDATA%\soloist\data` |
| Soloist 原声音频缓存 | `%LOCALAPPDATA%\soloist\cache` |
| Spotify Web API 令牌及插件设置 | MyGo 目录下的 `plugin-data/spotify-soloist` |

- **多进程互斥**：同一数据目录在同一时间仅支持一个 Soloist 进程访问；只要保留默认路径的数据，已有的配对即可持续复用。在插件中退出 Web API 账号不会影响已建立的 Soloist 设备配对。
- **安全提示**：虽然本地落盘的 Key 已通过 Windows DPAPI 加密，但受限于 Soloist 当前机制，启动时仍需以命令行参数方式传给进程，因而本地进程监视器可能窥见该参数。请避免公开完整的进程命令行、未脱敏日志或会话目录。Spotify Web API 的访问令牌则安全存储于 MyGo 插件本地存储中。本仓库不包含任何私有 Key 或令牌。
- **系统调用说明**：插件需申请调用 `bin/soloist.exe` 与 `powershell.exe`（用于执行本地 DPAPI 解密与高安全性 PKCE 随机串生成）。Soloist 本地控制端口仅监听 `127.0.0.1` 环回地址并采用动态随机端口。在检索歌词时，仅会向 LRCLIB 发送曲名及艺术家等基础元数据。

## 已知限制与更新维护

- **平台支持**：当前预览版仅支持 Windows x64 系统；暂未实现播客播放、在线歌单编辑以及 Soloist 程序的自动在线热更新。
- **开发模式限制**：受 Spotify 开发者开发模式规则制约，部分非本人创建/非协作歌单可能无法读取，且 Spotify 官方推荐与电台类接口暂不可用。
- **播放队列机制**：队列单批最多下发 100 首曲目，由 MyGo 继续管理后续队列上下文；插件直接将播放请求下发给 Soloist，不会在云端生成临时播放列表。
- **独立音频渲染**：音频流完全由 Soloist 原生引擎负责解码，MyGo 自身的软件均衡器、响度标准化及音频格式设置不会对 Soloist 生效。
- **官方 90 天有效期限制**：Spotify 官方提供的 Soloist 预览版构建自**构建日起 90 天内有效**。请在到期前退出 MyGo，从 Spotify 官方页面下载更新的构建替换 `bin/soloist.exe`；若程序已过期，插件会在状态页给出过期提示。
- **插件升级注意事项**：在线更新插件版本可能会全量覆盖插件安装目录，若自定义放置的 `bin/soloist.exe` 被清理，重新放入官方可执行文件即可。本地加密存储的 Key 与配对会话均保存在插件目录之外，不受更新影响。

## 常见问题排查

- **无法启动辅助程序**：请检查 `bin/soloist.exe` 是否放置在正确位置，并确认已在 MyGo 插件设置中允许该插件启动外部程序。
- **提示先保存 API Key**：请使用与启动 MyGo Music 相同的 Windows 用户身份在 PowerShell 中执行配置命令；更新或重配 Key 后，建议重启或重新启用插件。
- **提示等待配对或一直卡在正在连接**：请确保手机与电脑在同一局域网（同一 Wi-Fi 或子网），并在手机官方 Spotify App 的设备列表中选择 `MyGo Soloist`。多虚拟网卡、VPN 代理或严格的防火墙规则可能会阻碍局域网设备组播发现。
- **已成功配对但当前账号找不到设备**：插件绑定的 Web API 账号与手机端登录的 Spotify 账号必须为同一账号；此外冷启动后设备注册到云端可能需要数秒缓冲。
- **声音过小或无声**：Soloist 设备音量、Windows 应用程序音量合成器中的 MyGo 音量以及 Windows 输出设备主音量各自独立生效，请依次排查。
- **已有实例在运行**：若此前手动启动过 Soloist，请先退出手动进程再由插件统一管理。保留默认数据路径即可无缝复用已有配对。

## 开发与验证

`index.js` 运行于 MyGo 的专属插件沙盒运行时（非标准 Node.js 环境）。`scripts/soloist-host.ps1` 负责处理 Windows DPAPI 秘钥存取与高安全性 PKCE 随机密钥生成。内置的回归测试使用 Mock 宿主环境，不消耗真实账号额度：

```bash
node --test tests/plugin.test.cjs
```

本地已全面验证 Soloist 冷启动、配对自动恢复、Spotify 曲库浏览、直接队列播控、播放/暂停/拖动进度与音量调节；并已实机验证 MyGo 拉起 Soloist 子进程及音频正常播放。其他操作系统平台或特殊账号配置仍需独立验证。

安装无需发布 Release：MyGo 支持直接从默认分支的最新 Commit 进行安装。本仓库已添加 `mygo-music-plugin` 标签以便被 [MyGo 插件中心](https://mygo-music.egoist.dev/plugins) 自动收录。

## 开源许可

本项目插件源码采用 [MIT](LICENSE) 许可协议发布。本仓库不包含且不分发 Spotify Soloist 二进制文件，其使用须遵循 Spotify 官方的使用条款与许可协议。本项目与 Spotify、MyGo Music 均无官方关联。
