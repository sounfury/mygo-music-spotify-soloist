# Spotify Soloist for MyGo Music

[简体中文](README.md) · English

A Spotify plugin for [MyGo Music](https://github.com/egoist/mygo-music) supporting **Windows x64** and **Apple Silicon macOS**. **Spotify Web API** supplies your music library and metadata, while Spotify's official **[Soloist](https://developer.spotify.com/documentation/soloist)** engine handles native audio retrieval, decoding, and output—no librespot, no YouTube matching, and no transcoding. Built for users affected by [librespot#1649](https://github.com/librespot-org/librespot/issues/1649) and Spotify protocol changes.

> **Requirements**: A **Spotify Premium** account and **Windows x64** or **Apple Silicon macOS (macOS 13+)** (Spotify does not ship an Intel macOS build). Official Soloist builds expire after 90 days; the plugin downloads and updates them automatically.

## Features

- **Native Audio & Instant Start**: Controls the local Soloist engine directly, bypassing cloud polling latency with rapid-switch preemption and silent background warmup.
- **Cross-Platform Auto-Updates**: Supports Windows and Apple Silicon macOS. Automatically downloads, verifies (MD5 & version signature), and silently updates Soloist from Spotify's official CDN without interrupting playback.
- **Full Library & Playlist Management**: Personalized home, search with live suggestions, album & artist pages (with follow/unfollow), playlist create/rename/delete/save, batch track add/remove, and reordering.
- **Spotify Connect Multi-Device Switching**: Discovers online devices on your account (phones, computers, speakers) and lets you switch playback targets from the **Playback Status** sidebar page—or switch back to local Soloist anytime.
- **Tri-Source Bilingual Lyrics**: Concurrently queries **LRCLIB, NetEase Cloud Music, and QQ Music** (prioritizing original + Chinese translation), with independent toggles in settings to disable any provider.
- **Resilient Controls & Diagnostics**: Intercepts Spotify Autoplay so MyGo retains queue control, supports an optional **Local startup volume (0–100)** setting, and displays version/expiry/diagnostics in **Playback Status**.

## Quick Start

### 1. Install the Plugin

- Open **Plugins** in MyGo Music's sidebar and search `spotify-soloist` to install with one click;
- Or click [Install in MyGo Music](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist), or go to **Settings → Plugins → +** and enter `sounfury/mygo-music-spotify-soloist`.

In plugin settings, **enable external program execution** (Soloist is downloaded automatically—no manual binary placement needed).

### 2. Configure Credentials & Sign In

Set two separate credentials in **Settings → Plugins → Spotify Soloist**:

1. **Soloist API Key**: Get your key from the [Spotify Soloist Dashboard](https://developer.spotify.com/dashboard/soloist) and paste it into **Soloist API Key** (applies immediately).
2. **Client ID**: Create or open an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), enable Web API, and add this Redirect URI:
   ```text
   http://127.0.0.1:43110/callback
   ```
   Paste the **Client ID** into plugin settings (no Client Secret needed; in Development Mode, add your account under **User Management**), then click **Sign In**.

### 3. Pair Once & Play

1. Switch MyGo's music source to **Spotify Soloist**. On first use, the plugin automatically downloads and silently starts Soloist in the background.
2. With your phone and computer on the **same LAN/Wi-Fi**, open the official Spotify mobile app and select **`MyGo Soloist (Windows)`** or **`MyGo Soloist (macOS)`** from the device picker.
3. Pairing is saved locally and restored automatically on future launches—no official desktop client required.

> **Optional Settings**: Set **Local startup volume** (`0`–`100`, `0` to mute, blank to keep device volume) or disable individual lyric providers in plugin settings.

<details>
<summary>Advanced: Manual Soloist Placement / OS Secret-Store Script for API Key</summary>

#### Manual Binary Placement (Offline Fallback)
If you cannot reach Spotify's CDN directly, download your platform archive from [Spotify's official downloads page](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) and extract the binary to:
- **Windows x64**: `%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe`
- **macOS (Apple Silicon)**: `~/Library/Application Support/MyGo Music/plugins/spotify-soloist/bin/soloist` (if blocked by Gatekeeper, run `chmod +x` and `xattr -d com.apple.quarantine`)

#### Store Soloist API Key via OS Secret-Store Script
To keep the key encrypted outside MyGo settings, leave **Soloist API Key** blank and run:
- **Windows (DPAPI)**:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
  ```
- **macOS (Keychain)**:
  ```sh
  /bin/sh "$HOME/Library/Application Support/MyGo Music/plugins/spotify-soloist/scripts/soloist-host.sh" setup
  ```

</details>

## Data & Permissions

| Data | Windows Location | macOS Location |
| --- | --- | --- |
| Tokens & plugin settings | MyGo `plugin-data/spotify-soloist` | MyGo `plugin-data/spotify-soloist` |
| Soloist pairing & cache | `%LOCALAPPDATA%\soloist\{data,cache}` | `~/Library/Application Support/soloist` & `~/Library/Caches/soloist` |
| Auto-update staging | `%LOCALAPPDATA%\MyGoSoloist\staging` | `~/Library/Caches/MyGoSoloist/staging` |
| Encrypted key (script mode) | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` | macOS Keychain (Service: `MyGoSoloist`) |

- **Network & Processes**: OAuth PKCE runs in pure JS with no helper process. `powershell.exe` / `/bin/sh` is only invoked for verified Soloist downloads/updates (hardcoded to `soloist-builds.spotifycdn.com` with MD5 & `--version` checks) or optional script-based key lookup. Library/auth uses `api.spotify.com` and `accounts.spotify.com`; lyrics send only public track metadata (title, artist, album, duration) to `lrclib.net`, `music.163.com`, `c.y.qq.com`, and `u.y.qq.com`.
- **Security**: No binaries or user credentials are bundled in this repo. Soloist binds its local API strictly to `127.0.0.1` on an ephemeral port, but because Soloist currently takes its API key via CLI arguments, avoid sharing raw command lines or unredacted logs.

## Troubleshooting & Limitations

- **Stuck pairing / device not found**: Ensure phone and PC share the same LAN subnet and Spotify account. VPNs, virtual adapters, or strict firewalls can block multicast discovery.
- **Cannot start program**: Make sure external program execution is enabled in plugin settings. On macOS, manually placed binaries may require `chmod +x` and `xattr -d com.apple.quarantine`.
- **Low volume or no sound**: Soloist volume and system output volume (plus Windows Volume Mixer) apply independently. Because Soloist decodes audio natively, MyGo's built-in EQ and normalization do not apply.
- **Instance already running**: Close any manually launched Soloist instance before letting the plugin manage it.
- **Spotify limits**: In Development Mode, editorial recommendations and some non-owned/non-collaborative playlists are unavailable. Podcasts are not yet supported.

## Development & License

See [AGENTS.md](AGENTS.md) for architecture and runtime constraints. Tests run entirely against mocked host APIs:

```bash
node --check index.js
node --test tests/plugin.test.cjs
```

Source code is licensed under [MIT](LICENSE). Spotify Soloist binaries are not distributed here and remain subject to Spotify's terms. Not officially affiliated with Spotify or MyGo Music.
