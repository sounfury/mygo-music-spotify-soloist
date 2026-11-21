// Independent MyGo Music integration: Spotify Web API catalog + official Soloist playback.
// --- Auth & Spotify Web API ---
const API = "https://api.spotify.com/v1";
const AUTH = "https://accounts.spotify.com";
const REDIRECT = "http://127.0.0.1:43110/callback";
const SCOPES = "user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-recently-played user-top-read user-library-read user-library-modify user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public";
const t = text => host.t(text);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function problem(code, message) { return Object.assign(new Error(t(message)), { code }); }

// Pure JS PKCE (RFC 7636) with FIPS 180-4 SHA-256 so signIn needs no child process.
const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function utf8Bytes(text) {
  const s = String(text || "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00); i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}
function sha256Bytes(input) {
  const src = input instanceof Uint8Array ? input : utf8Bytes(input);
  const len = src.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const msg = new Uint8Array(total);
  msg.set(src);
  msg[len] = 0x80;
  const bitLen = len * 8;
  const hi = Math.floor(bitLen / 0x100000000) >>> 0;
  const lo = bitLen >>> 0;
  msg[total - 8] = (hi >>> 24) & 0xff; msg[total - 7] = (hi >>> 16) & 0xff;
  msg[total - 6] = (hi >>> 8) & 0xff; msg[total - 5] = hi & 0xff;
  msg[total - 4] = (lo >>> 24) & 0xff; msg[total - 3] = (lo >>> 16) & 0xff;
  msg[total - 2] = (lo >>> 8) & 0xff; msg[total - 1] = lo & 0xff;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const digest = new Uint8Array(32);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = (words[i] >>> 24) & 0xff;
    digest[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    digest[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    digest[i * 4 + 3] = words[i] & 0xff;
  }
  return digest;
}
function toBase64Url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    if (has1) out += B64URL_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
    if (has2) out += B64URL_ALPHABET[b2 & 63];
  }
  return out;
}
let entropyCounter = 0;
function randomBytes(size) {
  const out = new Uint8Array(size);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(out);
  }
  for (let off = 0; off < size; off += 32) {
    const seed = `${Date.now()}:${++entropyCounter}:${Math.random()}:${Math.random()}:${Math.random()}`;
    const block = sha256Bytes(seed);
    out.set(block.subarray(0, Math.min(32, size - off)), off);
  }
  return out;
}
function createPkce() {
  const verifier = toBase64Url(randomBytes(48));
  const state = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(sha256Bytes(verifier));
  return { verifier, state, challenge };
}

function spawnProcess(program, args) {
  try { return host.spawn(program, args); }
  catch (e) {
    const msg = String(e?.message || "");
    if (/allowed|permission|grant/i.test(msg)) throw problem("setup", "Allow Spotify Soloist to start programs in its plugin settings.");
    if (/soloist(?:\.exe)?$/i.test(String(program || "")) && /no such file|cannot find|not found|enoent|executable file not found/i.test(msg)) {
      throw problem("setup", "bin/soloist.exe was not found. Download Spotify Soloist and place it in the plugin's bin folder.");
    }
    throw problem("setup", "Could not start the Soloist helper. Reinstall this plugin and its local Soloist executable.");
  }
}
async function processResult(program, args, timeout = 15000) {
  const p = spawnProcess(program, args);
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
  if (r.code !== 0) throw problem("setup", "Enter your Soloist API Key in the plugin settings, or save it with scripts/soloist-host.ps1.");
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
  } catch (e) {
    if (abort.signal.aborted || e?.name === "AbortError") throw Object.assign(new Error(t("Spotify request timed out. Try again.")), { code: "timeout" });
    throw e;
  } finally { clearTimeout(timer); }
}
let authGeneration = 0;
let refreshing = null;
async function tokens(params, generation = authGeneration) {
  const { response: r, text } = await timedFetch(`${AUTH}/api/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId(), ...params }).toString() });
  let value; try { value = JSON.parse(text); } catch { throw new Error(t("Invalid Spotify authorization response. Sign in again.")); }
  if (!r.ok) {
    if (value.error === "invalid_grant" && generation === authGeneration) host.storage.remove("session");
    throw problem("signIn", "Spotify authorization expired or was refused. Sign in again.");
  }
  return value;
}
function saveTokens(value, previous = {}, generation = authGeneration) {
  if (generation !== authGeneration) throw problem("signIn", "Sign in to Spotify to load your music library.");
  const session = { access: value.access_token, refresh: value.refresh_token || previous.refresh, expiresAt: Date.now() + value.expires_in * 1000 };
  host.storage.set("session", session);
  return session;
}
async function access(force = false) {
  const generation = authGeneration;
  let s = host.storage.get("session");
  if (!s) throw problem("signIn", "Sign in to Spotify to load your music library.");
  if (force || s.expiresAt < Date.now() + 60000) {
    if (!refreshing || refreshing.generation !== generation) {
      const pending = tokens({ grant_type: "refresh_token", refresh_token: s.refresh }, generation)
        .then(v => saveTokens(v, s, generation))
        .finally(() => { if (refreshing?.promise === pending) refreshing = null; });
      refreshing = { generation, promise: pending };
    }
    s = await refreshing.promise;
    if (generation !== authGeneration) throw problem("signIn", "Sign in to Spotify to load your music library.");
  }
  return s.access;
}
async function api(method, path, body, query, deadline = Date.now() + 12000) {
  const url = new URL(path.startsWith("https://") ? path : API + path);
  if (url.origin !== "https://api.spotify.com") throw new Error("Unexpected Spotify API origin");
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(key, String(value));
  const generation = authGeneration;
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
    if (r.status === 401) { if (generation === authGeneration) host.storage.remove("session"); throw problem("signIn", "Sign in to Spotify again."); }
    if (r.status === 403 && data?.error?.reason === "PREMIUM_REQUIRED") throw new Error(t("A Spotify Premium account is required for playback control."));
    if (r.status === 429) throw new Error(t("Spotify is limiting requests. Try again later."));
    const e = new Error(data?.error?.message || `Spotify HTTP ${r.status}`); e.status = r.status; throw e;
  }
  return data;
}
export async function signIn() {
  const id = clientId();
  const pkce = createPkce();
  const back = host.waitForRedirect({ port: 43110, path: "/callback", timeout: 180000, page: "Signed in to Spotify Soloist. You can close this page." });
  host.signInPrompt({ text: t("Approve Spotify library access in your browser. Soloist pairing is separate.") });
  host.openURL(`${AUTH}/authorize?${new URLSearchParams({ client_id: id, response_type: "code", redirect_uri: REDIRECT, scope: SCOPES, state: pkce.state, code_challenge_method: "S256", code_challenge: pkce.challenge })}`);
  const answer = await back;
  if (answer.state !== pkce.state || !answer.code) throw new Error(t("Spotify sign-in was cancelled or could not be verified."));
  const generation = ++authGeneration;
  refreshing = null;
  saveTokens(await tokens({ grant_type: "authorization_code", code: answer.code, redirect_uri: REDIRECT, code_verifier: pkce.verifier }, generation), {}, generation);
  warmupSoloist();
  return account();
}
export function signOut() {
  ++authGeneration;
  ++playGeneration;
  refreshing = null;
  host.storage.remove("session");
  host.storage.remove("me");
}
export function setSetting({ key, value }) {
  if (key === "clientId") signOut();
  if (key === "soloistApiKey") {
    stopSoloist();
    if (String(value || "").trim()) warmupSoloist();
  }
}
export async function account() {
  if (!host.storage.get("session")) return null;
  const me = await api("GET", "/me"); host.storage.set("me", me.id);
  return { id: me.id, name: me.display_name || me.id, imageUrl: image(me.images), page: "soloist" };
}
// --- Catalog Mapping & Library Endpoints ---
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
  const encodedId = encodeURIComponent(id);
  const fetchAlbums = async () => {
    try {
      return await all(`/artists/${encodedId}/albums`, { limit: 10, include_groups: "album,single" }, albumMap, 10);
    } catch (e) {
      if (e.status !== 400) throw e;
      return all(`/artists/${encodedId}/albums`, { limit: 10 }, albumMap, 10);
    }
  };
  const checkFollowing = async () => {
    try {
      const saved = await api("GET", "/me/library/contains", undefined, { uris: `spotify:artist:${id}` });
      return !!saved?.[0];
    } catch { return false; }
  };
  const [a, records, following] = await Promise.all([api("GET", `/artists/${encodedId}`), fetchAlbums(), checkFollowing()]);
  const safeName = String(a.name || "").replace(/"/g, "").trim();
  const tracks = new Map();
  if (safeName) {
    for (const offset of [0, 10]) {
      const found = await api("GET", "/search", undefined, { q: `artist:"${safeName}"`, type: "track", limit: 10, offset });
      for (const item of found?.tracks?.items || []) {
        if (item?.id && item.artists?.some(x => x.id === id)) {
          const mapped = track(item);
          if (mapped) tracks.set(mapped.id, mapped);
        }
      }
      if (!found?.tracks?.next) break;
    }
  }
  return { artist: { ...artistMap(a), following }, albums: records, tracks: [...tracks.values()] };
}
export async function followArtist({ id, on }) { await api(on ? "PUT" : "DELETE", "/me/library", undefined, { uris: `spotify:artist:${id}` }); }
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
// --- Synchronized Bilingual Lyrics (LRCLIB + NetEase + QQ Music) ---
const LYRIC_TIMEOUT = 6000;
const LYRIC_DURATION_SLACK = 3000;
const LYRIC_CACHE_MAX = 100;
const LYRIC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const VARIANT_TAG = /\b(live|remix|cover|dj|instrumental|karaoke)\b|伴奏|纯音乐|翻唱/i;
const lyricsCache = new Map();

function hasTimestamps(lrc) { return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(String(lrc || "")); }
function cleanTrackTitle(name) {
  const raw = String(name || "").trim();
  const stripped = raw.replace(/\s+-\s+.*$/, "").replace(/\s*[([（【].*?[)\]）】]\s*/g, " ").replace(/\s+/g, " ").trim();
  return stripped || raw;
}
function normalizeMatchText(text) {
  return String(text || "").toLowerCase().replace(/[\s\-_.,!?'":;()[\]{}（）【】《》「」『』、。，！？·/\\]+/g, "");
}
function decodeBase64Utf8(input) {
  if (!input || typeof input !== "string") return "";
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    const c1 = B64_ALPHABET.indexOf(cleaned[i]);
    const c2 = B64_ALPHABET.indexOf(cleaned[i + 1]);
    if (c1 < 0 || c2 < 0) break;
    const c3 = cleaned[i + 2] === "=" ? -1 : B64_ALPHABET.indexOf(cleaned[i + 2]);
    const c4 = cleaned[i + 3] === "=" ? -1 : B64_ALPHABET.indexOf(cleaned[i + 3]);
    bytes.push((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) bytes.push(((c3 & 3) << 6) | c4);
  }
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++], b2 = bytes[i++];
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++], b2 = bytes[i++], b3 = bytes[i++];
      const cp = (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
      if (cp >= 0) out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}
function decodeHtmlEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? match;
  });
}
function cleanQqTranslation(raw) {
  return decodeHtmlEntities(raw)
    .split(/\r?\n/)
    .filter(line => !/^\[kana:[^\]]*\]\s*$/i.test(line))
    .filter(line => !/^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*\/\/\s*$/.test(line.trim()))
    .join("\n")
    .trim();
}
function pickBestSong(candidates, meta) {
  const wantedTitle = normalizeMatchText(cleanTrackTitle(meta.name));
  const wantedArtists = (meta.artists || []).map(normalizeMatchText).filter(Boolean);
  const targetIsVariant = VARIANT_TAG.test(meta.name || "");
  let best = null, bestScore = -Infinity;
  for (const item of candidates || []) {
    if (!item?.id) continue;
    const diff = meta.durationMs > 0 && item.durationMs > 0 ? Math.abs(item.durationMs - meta.durationMs) : 0;
    if (meta.durationMs > 0 && item.durationMs > 0 && diff > LYRIC_DURATION_SLACK) continue;
    let score = 1000 - diff / 10;
    const candTitle = normalizeMatchText(cleanTrackTitle(item.name));
    if (wantedTitle && candTitle) {
      if (candTitle === wantedTitle) score += 150;
      else if (candTitle.includes(wantedTitle) || wantedTitle.includes(candTitle)) score += 75;
    }
    const candArtists = (item.artists || []).map(normalizeMatchText).filter(Boolean);
    if (wantedArtists.some(wa => candArtists.some(ca => ca === wa || ca.includes(wa) || wa.includes(ca)))) score += 200;
    if (!targetIsVariant && VARIANT_TAG.test(item.name || "")) score -= 250;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best;
}
function pickBestLyrics({ lrclib, netease, qq }) {
  for (const candidate of [netease, qq]) {
    if (candidate?.lrc && candidate?.translation) return candidate;
  }
  for (const candidate of [lrclib, netease, qq]) {
    if (candidate?.lrc) return candidate;
  }
  return null;
}
async function fetchJson(url, options, deadline = Date.now() + LYRIC_TIMEOUT) {
  const { response: r, text } = await timedFetch(url, options, deadline);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text ? JSON.parse(text) : null;
}
async function fetchLrclibLyrics(meta) {
  const deadline = Date.now() + LYRIC_TIMEOUT;
  const headers = { "User-Agent": "mygo-music-spotify-soloist" };
  let entry = await fetchJson(`https://lrclib.net/api/get?${new URLSearchParams({
    track_name: meta.name,
    artist_name: meta.artists[0] || "",
    album_name: meta.album,
    duration: String(Math.round(meta.durationMs / 1000)),
  })}`, { headers }, deadline);
  if (!entry || !hasTimestamps(entry.syncedLyrics)) {
    const found = await fetchJson(`https://lrclib.net/api/search?${new URLSearchParams({
      track_name: cleanTrackTitle(meta.name),
      artist_name: meta.artists[0] || "",
    })}`, { headers }, deadline);
    const list = (Array.isArray(found) ? found : []).map(item => ({
      id: item?.id,
      name: item?.trackName || "",
      artists: item?.artistName ? [item.artistName] : [],
      durationMs: Number(item?.duration || 0) * 1000,
      raw: item,
    })).filter(item => hasTimestamps(item.raw?.syncedLyrics));
    entry = pickBestSong(list, meta)?.raw || entry;
  }
  const lrc = hasTimestamps(entry?.syncedLyrics) ? entry.syncedLyrics : "";
  return lrc ? { lrc, translation: "" } : null;
}
async function fetchNeteaseLyrics(meta) {
  const deadline = Date.now() + LYRIC_TIMEOUT;
  const headers = { Referer: "https://music.163.com/", "User-Agent": LYRIC_UA };
  const query = `${cleanTrackTitle(meta.name)} ${meta.artists[0] || ""}`.trim();
  const search = await fetchJson(`https://music.163.com/api/cloudsearch/pc?${new URLSearchParams({ s: query, type: "1", limit: "10" })}`, { headers }, deadline);
  const candidates = (search?.result?.songs || []).map(item => ({
    id: item?.id,
    name: item?.name || "",
    artists: (item?.ar || []).map(a => a?.name).filter(Boolean),
    durationMs: Number(item?.dt || 0),
  }));
  const matched = pickBestSong(candidates, meta);
  if (!matched) return null;
  const data = await fetchJson(`https://music.163.com/api/song/lyric?${new URLSearchParams({ id: String(matched.id), lv: "1", tv: "-1" })}`, { headers }, deadline);
  if (!data || Number(data.code) !== 200) return null;
  const lrc = hasTimestamps(data.lrc?.lyric) ? data.lrc.lyric : "";
  const translation = hasTimestamps(data.tlyric?.lyric) ? data.tlyric.lyric : "";
  return lrc ? { lrc, translation } : null;
}
async function fetchQqLyrics(meta) {
  const deadline = Date.now() + LYRIC_TIMEOUT;
  const headers = { Referer: "https://y.qq.com/", "User-Agent": LYRIC_UA };
  const query = `${cleanTrackTitle(meta.name)} ${meta.artists[0] || ""}`.trim();
  const search = await fetchJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${new URLSearchParams({ w: query, p: "1", n: "10", format: "json", cr: "1", new_json: "1" })}`, { headers }, deadline);
  const candidates = (search?.data?.song?.list || []).map(item => ({
    id: item?.mid,
    songId: item?.id,
    name: item?.name || item?.title || "",
    artists: (item?.singer || []).map(s => s?.name).filter(Boolean),
    durationMs: Number(item?.interval || 0) * 1000,
  }));
  const matched = pickBestSong(candidates, meta);
  if (!matched) return null;
  const data = await fetchJson("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      comm: { ct: 19, cv: 1859, uin: "0" },
      req: {
        module: "music.musichallSong.PlayLyricInfo",
        method: "GetPlayLyricInfo",
        param: { songID: matched.songId || 0, songMID: matched.id, trans: 1, roma: 0, lrc_t: 0, crypt: 0 },
      },
    }),
  }, deadline);
  const info = data?.req?.data;
  if (!info) return null;
  const rawLrc = decodeHtmlEntities(decodeBase64Utf8(info.lyric || "")).trim();
  const rawTrans = cleanQqTranslation(decodeBase64Utf8(info.trans || ""));
  const lrc = hasTimestamps(rawLrc) ? rawLrc : "";
  const translation = hasTimestamps(rawTrans) ? rawTrans : "";
  return lrc ? { lrc, translation } : null;
}
export async function lyrics({ id }) {
  const key = String(id || "");
  if (!key) return { lrc: "", translation: "" };
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const v = await api("GET", `/tracks/${encodeURIComponent(key)}`);
  if (!v) return { lrc: "", translation: "" };
  const meta = {
    name: v.name || "",
    artists: (v.artists || []).map(a => a?.name).filter(Boolean),
    album: v.album?.name || "",
    durationMs: Number(v.duration_ms || 0),
  };
  const [lrclib, netease, qq] = await Promise.allSettled([fetchLrclibLyrics(meta), fetchNeteaseLyrics(meta), fetchQqLyrics(meta)]);
  const chosen = pickBestLyrics({
    lrclib: lrclib.status === "fulfilled" ? lrclib.value : null,
    netease: netease.status === "fulfilled" ? netease.value : null,
    qq: qq.status === "fulfilled" ? qq.value : null,
  });
  const result = chosen ? { lrc: chosen.lrc, translation: chosen.translation || "" } : { lrc: "", translation: "" };
  if (chosen || (lrclib.status === "fulfilled" && netease.status === "fulfilled" && qq.status === "fulfilled")) {
    lyricsCache.set(key, result);
    while (lyricsCache.size > LYRIC_CACHE_MAX) lyricsCache.delete(lyricsCache.keys().next().value);
  }
  return result;
}

// The desktop app owns these child processes; MyGo hides their Windows consoles.
const EXE = "bin/soloist.exe";
let configPromise = null, startPromise = null, startGeneration = 0, daemon = null, watcher = null;
let authState = null, playback = null, anchoredAt = 0, backendError = null;
async function resolveConfig() {
  const directKey = (host.setting?.("soloistApiKey") || "").trim();
  if (directKey) {
    const base = String(host.dataDir || "").replace(/[\\/]+$/, "");
    if (!base) throw problem("setup", "Plugin data directory is unavailable. Restart MyGo Music and try again.");
    return { key: directKey, dataDir: `${base}/soloist/data`, cacheDir: `${base}/soloist/cache`, source: "setting" };
  }
  const c = await helper("config");
  return { ...c, source: "dpapi" };
}
const config = () => configPromise ||= resolveConfig().catch(e => { configPromise = null; throw e; });
function stopSoloist() {
  ++startGeneration;
  if (typeof playGeneration === "number") ++playGeneration;
  const oldWatcher = watcher, oldDaemon = daemon;
  startPromise = null; watcher = null; daemon = null; authState = null; playback = null; anchoredAt = 0; backendError = null; configPromise = null;
  try { oldWatcher?.kill?.(); } catch {}
  try { oldDaemon?.kill?.(); } catch {}
}
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
  const p = spawnProcess(EXE, ["ctl", "trace", "-D", c.dataDir]); watcher = p; p.closeStdin();
  (async () => {
    try {
      for (let line; (line = await p.readLine()) !== null;) {
        if (watcher !== p) break;
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
  const runId = startGeneration;
  const promise = (async () => {
    backendError = null;
    if (host.platform !== "windows") throw problem("setup", "This preview currently supports Windows x64 only.");
    const c = await config();
    if (runId !== startGeneration) throw new Error(t("Soloist configuration changed. Try again."));
    const status = await processResult(EXE, ["ctl", "status", "-D", c.dataDir], 6000);
    if (runId !== startGeneration) throw new Error(t("Soloist configuration changed. Try again."));
    if (status.code !== 0 || !/running \(pid/.test(status.output)) {
      authState = null; playback = null; backendError = null;
      const p = spawnProcess(EXE, ["--device-name", "MyGo Soloist", "--api-key", c.key, "--data-dir", c.dataDir, "--cache-dir", c.cacheDir, "--cache-size", "512", "--ws", "127.0.0.1:0"]);
      daemon = p; p.closeStdin();
      // Drain stdout so the host's reader never blocks. Do not log credentials.
      (async () => { while (await p.readLine() !== null) {} })().catch(() => {});
      p.wait().then(code => {
        if (daemon !== p) return;
        daemon = null; authState = null; playback = null;
        backendError = code === 10 ? problem("setup", "Soloist expired. Download a new Windows build from Spotify.") : new Error(t("Soloist stopped. Check its installation, API key and pairing."));
      });
      let started = false;
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        if (runId !== startGeneration) { try { p.kill?.(); } catch {} throw new Error(t("Soloist configuration changed. Try again.")); }
        if (backendError) throw backendError;
        const r = await processResult(EXE, ["ctl", "status", "-D", c.dataDir], 3000);
        if (r.code === 0 && /running \(pid/.test(r.output)) { started = true; break; }
        await delay(250);
      }
      if (!started) {
        if (daemon === p) daemon = null;
        try { p.kill?.(); } catch {}
        throw new Error(t("Soloist started but did not respond in time. Check your API key and local firewall."));
      }
    }
    const until = Date.now() + 10000;
    while (!authState && Date.now() < until && !backendError) {
      if (runId !== startGeneration) throw new Error(t("Soloist configuration changed. Try again."));
      if (!watcher) await watch(c);
      await delay(200);
    }
    if (runId !== startGeneration) throw new Error(t("Soloist configuration changed. Try again."));
    if (backendError) throw backendError;
    if (!authState) throw new Error(t("Soloist did not provide its local connection state."));
    return authState;
  })().finally(() => { if (startPromise === promise) startPromise = null; });
  startPromise = promise;
  return promise;
}
function warmupSoloist() {
  if (typeof host === "undefined" || host.platform !== "windows") return;
  ensureSoloist().catch(() => {});
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

// Start Soloist in the background as soon as MyGo mounts this plugin runtime.
if (typeof setTimeout === "function") setTimeout(warmupSoloist, 0);
