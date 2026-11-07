# MyGo Music 的 Spotify Soloist 插件

简体中文 · [English](README.md)

让 [MyGo Music](https://github.com/egoist/mygo-music) 使用 Spotify 官方 [Soloist](https://developer.spotify.com/documentation/soloist) 在后台播放音乐。Spotify Web API 提供音乐库，Soloist 负责获取音频、解码和输出；不依赖 librespot，不匹配 YouTube 音源，不进行二次转码。

**当前为 Windows x64 预览版。配置 Soloist 和使用本插件的 Web API 播放控制需要 Spotify Premium。**

## 功能

- 首页、歌曲/专辑/艺人/歌单搜索、个人歌单、喜欢的歌曲和收藏专辑。
- 专辑和艺人页面，以及 LRCLIB 收录的同步歌词。
- 播放、暂停、继续、拖动进度、音量和 MyGo 播放队列。
- 后台启动 Soloist，无需终端窗口；自动恢复已经保存的 Spotify Connect 配对。
- 通过本地事件同步播放状态，不每秒轮询 Spotify 云端接口。
- 播放状态页面和简体中文提示。

## 安装

在 MyGo Music 中打开 **设置 → 插件 → ＋**，输入：

```text
sounfury/mygo-music-spotify-soloist
```

[通过 MyGo Music 安装](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)

仓库只发布插件源码，**Soloist 程序需单独从 Spotify 官方下载**。

### 1. 放置 Soloist 程序

1. 从 [Spotify 官方下载页面](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) 获取 **x86_64 Windows** 版本。
2. 解压得到 `soloist.exe`。
3. 在 MyGo Music 中选择 **设置 → 插件 → ＋ → 显示插件文件夹**，打开 `spotify-soloist`，必要时创建 `bin` 文件夹，把程序放进去：

   ```text
   spotify-soloist/
     plugin.json
     index.js
     scripts/
     bin/
       soloist.exe
   ```

Windows 默认目标位置是：

```text
%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe
```

### 2. 保存 Soloist API Key

在 [Spotify Soloist 后台](https://developer.spotify.com/dashboard/soloist) 生成你自己的 API Key。它与下一步的 **Web API Client ID 是两份独立配置**。

如果使用默认插件目录，在 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
```

在隐藏输入提示中粘贴 Key，按回车。插件在其他位置时，调整脚本路径。脚本使用 Windows DPAPI 为当前 Windows 用户加密保存 Key；不要将 Key 发给别人或放进公开 Issue。

### 3. 授权 Spotify 音乐库

1. 在 [Spotify 开发者后台](https://developer.spotify.com/dashboard) 创建或使用自己的应用。
2. 启用 Web API，添加以下完整回调地址：

   ```text
   http://127.0.0.1:43110/callback
   ```

3. 在 **设置 → 插件 → Spotify Soloist** 中填写应用的 **Client ID**，允许插件启动程序，点击 **登录**。
4. 在系统浏览器中批准授权。Spotify 开发模式可能要求在应用的 **User Management** 中添加使用账号。

无需输入 Client Secret。修改 Client ID 后需重新登录。

### 4. 首次配对，之后在 MyGo 播放

将音源切换为 **Spotify Soloist**，打开 **播放状态** 或点击歌曲，让插件启动后台播放器。

首次使用时，在同一局域网的手机 Spotify 官方 App 中，打开设备列表并选择 **MyGo Soloist**。Soloist 会保存会话，以后启动时自动恢复。之后可以使用 MyGo 控制播放，无需一直打开 Spotify 官方桌面客户端。

由插件启动时，MyGo 隐藏 Soloist 的控制台，并在退出应用或卸载插件时结束这些子进程。如果你手动启动了启用本地 API 的 Soloist，插件可以连接它，但不会接管或关闭这个手动进程。

## 数据和权限

| 数据 | 位置 |
| --- | --- |
| 加密的 Soloist Key | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` |
| Soloist 配对和持久数据 | `%LOCALAPPDATA%\soloist\data` |
| Soloist 音频缓存 | `%LOCALAPPDATA%\soloist\cache` |
| Spotify Web API 令牌和插件设置 | MyGo 的 `plugin-data/spotify-soloist` 目录 |

一个数据目录同一时间只能由一个 Soloist 进程使用，默认位置已有的配对可以复用。退出插件的 Web API 登录不会删除独立的 Soloist 配对。

虽然落盘的 Key 已加密，Soloist 当前仍要求通过进程参数传入 Key，本机进程检查可能看到它。不要公开完整进程命令行、未脱敏日志或会话目录。Spotify Web API 令牌通过 MyGo 插件存储保存在本地 JSON 中。仓库不包含 Key 或令牌。

插件申请启动 `bin/soloist.exe` 和 `powershell.exe`，后者运行随插件提供的 Key/PKCE 辅助脚本。Soloist 本地控制接口仅绑定 `127.0.0.1`，使用自动分配端口。查歌词时，歌曲信息会发送给 LRCLIB。

## 限制和更新

- 当前仅支持 Windows x64；尚未实现播客、歌单编辑和 Soloist 自动更新。
- Spotify 开发模式限制仍然存在，包括部分非本人/非协作歌单不可读取，以及编辑推荐等接口不可用。
- 队列每批最多发送 100 首，MyGo 后续继续管理队列；插件直接向 Soloist 发送播放请求，不创建播放歌单。
- 音质由 Soloist 决定，MyGo 自身的解码、音量标准化和音质设置不会配置这个外部播放器。
- Soloist 每个构建从**构建日期**起有效 90 天。到期前退出 MyGo，用官方新版本替换 `bin/soloist.exe`；插件会报告构建过期。
- 插件更新可能替换整个插件目录，包括自行加入的程序。如果 `bin/soloist.exe` 被移除，请重新放入官方程序。Key 和配对保存在插件目录之外。

## 排查

- **无法启动辅助程序：**检查 `bin/soloist.exe` 是否存在，以及插件是否已获准启动程序。
- **提示先保存 API Key：**用运行 MyGo 的同一个 Windows 用户执行配置脚本。更新 Key 后重启或重新启用插件。
- **等待配对或一直正在连接：**先用同一局域网的手机官方 Spotify 配对。多网卡、代理、防火墙可能影响发现和连接。
- **已配对但当前账号看不到设备：**音乐库授权与 Soloist 配对必须使用同一 Spotify 账号；冷启动注册设备可能需要几秒。
- **声音小：**Soloist 设备音量、Windows 应用音量和 Windows 输出设备总音量分别生效。
- **已有实例运行：**先关闭手动启动的 Soloist，再让插件管理进程。保留默认数据目录即可复用配对。

## 开发和验证

`index.js` 运行于 MyGo 插件运行时，不是 Node.js。`scripts/soloist-host.ps1` 处理 Windows Key 加密读取和 PKCE 随机数生成。回归测试使用模拟宿主，不访问真实账号：

```bash
node --test tests/plugin.test.cjs
```

本机已验证 Soloist 冷启动、配对恢复、Spotify 曲库、直接队列播放、暂停/继续、拖动进度及音量；也已观察到 MyGo 通过该插件运行 Soloist 子进程并播放音乐。其他平台和账号组合仍需各自验证。

不必创建 Release：MyGo 可以安装默认分支的最新提交。仓库添加 `mygo-music-plugin` topic 后，可由 [MyGo 插件目录](https://mygo-music.egoist.dev/plugins)发现。

## 许可

本插件独立实现的源码采用 [MIT](LICENSE) 许可。仓库不分发 Soloist 二进制，其适用 Spotify 自己的条款和第三方许可。本项目与 Spotify、MyGo Music 均无官方关联。
