# Spotify Soloist for MyGo Music

[简体中文](README.zh-CN.md) · English

A Windows x64 plugin for [MyGo Music](https://github.com/egoist/mygo-music) that plays Spotify audio through the official [Spotify Soloist](https://developer.spotify.com/documentation/soloist) client. Spotify Web API supplies the library; Soloist handles audio without transcoding. No librespot, YouTube matching, or visible terminal is needed for normal playback.

**Preview: Windows x64 only. A Spotify Premium account is required for setup and this plugin's Web API playback control.**

## Features

- Home, track/album/artist/playlist search, playlists, liked songs and saved albums.
- Albums, artist pages and timed lyrics from LRCLIB when available.
- Play, pause, resume, seek, volume and MyGo's playback queue.
- Starts Soloist in the background and reuses its saved Spotify Connect pairing.
- Local event-driven playback state instead of polling Spotify Web API every second.
- Playback Status page and Simplified Chinese interface messages.

## Install

In MyGo Music, open **Settings → Plugins → +** and enter:

```text
sounfury/mygo-music-spotify-soloist
```

[Install in MyGo Music](mygo-music://install-plugin?repo=sounfury/mygo-music-spotify-soloist)

This repository distributes the plugin source only. **Soloist itself must be downloaded separately from Spotify.**

### 1. Install the official Soloist executable

1. Download **x86_64 Windows** from [Spotify's downloads page](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates).
2. Extract `soloist.exe`.
3. In MyGo Music, use **Settings → Plugins → + → Show Plugins Folder**. Open `spotify-soloist`, create a `bin` folder if necessary, and put the executable inside it:

   ```text
   spotify-soloist/
     plugin.json
     index.js
     scripts/
     bin/
       soloist.exe
   ```

On a default Windows installation, the destination is:

```text
%APPDATA%\MyGo Music\plugins\spotify-soloist\bin\soloist.exe
```

### 2. Save your personal Soloist API key

Generate your own key from the [Spotify Soloist dashboard](https://developer.spotify.com/dashboard/soloist). This is **different from the Web API Client ID** in the next step.

Run this in PowerShell for the default plugin location:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:APPDATA\MyGo Music\plugins\spotify-soloist\scripts\soloist-host.ps1" -Action setup
```

Paste the key into the hidden prompt and press Enter. If your plugin lives elsewhere, adjust the script path. The script encrypts the key with Windows DPAPI for the current Windows user. Do not send the key to another person or put it in a public issue.

### 3. Authorize the Spotify music library

1. Create or use your own app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard).
2. Add this exact redirect URI and enable Web API:

   ```text
   http://127.0.0.1:43110/callback
   ```

3. In **Settings → Plugins → Spotify Soloist**, enter that app's **Client ID**, allow the plugin to start programs, and click **Sign In**.
4. Approve the request in your normal browser. Spotify Development Mode may require adding the account under the app's **User Management**.

You do not need to enter a client secret. If you change the Client ID, sign in again.

### 4. Pair once, then play in MyGo

Select **Spotify Soloist** as the music source. Open **Playback Status** or play a song to start the background player.

For the first pairing, open Spotify's official app on a phone on the same LAN and select **MyGo Soloist** in its device picker. Soloist saves the session and restores it on later starts. You can then use MyGo for playback without keeping the official desktop client open.

When this plugin starts Soloist, MyGo hides its console and owns the child processes. Quitting MyGo or unloading the plugin stops those processes. If you already started Soloist manually with its local API enabled, the plugin can attach to it; it does not stop an attached process.

## Data and permissions

| Data | Location |
| --- | --- |
| Encrypted Soloist key | `%LOCALAPPDATA%\MyGoSoloist\soloist-key.xml` |
| Soloist pairing and persistent state | `%LOCALAPPDATA%\soloist\data` |
| Soloist audio cache | `%LOCALAPPDATA%\soloist\cache` |
| Spotify Web API tokens and plugin settings | MyGo's `plugin-data/spotify-soloist` directory |

Only one Soloist process may use the data directory at a time. Existing Soloist pairing at the default location is reused. Signing out of the plugin's Spotify Web API account does not remove the separate Soloist pairing.

Soloist currently requires its API key as a process argument, so local process inspection can reveal it even though the stored copy is encrypted. Avoid sharing full process command lines, unredacted logs or session directories. Spotify Web API tokens are stored by MyGo's plugin storage as local JSON. The key and tokens are never included in this repository.

The plugin asks to start `bin/soloist.exe` and `powershell.exe`; PowerShell runs the included key/PKCE helper. The local Soloist control endpoint binds to `127.0.0.1` with an automatically selected port. Track metadata is sent to LRCLIB to find lyrics.

## Limitations and updates

- Windows x64 only in this preview. Podcasts, playlist editing and automatic Soloist updates are not implemented.
- Spotify Development Mode restrictions still apply, including limited access to playlists you do not own or collaborate on and unavailable editorial/recommendation features.
- Playback queue windows contain up to 100 tracks, sent directly to Soloist through Spotify Web API. The plugin does not create a playback playlist.
- Playback quality follows Soloist. MyGo's audio decoding, normalization and quality settings do not configure this external player.
- Spotify's Soloist builds expire **90 days after their build date**. Quit MyGo and replace `bin/soloist.exe` with a newer official build before expiry. The plugin reports an expired build.
- A plugin update may replace its folder, including a locally added executable. If `bin/soloist.exe` is removed, copy the official executable back. The encrypted key and pairing are kept outside the plugin folder.

## Troubleshooting

- **Cannot start the helper:** check `bin/soloist.exe` exists and the plugin is allowed to start programs.
- **Save your Soloist API key first:** run the setup command under the same Windows user as MyGo. Restart or toggle the plugin after changing the key.
- **Waiting for pairing / connecting forever:** try the official Spotify app on a phone on the same LAN. Multiple network adapters, proxies or firewall rules may affect discovery.
- **Paired but not visible to this account:** the library authorization and Soloist pairing must use the same Spotify account. A cold start may take a few seconds to register.
- **Sound is quiet:** Soloist device volume, the Windows application mixer and the Windows output volume each affect loudness.
- **Already running:** stop any manual Soloist instance before asking the plugin to own it. Keep the default data directory to retain pairing.

## Development

`index.js` runs in MyGo's plugin runtime, not Node.js. `scripts/soloist-host.ps1` handles Windows DPAPI key access and cryptographically random PKCE material. Tests use mocked host interfaces and do not access a real account:

```bash
node --test tests/plugin.test.cjs
```

Local validation covered real Soloist cold startup, pairing restoration, Spotify catalog access, direct queue playback, pause/resume, seeking and volume. MyGo was also observed running this plugin's Soloist children and playing audio. New platform or account combinations still need their own verification.

No Release is required for installation: MyGo installs the latest default-branch commit. The repository uses the `mygo-music-plugin` topic for [plugin directory](https://mygo-music.egoist.dev/plugins) discovery.

## License

MIT for this independently implemented plugin source; see [LICENSE](LICENSE). Soloist binaries are not distributed here and have Spotify's own terms and notices. This project is not affiliated with or endorsed by Spotify or MyGo Music.
