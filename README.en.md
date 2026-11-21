# Spotify Soloist for MyGo Music

[简体中文](README.md) · English

A cross-platform (Windows x64 & Apple Silicon macOS) plugin for [MyGo Music](https://github.com/egoist/mygo-music) that plays Spotify audio through the official [Spotify Soloist](https://developer.spotify.com/documentation/soloist) playback engine. Spotify Web API supplies the music library and metadata; Soloist handles native audio retrieval, decoding, and output without transcoding. No librespot, YouTube audio matching, or terminal windows are required for normal playback.

> **💡 Background & Target Audience**  
> This plugin is specifically designed for users who **cannot use librespot** due to [librespot-org/librespot#1649](https://github.com/librespot-org/librespot/issues/1649) and ongoing breaking protocol changes by Spotify. Instead of relying on reverse-engineered protocols that frequently break, Soloist is an official standalone playback engine provided directly by Spotify—offering a stable, compliant, and bit-perfect streaming experience.

**Note: Supports Windows x64 and Apple Silicon macOS (macOS 13+; Spotify Soloist does not ship an Intel macOS build). Official builds expire 90 days from their build date. A Spotify Premium account is required for Soloist playback.**

## Key Advantages & Features

- **⚡ Instant Local Playback (Sub-Second Start)**: Starts tracks directly over Soloist's local WebSocket control channel—completely bypassing Spotify cloud device polling and cloud play API latency. Rapid track switching uses **generation preemption** so your latest click immediately supersedes stale requests.
- **🎵 Official Native Audio, Zero librespot Breakage**: Audio is retrieved, decoded, and output directly by Spotify's official Soloist engine with zero transcoding or third-party stream substitution.
- **🚀 Silent Warmup on Mount & Zero-Script Setup**: Automatically starts Soloist silently in the background as soon as the plugin mounts (no console window, never steals playback focus from other devices) and restores saved pairings for near-instant first playback. Paste your Soloist API key directly in MyGo's plugin settings with live reload; OAuth PKCE runs in pure JavaScript inside the sandbox with zero PowerShell overhead in normal use.
- **🛡️ Resilient State Machine & Seamless Queue Control**:
  - All write controls (play, pause, resume, seek, volume, device activation) share a single serialized queue with generation and connection checks;
  - Session restore after restarting MyGo decouples playback start from seeking, avoiding false playback failures while a track is still buffering;
  - Intercepts Spotify's automatic `[autoplay]` continuation at track end and hands queue progression back to MyGo (preserving MyGo shuffle, repeat one/all, mixed-source queues, and genuine phone takeover);
  - Local `trace` event streaming reconnects automatically with backoff, and timed-out commands are reconciled against live state to prevent desync or ghost playback.
- **📚 Full Library & Playlist Management**: Browse personalized home recommendations, global search (tracks, albums, artists, playlists), your playlists, liked songs, and saved albums; create, rename, delete, and save playlists, add/remove tracks in batches, and reorder playlist tracks.
- **🌐 Rich Details & Configurable Tri-Source Bilingual Lyrics**: Dedicated album and artist pages (including artist follow/unfollow), with concurrent synchronized lyrics lookup across **LRCLIB, NetEase Cloud Music, and QQ Music**—prioritizing original + Chinese translation with in-memory caching—plus 3 independent toggles in plugin settings to disable any lyric provider on demand.
- **🔄 Automatic Download & Silent Auto-Updates**: While this repository never redistributes binaries, the plugin automatically downloads, MD5/signature-verifies, and atomically installs the official Soloist binary (`bin/soloist.exe` on Windows, `bin/soloist` on Apple Silicon macOS) directly from Spotify's CDN when missing, wiped by a plugin update, or expired (exit code `10`). A lightweight background `HEAD` check runs every 24 hours, staging new builds without interrupting playback and swapping them silently when idle or on next startup.
- **🔍 Persistent Diagnostics Panel**: Built-in "Playback Status" sidebar page displays pairing health, installed Soloist engine version / days remaining before expiry, and persists the latest playback diagnostic (action, reason, and exit code) until the next successful play/resume.

## Installation & Setup

In MyGo Music, navigate to **Settings → Plugins → +** and enter:

```text
sounfury/mygo-music-spotify-soloist
```

[Install in MyGo Music](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)

> **Notice**: This repository distributes plugin source code only and bundles no binaries. **Once process execution is allowed, the plugin automatically downloads and updates the platform Soloist binary (`bin/soloist.exe` on Windows, `bin/soloist` on Apple Silicon macOS) directly from Spotify's official CDN** (manual placement remains supported for offline environments).

---

### 1. Official Soloist executable (automatic, manual fallback supported)

- **Automatic (default)**: After completing Steps 2–3 below and allowing program execution, switching to Spotify Soloist automatically fetches the latest official archive for your platform (`soloist_release_windows_x86_64.zip` on Windows x64, `soloist_release_osx_arm64.tar.gz` on Apple Silicon macOS) from [Spotify's official downloads CDN](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates), verifies its checksum and `--version` signature, and installs it into the plugin's `bin/` directory. Future updates are checked and applied silently without interrupting playback.
- **Manual fallback (optional)**: If your network cannot reach Spotify's CDN directly, download the archive for your platform from Spotify and extract the executable to:
  - **Windows x64**: `%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe`
  - **macOS (Apple Silicon)**: `~/Library/Application Support/MyGo Music/plugins/spotify-soloist/bin/soloist` (ensure it is executable with `chmod +x`)

---

### 2. Configure your personal Soloist API key

1. Generate your personal API key from the [Spotify Soloist dashboard](https://developer.spotify.com/dashboard/soloist). (Note: **This key is distinct from the Web API Client ID in the next step**).
2. **Recommended (directly in MyGo settings — works on Windows & macOS)**: Open **Settings → Plugins → Spotify Soloist**, paste your key into the masked **Soloist API Key** field, and save. Updating the key automatically restarts Soloist in the background—no helper script or manual plugin reload required.
3. **Optional (OS secret-store script)**: If you prefer OS-encrypted storage outside MyGo's settings, leave **Soloist API Key** blank and run:
   - **Windows (DPAPI)**:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
     ```
   - **macOS (Keychain)**:
     ```sh
     /bin/sh "$HOME/Library/Application Support/MyGo Music/plugins/spotify-soloist/scripts/soloist-host.sh" setup
     ```

   Paste your key into the masked prompt and press Enter (adjust the path if your plugin is installed in a custom directory). **Never share this key with others or post it in public issues.**

---

### 3. Authorize the Spotify music library

1. Create or open an existing application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Enable Web API in the application settings and add this exact Redirect URI:

   ```text
   http://127.0.0.1:43110/callback
   ```

3. In MyGo Music under **Settings → Plugins → Spotify Soloist**, enter that application's **Client ID**, allow the plugin to start external programs, and click **Sign In**.
4. Complete the authorization prompt in your default web browser. If your Spotify developer app is in Development Mode, ensure your account is listed under **User Management**.

*Note: You do not need to enter a Client Secret. If you change the Client ID in the future, simply click Sign In again.*

---

### 4. Pair once, then play in MyGo

1. Switch the music source in MyGo Music to **Spotify Soloist**. The plugin automatically warms up the background Soloist engine on mount (you can also click any song or open the **Playback Status** page to inspect connection status).
2. **Initial Pairing**: Ensure your computer and smartphone are connected to the same local area network (LAN/Wi-Fi). Open the official Spotify app on your phone, open the device picker, and select **MyGo Soloist**. Soloist saves the session and will automatically reconnect on subsequent runs. You can then use MyGo for playback without keeping the official desktop client running.
3. **Process Lifecycle**: When started by this plugin, Soloist runs silently without console windows. Quitting MyGo or disabling the plugin automatically terminates these child processes. If you already started Soloist manually with its local API enabled, the plugin can attach to it without terminating your manual process.

## Data & Permissions

| Data | Windows Location | macOS Location |
| --- | --- | --- |
| Spotify Web API tokens & plugin settings (including UI-configured key) | MyGo's `plugin-data/spotify-soloist` directory | MyGo's `plugin-data/spotify-soloist` directory |
| Soloist pairing & audio cache (shared across both key modes) | `%LOCALAPPDATA%\soloist\{data,cache}` | `~/Library/Application Support/soloist` & `~/Library/Caches/soloist` |
| Soloist auto-update staging folder | `%LOCALAPPDATA%\MyGoSoloist\staging` | `~/Library/Caches/MyGoSoloist/staging` |
| Encrypted Soloist Key (optional script mode only) | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` (DPAPI) | macOS Keychain (Service: `MyGoSoloist`) |

- **Process Isolation**: Only one Soloist process may access the data directory at a time. Existing pairings in the default location are preserved and reused. Signing out of the Web API account does not erase the separate Soloist device pairing.
- **Security Notice**: While the stored key is encrypted via Windows DPAPI or macOS Keychain, Soloist currently requires the key to be passed via process command-line arguments, meaning local process monitoring tools may observe it. Avoid sharing raw command-line invocations, unredacted logs, or session folders. Spotify Web API tokens are securely stored in MyGo's local plugin storage. No user credentials or API keys are bundled with this repository.
- **System Invocation & Network**: OAuth PKCE runs in pure JavaScript inside the plugin sandbox, so signing in to your library requires no child process. `bin/soloist.exe` (Windows) or `bin/soloist` (macOS) is spawned for audio playback; `powershell.exe` (Windows) or `/bin/sh` (macOS) is only invoked when downloading/installing an official Soloist update (from the hardcoded official URL on `soloist-builds.spotifycdn.com` with MD5 and `--version` verification) or if **Soloist API Key** is left blank and the optional local secret-store script is used. Routine update checks use a lightweight pure-JS `HEAD` request to `soloist-builds.spotifycdn.com`. Soloist binds its local control interface strictly to `127.0.0.1` using an automatically assigned port. When fetching bilingual synchronized lyrics, only public track metadata (title, artist, album, and duration) is sent to LRCLIB (`lrclib.net`), NetEase Cloud Music (`music.163.com`), and QQ Music (`c.y.qq.com`, `u.y.qq.com`).

## Limitations & Updates

- **Platform Support**: Supports **Windows x64** and **Apple Silicon macOS (arm64, macOS 13+)**. Spotify Soloist does not currently provide an Intel macOS build. Podcasts are not yet implemented.
- **Development Mode Limits**: Standard Spotify Development Mode restrictions apply, such as inaccessible editorial recommendations and limited access to playlists you neither own nor collaborate on.
- **Playback Queue**: Tracks start directly over Soloist's local WebSocket control channel without waiting on cloud device polling; MyGo manages queue progression, shuffle, and repeat without creating temporary cloud playlists.
- **Native Audio Rendering**: Audio decoding and output are handled entirely by the Soloist engine. MyGo's built-in software normalization, equalizer, and format settings do not apply to the external player.
- **90-Day Build Expiry & Auto-Updates**: Official Spotify Soloist preview builds expire **90 days after their build date**. The plugin silently checks for newer official builds every 24 hours (and proactively within 14 days of expiry), stages verified updates in the background, and atomically replaces `bin/soloist.exe` when idle or on next startup. Missing binaries (such as after a MyGo plugin upgrade) and expired builds (exit code `10`) self-heal automatically while preserving your pairings and audio cache.

## Troubleshooting

- **Cannot start helper program**: Verify that `bin/soloist.exe` (Windows) or `bin/soloist` (macOS) exists in the plugin directory and ensure "Allow program execution" is checked in MyGo's plugin settings. On macOS, if manually downloaded and blocked by Gatekeeper, run `chmod +x` and `xattr -d com.apple.quarantine` on `bin/soloist`.
- **Prompted to save Soloist API key first**: Entering your key directly in **Soloist API Key** in plugin settings is recommended. If using the optional helper script, run the setup command under the same OS user account running MyGo.
- **Waiting for pairing / endless connection attempt**: Ensure your phone and PC are on the exact same local Wi-Fi / LAN subnet. Try selecting `MyGo Soloist` in the mobile Spotify app's device list. Multiple network adapters, virtual VPN interfaces, or strict firewall policies can disrupt multicast discovery.
- **Paired but device is not visible to this account**: Verify that both the plugin Web API sign-in and the mobile Spotify app use the identical Spotify account. Allow a few seconds after cold boot for device registration.
- **Playback volume is low or inaudible**: Soloist device volume, the Windows volume mixer slider for MyGo, and the master system output volume each take effect independently. Check all three.
- **Instance already running**: If you previously launched Soloist manually, stop the manual process before letting the plugin manage it. Keeping the default data directory preserves your existing pairing.

## Development & Testing

See [AGENTS.md](AGENTS.md) for project background, runtime constraints, and architecture details.

`index.js` executes within MyGo's plugin sandbox runtime (not standard Node.js), with OAuth PKCE and all playback state management implemented in pure JavaScript; `scripts/soloist-host.ps1` (Windows) and `scripts/soloist-host.sh` (Apple Silicon macOS) handle verified official Soloist downloads/atomic installs and optional DPAPI/Keychain key storage. 45 built-in regression tests cover Windows/macOS auto-download & silent updates, 90-day expiry self-healing, per-source lyric toggles & cache invalidation, cold-start position restore, command timeout reconciliation, serialized playback controls, autoplay interception vs. phone takeover, `trace` auto-reconnect, artist page pagination/fallback, playlist editing/reordering, tri-source bilingual lyrics matching & decoding, and mount-time background warmup using mocked host interfaces without real Spotify credentials:

```bash
node --check index.js
node --test tests/plugin.test.cjs
```

Local verification includes Soloist cold start, pairing restoration, Spotify catalog browsing, direct queue playback, playback controls (pause/resume/seek/volume), and verified audio output via MyGo. Other operating systems or custom account setups require independent validation.

Installing does not require GitHub Releases: MyGo installs directly from the latest commit on the default branch. The repository uses the `mygo-music-plugin` topic for automatic discovery on the [MyGo Plugin Directory](https://mygo-music.egoist.dev/plugins).

## License

This plugin's original source code is released under the [MIT](LICENSE) License. Spotify Soloist binaries are neither hosted nor distributed here and are subject to Spotify's terms of service. This project is not officially affiliated with or endorsed by Spotify or MyGo Music.
