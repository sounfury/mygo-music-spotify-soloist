// Independent MyGo Music integration: Spotify Web API catalog + official Soloist playback.
const API = "https://api.spotify.com/v1";
const AUTH = "https://accounts.spotify.com";
const REDIRECT = "http://127.0.0.1:43110/callback";
const SCOPES = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-recently-played user-top-read user-library-read user-library-modify playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public";
const t = text => host.t(text);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function problem(code, message) { return Object.assign(new Error(t(message)), { code }); }

async function processResult(program, args, timeout = 15000) {
  let p;
  try { p = host.spawn(program, args); }
  catch (e) {
    if (/allowed|permission/i.test(e.message)) throw problem("setup", "Allow Spotify Soloist to start programs in its plugin settings.");
    throw problem("setup", "Could not start the Soloist helper. Reinstall this plugin and its local Soloist executable.");
  }
  p.closeStdin();
  let expired = false;
  const timer = setTimeout(() => { expired = true; p.kill(); }, timeout);
  try {
    const lines = [];
    for (let line; (line = await p.readLine()) !== null;) lines.push(line);
    const code = await p.wait();
    if (expired) throw new Error(t("Soloist command timed out."));
    return { code, output: lines.join("\n"), error: p.errorOutput() };
  } finally { clearTimeout(timer); }
}
async function helper(action) {
  const r = await processResult("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${host.dir}/scripts/soloist-host.ps1`, "-Action", action]);
  if (r.code !== 0) throw problem("setup", "Save your Soloist API key with the local setup script first.");
  try { return JSON.parse(r.output); } catch { throw new Error(t("The Soloist helper returned an invalid response.")); }
}
function clientId() {
  const id = (host.setting("clientId") || "").trim();
  if (!id) throw problem("setup", "Enter your Spotify Client ID in the plugin settings.");
  return id;
}
async function timedFetch(url, options, deadline = Date.now() + 8000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(1, deadline - Date.now()));
  try {
    const response = await fetch(url, { ...options, signal: abort.signal });
    const text = await response.text();
    return { response, text };
  } finally { clearTimeout(timer); }
}
async function tokens(params) {
  const { response: r, text } = await timedFetch(`${AUTH}/api/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId(), ...params }).toString() });
  let value; try { value = JSON.parse(text); } catch { throw new Error("Invalid Spotify authorization response"); }
  if (!r.ok) {
    if (value.error === "invalid_grant") host.storage.remove("session");
    throw problem("signIn", "Spotify authorization expired or was refused. Sign in again.");
  }
  return value;
}
function saveTokens(value, previous = {}) {
  const session = { access: value.access_token, refresh: value.refresh_token || previous.refresh, expiresAt: Date.now() + value.expires_in * 1000 };
  host.storage.set("session", session);
  return session;
}
let refreshing = null;
async function access(force = false) {
  let s = host.storage.get("session");
  if (!s) throw problem("signIn", "Sign in to Spotify to load your music library.");
  if (force || s.expiresAt < Date.now() + 60000) {
    if (!refreshing) refreshing = tokens({ grant_type: "refresh_token", refresh_token: s.refresh }).then(v => saveTokens(v, s)).finally(() => { refreshing = null; });
    s = await refreshing;
  }
  return s.access;
}
async function api(method, path, body, query, deadline = Date.now() + 12000) {
  const url = new URL(path.startsWith("https://") ? path : API + path);
  if (url.origin !== "https://api.spotify.com") throw new Error("Unexpected Spotify API origin");
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(key, String(value));
  let r, text;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await access(attempt > 0);
    if (Date.now() >= deadline) throw new Error(t("Spotify request timed out. Try again."));
    const result = await timedFetch(url.href, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, deadline);
    r = result.response; text = result.text;
    if (r.status !== 401) break;
  }
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    if (r.status === 401) { host.storage.remove("session"); throw problem("signIn", "Sign in to Spotify again."); }
    if (r.status === 429) throw new Error(t("Spotify is limiting requests. Try again later."));
    const e = new Error(data?.error?.message || `Spotify HTTP ${r.status}`); e.status = r.status; throw e;
  }
  return data;
}
export async function signIn() {
  const id = clientId();
  const pkce = await helper("pkce");
  const back = host.waitForRedirect({ port: 43110, path: "/callback", timeout: 180000, page: "Signed in to Spotify Soloist. You can close this page." });
  host.signInPrompt({ text: t("Approve Spotify library access in your browser. Soloist pairing is separate.") });
  host.openURL(`${AUTH}/authorize?${new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: REDIRECT, scope: SCOPES, state: pkce.state, code_challenge_method: "S256", code_challenge: pkce.challenge })}`);
  const answer = await back;
  if (answer.state !== pkce.state || !answer.code) throw new Error(t("Spotify sign-in was cancelled or could not be verified."));
  saveTokens(await tokens({ grant_type: "authorization_code", code: answer.code, redirect_uri: REDIRECT, code_verifier: pkce.verifier }));
  return account();
}
export function signOut() { host.storage.remove("session"); host.storage.remove("me"); }
export function setSetting({ key }) { if (key === "clientId") signOut(); }
export async function account() {
  if (!host.storage.get("session")) return null;
  const me = await api("GET", "/me"); host.storage.set("me", me.id);
  return { id: me.id, name: me.display_name || me.id, imageUrl: image(me.images), page: "soloist" };
}
const image = items => items?.[0]?.url;
const artistMap = a => a && ({ id: a.id, name: a.name, imageUrl: image(a.images) });
const albumMap = a => a && ({ id: a.id, name: a.name, imageUrl: image(a.images), artists: (a.artists || []).map(artistMap), released: a.release_date });
function track(v, parent) {
  if (!v?.id || v.type === "episode") return null;
  return { id: v.id, name: v.name, artists: (v.artists || []).map(artistMap), album: albumMap(parent || v.album) || { id: "", name: "" }, duration: v.duration_ms || 0, url: v.external_urls?.spotify, unavailable: v.is_playable === false };
}
function playlistMap(p) {
  if (!p) return null;
  const mine = p.owner?.id === host.storage.get("me") || !!p.collaborative;
  return { id: p.id, name: p.name, imageUrl: image(p.images), description: p.description, owner: p.owner?.display_name, trackCount: (p.items || p.tracks)?.total || 0, mine, saved: !mine };
}
async function all(path, query, pick, maxPages = 30) {
  const out = [];
  for (let count = 0; path && count < maxPages; count++) {
    const page = await api("GET", path, undefined, count ? undefined : query);
    out.push(...(page.items || []).map(pick).filter(Boolean)); path = page.next;
  }
  return out;
}
export async function search({ query, kind, offset = 0 }) {
  const map = { tracks: track, albums: albumMap, artists: artistMap, playlists: playlistMap };
  if (!map[kind]) return { more: false };
  const result = await api("GET", "/search", undefined, { q: query, type: kind.slice(0, -1), limit: 10, offset });
  const page = result[kind]; return { [kind]: (page?.items || []).map(v => map[kind](v)).filter(Boolean), more: !!page?.next };
}
export async function recent() {
  if (!host.storage.get("session")) return [];
  const page = await api("GET", "/me/player/recently-played", undefined, { limit: 30 });
  return [...new Map(page.items.map(v => track(v.track)).filter(Boolean).map(v => [v.id, v])).values()];
}
export async function home() {
  const [played, top, saved] = await Promise.all([recent(), api("GET", "/me/top/tracks", undefined, { limit: 20 }), savedAlbums({ offset: 0 })]);
  return { title: "Spotify Soloist", sections: [{ title: t("Recently Played"), tracks: played }, { title: t("Your Top Tracks"), tracks: top.items.map(v => track(v)).filter(Boolean) }, { title: t("Saved Albums"), albums: saved.albums }] };
}
export async function playlists() {
  if (!host.storage.get("session")) return [];
  return all("/me/playlists", { limit: 50 }, playlistMap);
}
export async function playlist({ id }) {
  const meta = await api("GET", `/playlists/${encodeURIComponent(id)}`);
  const tracks = await all(`/playlists/${encodeURIComponent(id)}/items`, { limit: 50 }, v => track(v.item || v.track));
  return { ...playlistMap(meta), tracks, trackCount: tracks.length };
}
export async function album({ id }) {
  const a = await api("GET", `/albums/${encodeURIComponent(id)}`);
  const rest = a.tracks.next ? await all(a.tracks.next, undefined, v => track(v, a)) : [];
  return { album: albumMap(a), tracks: [...a.tracks.items.map(v => track(v, a)).filter(Boolean), ...rest] };
}
export async function artist({ id }) {
  const a = await api("GET", `/artists/${encodeURIComponent(id)}`);
  const [records, found] = await Promise.all([all(`/artists/${encodeURIComponent(id)}/albums`, { limit: 20, include_groups: "album,single" }, albumMap, 5), api("GET", "/search", undefined, { q: `artist:"${a.name}"`, type: "track", limit: 10 })]);
  return { artist: artistMap(a), albums: records, tracks: found.tracks.items.filter(v => v.artists?.some(x => x.id === id)).map(v => track(v)).filter(Boolean) };
}
export async function liked({ offset = 0 }) {
  const page = await api("GET", "/me/tracks", undefined, { offset, limit: 50 });
  return { tracks: page.items.map(v => track(v.track)).filter(Boolean), more: !!page.next };
}
export async function isLiked({ ids }) {
  const result = {};
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const saved = await api("GET", "/me/library/contains", undefined, { uris: batch.map(id => `spotify:track:${id}`).join(",") });
    batch.forEach((id, n) => { result[id] = !!saved[n]; });
  }
  return result;
}
export async function like({ id, on }) { await api(on ? "PUT" : "DELETE", "/me/library", undefined, { uris: `spotify:track:${id}` }); }
export async function savedAlbums({ offset = 0 }) {
  const page = await api("GET", "/me/albums", undefined, { limit: 30, offset });
  return { albums: page.items.map(v => ({ ...albumMap(v.album), saved: true })), more: !!page.next };
}
export async function saveAlbum({ id, on }) { await api(on ? "PUT" : "DELETE", "/me/library", undefined, { uris: `spotify:album:${id}` }); }
export async function lyrics({ id }) {
  const v = await api("GET", `/tracks/${encodeURIComponent(id)}`);
  const params = new URLSearchParams({ track_name: v.name, artist_name: v.artists[0]?.name || "", album_name: v.album?.name || "", duration: String(Math.round(v.duration_ms / 1000)) });
  const { response: r, text } = await timedFetch(`https://lrclib.net/api/get?${params}`); if (!r.ok) return {};
  const data = JSON.parse(text); return data.syncedLyrics ? { lrc: data.syncedLyrics } : {};
}

// The desktop app owns these child processes; MyGo hides their Windows consoles.
const EXE = "bin/soloist.exe";
let configPromise = null, startPromise = null, daemon = null, watcher = null;
let authState = null, playback = null, anchoredAt = 0, backendError = null;
const config = () => configPromise ||= helper("config").catch(e => { configPromise = null; throw e; });
function onEvent(e) {
  switch (e.type) {
    case "auth_state": authState = e; if (!e.logged_in) playback = null; break;
    case "playback_state": playback = e; anchoredAt = Date.now(); break;
    case "track_changed": if (playback) { playback.item = e.item; playback.position = { position_ms: 0, speed: playback.status === "playing" ? 1 : 0 }; anchoredAt = Date.now(); } break;
    case "playback_changed": if (playback) { anchorPosition(); playback.status = e.status; playback.position.speed = e.status === "playing" ? 1 : 0; } break;
    case "position_sync": if (playback) { playback.position = e.position; anchoredAt = Date.now(); } break;
    case "volume_changed": if (playback) playback.volume = e.volume; break;
    case "device_changed": if (authState) Object.assign(authState, { is_active: e.is_active, device_name: e.device_name }); if (playback) playback.is_active = e.is_active; break;
  }
}
function positionNow() {
  if (!playback) return 0;
  const p = playback.position || {};
  const duration = playback.item?.decorations?.playback?.duration_ms || Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(duration, (p.position_ms || 0) + Math.max(0, Date.now() - anchoredAt) * (p.speed || 0)));
}
function anchorPosition() { if (playback) { playback.position = { ...playback.position, position_ms: positionNow() }; anchoredAt = Date.now(); } }
async function watch(c) {
  if (watcher) return;
  const p = host.spawn(EXE, ["ctl", "trace", "-D", c.dataDir]); watcher = p; p.closeStdin();
  (async () => {
    try {
      for (let line; (line = await p.readLine()) !== null;) {
        const at = line.indexOf("{"); if (at < 0) continue;
        try { onEvent(JSON.parse(line.slice(at))); } catch {}
      }
    } finally { if (watcher === p) { watcher = null; authState = null; playback = null; } }
  })().catch(() => {});
}
async function ctl(args, timeout) {
  const c = await config(); const r = await processResult(EXE, ["ctl", ...args, "-D", c.dataDir], timeout);
  if (r.code) throw new Error(r.code === 3 ? t("Pair MyGo Soloist from the Spotify app on your phone first.") : t("Soloist could not complete the command. Check the Playback Status page."));
  return r.output;
}
async function ensureSoloist() {
  if (watcher && authState) return authState;
  if (startPromise) return startPromise;
  startPromise = (async () => {
    backendError = null;
    if (host.platform !== "windows") throw problem("setup", "This preview currently supports Windows x64 only.");
    const c = await config();
    const status = await processResult(EXE, ["ctl", "status", "-D", c.dataDir], 6000);
    if (status.code !== 0 || !/running \(pid/.test(status.output)) {
      authState = null; playback = null; backendError = null;
      const p = host.spawn(EXE, ["--device-name", "MyGo Soloist", "--api-key", c.key, "--data-dir", c.dataDir, "--cache-dir", c.cacheDir, "--cache-size", "512", "--ws", "127.0.0.1:0"]);
      daemon = p; p.closeStdin();
      // Drain stdout so the host's reader never blocks. Do not log credentials.
      (async () => { while (await p.readLine() !== null) {} })().catch(() => {});
      p.wait().then(code => {
        if (daemon !== p) return;
        daemon = null; authState = null; playback = null;
        backendError = code === 10 ? problem("setup", "Soloist expired. Download a new Windows build from Spotify.") : new Error(t("Soloist stopped. Check its installation, API key and pairing."));
      });
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        if (backendError) throw backendError;
        const r = await processResult(EXE, ["ctl", "status", "-D", c.dataDir], 3000);
        if (r.code === 0 && /running \(pid/.test(r.output)) break;
        await delay(250);
      }
    }
    const until = Date.now() + 10000;
    while (!authState && Date.now() < until && !backendError) {
      if (!watcher) await watch(c);
      await delay(200);
    }
    if (backendError) throw backendError;
    if (!authState) throw new Error(t("Soloist did not provide its local connection state."));
    return authState;
  })().finally(() => { startPromise = null; });
  return startPromise;
}
async function ready() {
  const state = await ensureSoloist();
  if (!state.logged_in) throw problem("setup", "Select MyGo Soloist in the Spotify app on your phone to pair this computer, then play again.");
}
export async function browse({ page }) {
  if (page !== "soloist") return { title: "Spotify Soloist", sections: [] };
  let description;
  try {
    const a = await ensureSoloist();
    description = a.logged_in ? t("Paired and ready. Soloist runs without a terminal window when started by this plugin.") : t("Waiting for pairing: select MyGo Soloist in the Spotify app on your phone.");
  } catch (e) { description = e.message; }
  return { title: t("Playback Status"), description, sections: [{ title: t("Official Spotify audio"), empty: t("Soloist handles playback. Use MyGo Music to select songs and control playback. Keep this local API bound to 127.0.0.1.") }] };
}
// Spotify accepts URI lists for Soloist, preserving MyGo's queue without creating playlists.
let queueJob = Promise.resolve();
let playGeneration = 0;
export async function remotePlay({ ids, start = 0, position = 0 }) {
  const generation = ++playGeneration;
  const deadline = Date.now() + 25000;
  const current = () => generation === playGeneration && Date.now() < deadline;
  const run = async () => {
    if (!current()) return;
    await ready();
    if (!current()) return;
    const selected = ids.slice(start, start + 100); if (!selected.length) return;
    await ctl(["activate"], 4000);
    let device;
    const visibleUntil = Math.min(deadline - 5000, Date.now() + 8000);
    do {
      const list = await api("GET", "/me/player/devices", undefined, undefined, Math.min(deadline - 3000, Date.now() + 4000));
      device = list.devices.find(d => d.name === authState.device_name && d.id && !d.is_restricted);
      if (device || !current()) break;
      await delay(500);
    } while (Date.now() < visibleUntil);
    if (!device) throw new Error(t("Soloist is paired but not visible to this Spotify account. Check that both sign-ins use the same account."));
    await ctl(["shuffle", "off"], 4000); await ctl(["repeat", "off"], 4000);
    if (!current()) return;
    await api("PUT", "/me/player/play", { uris: selected.map(id => "spotify:track:" + id), offset: { position: 0 }, position_ms: Math.max(0, Math.round(position)) }, { device_id: device.id }, deadline);
  };
  const result = queueJob.then(run); queueJob = result.catch(() => {}); return result;
}
export async function remotePause() { ++playGeneration; await ready(); await ctl(["pause"]); }
export async function remoteResume() { await ready(); await ctl(["activate"]); await ctl(["play"]); }
export async function remoteSeek({ position }) { await ready(); await ctl(["seek", String(Math.max(0, Math.round(position)))]); }
export async function remoteVolume({ percent }) { await ready(); await ctl(["volume", String(Math.max(0, Math.min(100, Math.round(percent))))]); }
export async function remoteState() {
  await ready(); if (!playback || !playback.is_active) return null;
  return { playing: playback.status === "playing" || playback.status === "buffering", trackId: playback.item?.uri?.replace(/^spotify:track:/, "") || "", position: positionNow(), duration: playback.item?.decorations?.playback?.duration_ms || 0, volume: playback.volume || 0, device: authState?.device_name || "MyGo Soloist" };
}
export async function remoteDevices() { const a = await ensureSoloist(); return [{ id: "soloist", name: a.device_name || "MyGo Soloist", active: !!a.is_active }]; }
export async function remoteUse({ deviceId }) { if (deviceId !== "soloist") throw new Error("Unknown Soloist device"); await ready(); await ctl(["activate"]); }
