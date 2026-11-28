# Spotify Soloist for MyGo Music

简体中文 · [English](README.en.md)

[MyGo Music](https://github.com/egoist/mygo-music) 的第三方 Spotify 插件，支持 **Windows x64** 与 **Apple Silicon macOS**。通过 **Spotify Web API** 获取曲库，由官方独立播放引擎 **[Soloist](https://developer.spotify.com/documentation/soloist)** 原生拉取并解码输出音频——无需 librespot、无替代音源、无二次转码，专为受 [librespot#1649](https://github.com/librespot-org/librespot/issues/1649) 及协议变动困扰的用户打造。

> **使用前提**：需要 **Spotify Premium** 账号；支持 **Windows x64** 与 **Apple Silicon（M 系列，macOS 13+）**（官方暂未提供 Intel Mac 构建）。Soloist 官方构建 90 天有效，插件会自动维护更新。

## 功能特性

- **原声秒播**：直连本地 Soloist 引擎，绕开云端设备轮询延迟，支持连点切歌抢占与静默后台预热。
- **跨平台自动维护**：支持 Windows 与 Apple Silicon macOS；缺少二进制、升级覆盖或 90 天到期时自动从 Spotify 官方 CDN 下载、校验并后台静默更新，不打断播放。
- **完整曲库与歌单管理**：支持首页推荐、全局搜索与输入实时联想、专辑/艺人主页（含关注）、个人歌单新建/重命名/删除/收藏、曲目批量增删与排序。
- **Spotify Connect 多设备切换**：自动发现同账号在线设备（手机、电脑、音箱等），可在侧边栏「播放状态」页一键切换并控播，随时切回本机 Soloist。
- **三源双语同步歌词**：并发检索 **LRCLIB + 网易云音乐 + QQ 音乐**（优先原词 + 中文翻译），设置页提供 3 个独立开关按需禁用。
- **可靠控播与实用设置**：自动拦截 Spotify Autoplay 续播把切歌权交还 MyGo；支持配置 **本机起播音量（0–100）**；「播放状态」页展示版本、剩余有效期与播控诊断。

## 快速开始

### 1. 安装插件

- 在 MyGo Music 侧边栏 **插件** 页直接搜索 `spotify-soloist` 一键安装；
- 或打开 **设置 → 插件 → ＋** 输入 `sounfury/mygo-music-spotify-soloist`，亦可点击 [通过 MyGo Music 一键安装](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)。

安装后在插件设置中**勾选允许插件启动外部程序**（Soloist 会自动下载安装，无需手动放置二进制）。

### 2. 配置凭据并登录

需要配置两份独立凭据，均在 **设置 → 插件 → Spotify Soloist** 中填写：

1. **Soloist API Key**：前往 [Spotify Soloist 控制台](https://developer.spotify.com/dashboard/soloist) 获取，直接粘贴到设置中的 **Soloist API Key** 密码框即可热生效。
2. **Client ID**：前往 [Spotify 开发者后台](https://developer.spotify.com/dashboard) 创建或选择应用，启用 Web API 并添加回调地址：
   ```text
   http://127.0.0.1:43110/callback
   ```
   将 **Client ID** 填入插件设置（无需 Client Secret；开发模式请在应用 **User Management** 中添加当前账号），点击 **登录** 完成浏览器授权。

### 3. 首次配对与播放

1. 将 MyGo 音乐来源切至 **Spotify Soloist**，插件会自动下载（首次）并在后台静默拉起 Soloist。
2. 确保手机与电脑处于**同一局域网**，打开手机 Spotify App，在可用设备中选择 **`MyGo Soloist (Windows)`** 或 **`MyGo Soloist (macOS)`** 完成首次配对。
3. 配对凭证会自动保存在本地，之后无需开启官方桌面客户端，直接在 MyGo 内选歌播放即可。

> **可选设置**：可在插件设置中填写 **本机起播音量**（`0`–`100` 整数，`0` 为静音，留空沿用设备当前音量），或按需关闭任意歌词源。

<details>
<summary>进阶：手动放置 Soloist 二进制 / 使用系统密钥库脚本保存 API Key</summary>

#### 离线手动放置 Soloist
若无法直连 Spotify CDN，可从 [Spotify 官方下载页](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) 下载对应压缩包并放入插件 `bin/` 目录：
- **Windows x64**：`%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe`
- **macOS (Apple Silicon)**：`~/Library/Application Support/MyGo Music/plugins/spotify-soloist/bin/soloist`（如被系统拦截请执行 `chmod +x` 与 `xattr -d com.apple.quarantine`）

#### 使用系统安全存储脚本保存 Soloist API Key
若希望将 Key 加密存于系统密钥库，请将设置里的 **Soloist API Key** 留空，并运行对应脚本按提示粘贴 Key：
- **Windows（DPAPI）**：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
  ```
- **macOS（Keychain）**：
  ```sh
  /bin/sh "$HOME/Library/Application Support/MyGo Music/plugins/spotify-soloist/scripts/soloist-host.sh" setup
  ```

</details>

## 数据与权限

| 数据 | Windows 路径 | macOS 路径 |
| --- | --- | --- |
| 令牌与插件设置 | MyGo `plugin-data/spotify-soloist` | MyGo `plugin-data/spotify-soloist` |
| Soloist 配对与缓存 | `%LOCALAPPDATA%\soloist\{data,cache}` | `~/Library/Application Support/soloist` & `~/Library/Caches/soloist` |
| 自动更新暂存 | `%LOCALAPPDATA%\MyGoSoloist\staging` | `~/Library/Caches/MyGoSoloist/staging` |
| 加密 Key（仅脚本模式） | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` | macOS 钥匙串（Service: `MyGoSoloist`） |

- **网络与进程**：登录走沙盒内纯 JS PKCE，无需子进程；仅自动下载/更新（固定从 `soloist-builds.spotifycdn.com` 拉取并校验 MD5 与版本签名）或脚本读取 Key 时才调用 `powershell.exe` / `/bin/sh`。曲库与授权访问 `api.spotify.com` / `accounts.spotify.com`；歌词仅向 `lrclib.net`、`music.163.com`、`c.y.qq.com`、`u.y.qq.com` 发送曲名、歌手、专辑与时长等公开信息。
- **安全说明**：本仓库不含任何二进制与用户凭据。Soloist 本地控制仅监听 `127.0.0.1` 随机端口；但因 Soloist 需通过命令行参数接收 API Key，切勿公开未脱敏的进程命令行或会话目录。

## 常见问题与限制

- **无法配对或一直连接中**：确保手机与电脑在同一局域网且登录同一 Spotify 账号；VPN、多虚拟网卡或防火墙可能拦截局域网设备发现。
- **无法启动程序**：确认已在插件设置中允许启动外部程序；macOS 手动放入的二进制请执行 `chmod +x` 与 `xattr -d com.apple.quarantine`。
- **声音过小或无声**：Soloist 音量、系统输出音量（及 Windows 音量合成器）相互独立，请逐项检查；另因音频由 Soloist 原生解码，MyGo 内置 EQ 与响度标准化不会生效。
- **已有实例冲突**：如手动运行过 Soloist，请先退出后再交由插件托管。
- **Spotify 平台限制**：开发模式下部分非自建/非协作歌单及官方推荐接口不可用；暂不支持播客播放。

## 开发与许可

架构与开发约束详见 [AGENTS.md](AGENTS.md)。回归测试完全在 Mock 沙盒中运行，不消耗真实账号额度：

```bash
node --check index.js
node --test tests/plugin.test.cjs
```

源码基于 [MIT](LICENSE) 许可发布。本仓库不分发 Spotify Soloist 二进制文件，其使用须遵守 Spotify 条款；本项目与 Spotify、MyGo Music 无官方关联。
