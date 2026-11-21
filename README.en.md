# Spotify Soloist for MyGo Music

[简体中文](README.md) · English

A Windows x64 plugin for [MyGo Music](https://github.com/egoist/mygo-music) that plays Spotify audio through the official [Spotify Soloist](https://developer.spotify.com/documentation/soloist) playback engine. Spotify Web API supplies the music library and metadata; Soloist handles native audio retrieval, decoding, and output without transcoding. No librespot, YouTube audio matching, or terminal windows are required for normal playback.

> **💡 Background & Target Audience**  
> This plugin is specifically designed for users who **cannot use librespot** due to [librespot-org/librespot#1649](https://github.com/librespot-org/librespot/issues/1649) and ongoing breaking protocol changes by Spotify. Instead of relying on reverse-engineered protocols that frequently break, Soloist is an official standalone playback engine provided directly by Spotify—offering a stable, compliant, and bit-perfect streaming experience.

**Preview: Windows x64 only. A Spotify Premium account is required for setup and this plugin's Web API playback control.**

## Features

- **Official Native Audio Quality**: Audio is fetched, decoded, and output directly by Spotify Soloist with zero transcoding or third-party stream substitution.
- **Full Library & Playlist Management**: Browse personalized home recommendations, global search (tracks, albums, artists, playlists), your playlists, liked songs, and saved albums; create, rename, delete, and save playlists, add/remove tracks in batches, and reorder playlist tracks.
- **Rich Details & Bilingual Lyrics**: Dedicated album and artist pages (including artist follow/unfollow), with concurrent synchronized lyrics lookup across **LRCLIB, NetEase Cloud Music, and QQ Music**—prioritizing original + Chinese translation with in-memory caching.
- **Seamless Playback Controls**: Play, pause, resume, seek, adjust volume, and integrate smoothly with MyGo's playback queue.
- **Silent Background Warmup on Mount**: Automatically warms up Soloist silently in the background as soon as the plugin mounts (without stealing active playback from other devices) and restores saved Spotify Connect pairings, minimizing first-track cold-start latency.
- **Event-Driven Local State**: Synchronizes playback state in real time using local events, eliminating the need to poll Spotify's cloud API every second.
- **Dedicated Diagnostics Panel**: Built-in "Playback Status" page with clear connection diagnostics and status feedback.

## Installation & Setup

In MyGo Music, navigate to **Settings → Plugins → +** and enter:

```text
sounfury/mygo-music-spotify-soloist
```

[Install in MyGo Music](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)

> **Notice**: This repository distributes the plugin source code only. **The official Soloist executable must be obtained separately from Spotify.**

---

### 1. Place the official Soloist executable

1. Download the **x86_64 Windows** package from [Spotify's downloads page](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates).
2. Extract the archive to locate `soloist.exe`.
3. In MyGo Music, go to **Settings → Plugins → + → Show Plugins Folder**. Open `spotify-soloist`, create a `bin` folder if it does not already exist, and place the executable inside:

   ```text
   spotify-soloist/
     plugin.json
     index.js
     scripts/
     bin/
       soloist.exe
   ```

On a default Windows installation, the destination path is:

```text
%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe
```

---

### 2. Configure your personal Soloist API key

1. Generate your personal API key from the [Spotify Soloist dashboard](https://developer.spotify.com/dashboard/soloist). (Note: **This key is distinct from the Web API Client ID in the next step**).
2. **Recommended (directly in MyGo settings)**: Open **Settings → Plugins → Spotify Soloist**, paste your key into the masked **Soloist API Key** field, and save. Updating the key automatically restarts Soloist in the background—no PowerShell script or manual plugin reload required.
3. **Optional (Windows DPAPI script)**: If you prefer Windows DPAPI-encrypted storage outside MyGo's settings, leave **Soloist API Key** blank and run:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
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

| Data | Storage Location |
| --- | --- |
| Spotify Web API tokens & plugin settings (including UI-configured key) | MyGo's `plugin-data/spotify-soloist` directory |
| Soloist pairing & audio cache (shared across both key modes) | `%LOCALAPPDATA%\soloist\{data,cache}` |
| Encrypted Soloist Key (optional DPAPI script mode only) | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` |

- **Process Isolation**: Only one Soloist process may access the data directory at a time. Existing pairings in the default location are preserved and reused. Signing out of the Web API account does not erase the separate Soloist device pairing.
- **Security Notice**: While the stored key is encrypted via Windows DPAPI, Soloist currently requires the key to be passed via process command-line arguments, meaning local process monitoring tools may observe it. Avoid sharing raw command-line invocations, unredacted logs, or session folders. Spotify Web API tokens are securely stored in MyGo's local plugin storage. No user credentials or API keys are bundled with this repository.
- **System Invocation & Network**: OAuth PKCE runs in pure JavaScript inside the plugin sandbox, so signing in to your library requires no child process. `bin/soloist.exe` is spawned for audio playback, and `powershell.exe` is only invoked if **Soloist API Key** is left blank in plugin settings and the optional DPAPI script is used. Soloist binds its local control interface strictly to `127.0.0.1` using an automatically assigned port. When fetching bilingual synchronized lyrics, only public track metadata (title, artist, album, and duration) is sent to LRCLIB (`lrclib.net`), NetEase Cloud Music (`music.163.com`), and QQ Music (`c.y.qq.com`, `u.y.qq.com`).

## Limitations & Updates

- **Platform Support**: This preview currently supports Windows x64 only. Podcasts and automatic Soloist binary updates are not yet implemented.
- **Development Mode Limits**: Standard Spotify Development Mode restrictions apply, such as inaccessible editorial recommendations and limited access to playlists you neither own nor collaborate on.
- **Playback Queue**: The queue dispatches up to 100 tracks per batch directly to Soloist via the Spotify Web API. Subsequent queue context is managed by MyGo without generating temporary cloud playlists.
- **Native Audio Rendering**: Audio decoding and output are handled entirely by the Soloist engine. MyGo's built-in software normalization, equalizer, and format settings do not apply to the external player.
- **90-Day Build Expiry**: Official Spotify Soloist preview builds expire **90 days after their build date**. Before expiration, quit MyGo and replace `bin/soloist.exe` with a fresh build from Spotify's download portal. The plugin displays an alert when a build has expired.
- **Plugin Updates**: Updating the plugin in MyGo may replace the entire plugin folder, including any locally added `bin/soloist.exe`. If the binary is removed after an update, simply copy `soloist.exe` back into `bin/`. Encrypted keys and device pairings are saved outside the plugin folder and remain intact.

## Troubleshooting

- **Cannot start helper program**: Verify that `bin/soloist.exe` exists in the plugin directory and ensure "Allow program execution" is checked in MyGo's plugin settings.
- **Prompted to save Soloist API key first**: Ensure the setup command was run in PowerShell under the same Windows user account running MyGo. Restart or re-enable the plugin after updating the key.
- **Waiting for pairing / endless connection attempt**: Ensure your phone and PC are on the exact same local Wi-Fi / LAN subnet. Try selecting `MyGo Soloist` in the mobile Spotify app's device list. Multiple network adapters, virtual VPN interfaces, or strict firewall policies can disrupt multicast discovery.
- **Paired but device is not visible to this account**: Verify that both the plugin Web API sign-in and the mobile Spotify app use the identical Spotify account. Allow a few seconds after cold boot for device registration.
- **Playback volume is low or inaudible**: Soloist device volume, the Windows volume mixer slider for MyGo, and the master system output volume each take effect independently. Check all three.
- **Instance already running**: If you previously launched Soloist manually, stop the manual process before letting the plugin manage it. Keeping the default data directory preserves your existing pairing.

## Development & Testing

See [AGENTS.md](AGENTS.md) for project background, runtime constraints, and architecture details.

`index.js` executes within MyGo's plugin runtime environment (not standard Node.js). `scripts/soloist-host.ps1` handles Windows DPAPI key storage and PKCE entropy generation. Regression tests cover the local playback state machine, queue generation preemption, artist page pagination/fallback, tri-source bilingual lyrics matching & decoding, and mount-time background warmup using mocked host interfaces without real Spotify credentials:

```bash
node --check index.js
node --test tests/plugin.test.cjs
```

Local verification includes Soloist cold start, pairing restoration, Spotify catalog browsing, direct queue playback, playback controls (pause/resume/seek/volume), and verified audio output via MyGo. Other operating systems or custom account setups require independent validation.

Installing does not require GitHub Releases: MyGo installs directly from the latest commit on the default branch. The repository uses the `mygo-music-plugin` topic for automatic discovery on the [MyGo Plugin Directory](https://mygo-music.egoist.dev/plugins).

## License

This plugin's original source code is released under the [MIT](LICENSE) License. Spotify Soloist binaries are neither hosted nor distributed here and are subject to Spotify's terms of service. This project is not officially affiliated with or endorsed by Spotify or MyGo Music.
