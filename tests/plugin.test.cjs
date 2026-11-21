const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
function controller({ active = true, beforeReady, command, saved, onDelay } = {}) {
  let now = 1000;
  const commands = [], store = saved || new Map();
  const c = {
    Date: { now: () => now }, setTimeout, clearTimeout, t: s => s,
    delay: async ms => { now += ms; onDelay?.(api, ms); },
    host: { storage: { get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) } },
    readyImpl: async () => beforeReady?.(),
    ctlImpl: async args => {
      commands.push(Array.from(args));
      return command?.(args, api) ?? '';
    },
  };
  const sourceFrom = source.indexOf('const EXE = "bin/soloist.exe";');
  const code = source.slice(source.indexOf('function killProcess('),source.indexOf('async function helper(')) +
    source.slice(sourceFrom, source.indexOf('// Start Soloist in the background')).replaceAll('export async function','async function');
  vm.runInNewContext(code + `
    ready = readyImpl; ctl = ctlImpl; ensureSoloist = async () => authState;
    globalThis.api = { onEvent, positionNow, remotePlay, remoteResume, remotePause, remoteState, remoteSeek, remoteVolume, remoteUse, remoteDevices, browse, stopSoloist,
      get: () => playback, auth: () => authState, getError: () => lastPlaybackError, setError: playbackError, settled: () => queueJob };
  `, c);
  const api = { ...c.api, commands, store, tick: ms => now += ms };
  api.onEvent({type:'auth_state', logged_in:true, is_active:active});
  return api;
}
function snapshot(id, changes = {}) {
  return { type:'playback_state', status:'playing', is_active:true, item:{uri:`spotify:track:${id}`,decorations:{playback:{duration_ms:180000}}},
    context:{uri:`spotify:track:${id}`}, available_actions:{seek:{}}, position:{position_ms:0,speed:1}, ...changes };
}
// Locally elapsed time must advance position without trusting the daemon's wall clock.
test('playback progress interpolates locally and freezes on pause',()=>{const s=controller();s.onEvent({type:'playback_state',status:'playing',item:{decorations:{playback:{duration_ms:60000}}},position:{position_ms:10000,timestamp_ms:999999999,speed:1}});s.tick(1500);assert.equal(s.positionNow(),11500);s.onEvent({type:'playback_changed',status:'paused'});s.tick(3000);assert.equal(s.positionNow(),11500);s.onEvent({type:'position_sync',position:{position_ms:30000,speed:0}});assert.equal(s.positionNow(),30000)});
// Track changes must reset position and the duration cap; logout clears the old playback.
test('track transition, volume, device and logout events replace state',()=>{const s=controller();s.onEvent({type:'auth_state',logged_in:true,is_active:true});s.onEvent({type:'playback_state',status:'playing',item:{decorations:{playback:{duration_ms:50000}}},position:{position_ms:10000,speed:1},volume:40});s.onEvent({type:'track_changed',item:{decorations:{playback:{duration_ms:2000}}}});s.tick(3000);assert.equal(s.positionNow(),2000);s.onEvent({type:'volume_changed',volume:65});assert.equal(s.get().volume,65);s.onEvent({type:'device_changed',is_active:false,device_name:'MyGo Soloist'});assert.equal(s.get().is_active,false);assert.equal(s.auth().is_active,false);s.onEvent({type:'auth_state',logged_in:false});assert.equal(s.get(),null)});
function queueMachine({active=true,playbackState={options:{shuffle:false,repeat:'off'}},ctlFail=null}={}){
  let unblock, readyCalls = 0;
  const gate = new Promise(r => unblock = r);
  const api = controller({ active, beforeReady: async () => { if (++readyCalls === 1) await gate; },
    command(args, api) {
      if (args[0] === 'play') {
        if (ctlFail) throw ctlFail;
        api.onEvent(snapshot(args[1].slice(14), playbackState));
      }
    } });
  return {...api, unblock};
}
// A later selection supersedes a request that is still waiting for the backend.
test('latest selection supersedes queued playback',async()=>{
  const q=queueMachine();
  const first=q.remotePlay({ids:['old']});
  await Promise.resolve();await Promise.resolve();
  const second=q.remotePlay({ids:['new']});
  q.unblock();
  await Promise.all([first,second]);
  assert.deepEqual(Array.from(q.commands,a=>Array.from(a)),[['play','spotify:track:new']]);
});
// Pausing while Soloist starts must not produce a delayed playback request.
test('pause cancels pending playback',async()=>{
  const q=queueMachine();
  const first=q.remotePlay({ids:['old']});
  await Promise.resolve();await Promise.resolve();
  const paused=q.remotePause();
  q.unblock();
  await Promise.all([first,paused]);
  assert.deepEqual(Array.from(q.commands,a=>Array.from(a)),[['pause']]);
});
test('remotePlay skips redundant activate/shuffle/repeat when active, activates and seeks when needed, and records command failures',async()=>{
  const q=queueMachine({active:false,playbackState:{options:{shuffle:true,repeat:'context'}}});
  q.unblock();
  await q.remotePlay({ids:['t0','t1'],start:1,position:12345});
  assert.deepEqual(Array.from(q.commands,a=>Array.from(a)),[
    ['activate'],
    ['play','spotify:track:t1'],
    ['seek','12345'],
    ['shuffle','off'],
    ['repeat','off'],
  ]);
  assert.equal(q.getError(),'');

  const failing=queueMachine({ctlFail:new Error('Playback failed.')});
  failing.unblock();
  await assert.rejects(failing.remotePlay({ids:['t1']}),/Playback failed/);
  assert.equal(failing.getError(),'Playback failed.');
});

function artistHarness(mockApi){
  const from=source.indexOf('const image = items =>'),to=source.indexOf('export async function liked(',from);
  assert(from>=0&&to>from);
  const code=source.slice(from,to).replaceAll('export async function','async function');
  const c={Map,Promise,Error,String,Number,encodeURIComponent,t:s=>s,host:{storage:{get:k=>k==='me'?'me-1':k==='session'?{access:'tok'}:undefined}},api:mockApi};
  vm.runInNewContext(code+';globalThis.subject={search,playlists,playlist,createPlaylist,renamePlaylist,deletePlaylist,savePlaylist,addToPlaylist,removeFromPlaylist,movePlaylistTrack,album,artist,followArtist}',c);
  return c.subject;
}
test('artist page uses limit <= 10, strips quotes, paginates search and tolerates following error',async()=>{
  const subject=artistHarness(async(method,url,body,query)=>{
    if(url==='/artists/a1')return {id:'a1',name:'The "Band"',images:[{url:'https://img/a1'}]};
    if(url==='/artists/a1/albums'){
      assert.ok(query.limit<=10,'album limit must be <= 10 for Development Mode');
      return {items:[{id:'alb1',name:'Album 1',artists:[{id:'a1',name:'The "Band"'}],release_date:'2024-01-01'}],next:null};
    }
    if(url==='/me/library/contains')throw Object.assign(new Error('Insufficient client scope'),{status:403});
    if(url==='/search'&&query.offset===0){
      assert.equal(query.q,'artist:"The Band"');
      return {tracks:{items:[
        {id:'t1',name:'Hit 1',artists:[{id:'a1',name:'The "Band"'}],album:{id:'alb1',name:'Album 1'},duration_ms:200000},
        {id:'other',name:'Other',artists:[{id:'a2',name:'Someone Else'}],album:{id:'alb2',name:'Other'},duration_ms:180000},
      ],next:'https://api.spotify.com/v1/search?offset=10'}};
    }
    if(url==='/search'&&query.offset===10){
      return {tracks:{items:[
        {id:'t1',name:'Hit 1',artists:[{id:'a1',name:'The "Band"'}],album:{id:'alb1',name:'Album 1'},duration_ms:200000},
        {id:'t2',name:'Hit 2',artists:[{id:'a1',name:'The "Band"'}],album:{id:'alb1',name:'Album 1'},duration_ms:210000},
      ],next:null}};
    }
    throw new Error('Unexpected call: '+url);
  });
  const res=await subject.artist({id:'a1'});
  assert.equal(res.artist.id,'a1');
  assert.equal(res.artist.following,false);
  assert.deepEqual(Array.from(res.albums,a=>a.id),['alb1']);
  assert.deepEqual(Array.from(res.tracks,t=>t.id),['t1','t2']);
});

function lyricsHarness({mockApi,mockFetch}){
  const from=source.indexOf('const LYRIC_TIMEOUT ='),to=source.indexOf('// The desktop app owns these child processes',from);
  assert(from>=0&&to>from);
  const code=source.slice(from,to).replaceAll('export async function','async function');
  const timedFetch=async(url,options)=>{
    const r=await mockFetch(url,options);
    const text=typeof r.text==='function'?await r.text():String(r.body??'');
    return {response:{ok:r.status>=200&&r.status<300,status:r.status??200},text};
  };
  const c={Date,Math,Map,Promise,Error,Number,String,Array,JSON,URLSearchParams,encodeURIComponent,parseInt,Infinity,api:mockApi,timedFetch};
  vm.runInNewContext(code+';globalThis.subject={lyrics,decodeBase64Utf8,decodeHtmlEntities,cleanQqTranslation,cleanTrackTitle,pickBestSong,pickBestLyrics}',c);
  return c.subject;
}
test('lyrics helpers decode UTF-8 Base64, HTML entities, QQ translation noise and score candidates',()=>{
  const h=lyricsHarness({mockApi:async()=>null,mockFetch:async()=>({status:404,body:''})});
  const sample='[00:01.54]夢ならば 🎵\n[00:06.88]如果只是一场梦';
  assert.equal(h.decodeBase64Utf8(Buffer.from(sample,'utf8').toString('base64')),sample);
  assert.equal(h.decodeHtmlEntities('Don&apos;t &amp; &quot;go&quot; &#39;now&#39; &#x21;'),`Don't & "go" 'now' !`);
  assert.equal(h.cleanQqTranslation('[kana:123]\n[00:00.00]//\n[00:01.54]如果只是一场梦\n[00:02.00]// '), '[00:01.54]如果只是一场梦');
  assert.equal(h.cleanTrackTitle('Lemon - Remastered 2024 (TV Size)'), 'Lemon');

  const picked=h.pickBestSong([
    {id:'live',name:'Lemon (Live)',artists:['米津玄師'],durationMs:256000},
    {id:'studio',name:'Lemon',artists:['米津玄師'],durationMs:256500},
    {id:'too-far',name:'Lemon',artists:['米津玄師'],durationMs:280000},
  ],{name:'Lemon',artists:['米津玄師'],durationMs:256000});
  assert.equal(picked.id,'studio');

  // Bilingual (NetEase / QQ) takes precedence over monolingual LRCLIB.
  const lrcOnly={lrc:'[00:01.00]Hello',translation:''};
  const qqBilingual={lrc:'[00:01.00]Hello',translation:'[00:01.00]你好'};
  const neBilingual={lrc:'[00:01.00]Hello',translation:'[00:01.00]你好NE'};
  assert.equal(h.pickBestLyrics({lrclib:lrcOnly,netease:null,qq:qqBilingual}),qqBilingual);
  assert.equal(h.pickBestLyrics({lrclib:lrcOnly,netease:neBilingual,qq:qqBilingual}),neBilingual);
  assert.equal(h.pickBestLyrics({lrclib:lrcOnly,netease:{lrc:'[00:01.00]NE',translation:''},qq:null}),lrcOnly);
});

test('lyrics fetches LRCLIB, NetEase and QQ Music concurrently and falls back cleanly on errors',async()=>{
  let trackCalls=0;
  const qqLrc=Buffer.from('[00:01.54]Don&apos;t stop','utf8').toString('base64');
  const qqTrans=Buffer.from('[kana:abc]\n[00:00.00]//\n[00:01.54]不要停下','utf8').toString('base64');
  const h=lyricsHarness({
    mockApi:async()=>{trackCalls++;return {id:'trk1',name:'Test Song (Deluxe)',artists:[{name:'Singer'}],album:{name:'Alb'},duration_ms:200000};},
    mockFetch:async(url)=>{
      if(url.startsWith('https://lrclib.net/'))throw new Error('lrclib timeout');
      if(url.startsWith('https://music.163.com/api/cloudsearch/pc'))return {status:200,body:JSON.stringify({result:{songs:[]}})};
      if(url.startsWith('https://c.y.qq.com/soso/fcgi-bin/client_search_cp'))return {status:200,body:JSON.stringify({data:{song:{list:[{mid:'mid1',id:42,name:'Test Song',singer:[{name:'Singer'}],interval:200}]}}})};
      if(url==='https://u.y.qq.com/cgi-bin/musicu.fcg')return {status:200,body:JSON.stringify({req:{data:{lyric:qqLrc,trans:qqTrans}}})};
      return {status:404,body:''};
    },
  });
  const first=await h.lyrics({id:'trk1'});
  assert.equal(first.lrc,"[00:01.54]Don't stop");
  assert.equal(first.translation,'[00:01.54]不要停下');
  // Second call hits in-memory cache without re-fetching Spotify track metadata.
  const second=await h.lyrics({id:'trk1'});
  assert.deepEqual(second,first);
  assert.equal(trackCalls,1);
});

function warmupHarness({platform='windows',settings={},dataDir='D:/plugin-data/spotify-soloist',helperImpl,processResultImpl,spawnImpl}){
  const from=source.indexOf('const EXE = "bin/soloist.exe";'),to=source.indexOf('async function ready()',from);
  const tailFrom=source.indexOf('// Start Soloist in the background');
  assert(from>=0&&to>from&&tailFrom>to);
  const timers=[];
  const code=source.slice(from,to)+'\n'+source.slice(tailFrom);
  const c={
    Date,Math,Promise,Error,JSON,Object,String,
    host:{platform,dataDir,setting:k=>settings[k]||'',spawn:spawnImpl},
    t:s=>s,
    problem:(code,msg)=>Object.assign(new Error(msg),{code}),
    delay:async()=>{},
    helper:helperImpl,
    processResult:processResultImpl,
    killProcess:p=>p?.kill?.(),clearTimeout,
    spawnProcess:(prog,args)=>spawnImpl(prog,args),
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  };
  vm.runInNewContext(code+';globalThis.subject={ensureSoloist,warmupSoloist,resolveConfig,stopSoloist,config,getAuth:()=>authState}',c);
  return {...c.subject,timers};
}

test('mount warmup schedules Soloist startup asynchronously and shares startPromise with concurrent playback',async()=>{
  let spawnCount=0,statusCalls=0;
  let releaseConfig;
  const configGate=new Promise(r=>{releaseConfig=r;});
  const h=warmupHarness({
    helperImpl:async()=>{await configGate;return {key:'k',dataDir:'D:/data',cacheDir:'D:/cache'};},
    processResultImpl:async(prog,args)=>{
      if(args[1]==='status')return {code:++statusCalls===1?1:0,output:statusCalls===1?'stopped':'running (pid 123)',error:''};
      return {code:0,output:'',error:''};
    },
    spawnImpl:(prog,args)=>{
      if(args[0]==='--device-name'){
        spawnCount++;
        return {closeStdin(){},readLine:async()=>null,wait:()=>new Promise(()=>{})};
      }
      let sent=false;
      return {
        closeStdin(){},
        readLine:async()=>{if(sent)return new Promise(()=>{});sent=true;return '{"type":"auth_state","logged_in":true,"device_name":"MyGo Soloist","is_active":false}';},
        wait:async()=>0,
      };
    },
  });
  assert.equal(h.timers.length,1);
  assert.equal(h.timers[0].ms,0);
  // Trigger mount timer, then concurrently call ensureSoloist (simulating immediate play click).
  h.timers[0].fn();
  const concurrent=h.ensureSoloist();
  releaseConfig();
  const state=await concurrent;
  assert.equal(state.logged_in,true);
  assert.equal(spawnCount,1,'warmup and concurrent ensureSoloist must spawn daemon only once');
});

test('mount warmup swallows setup failures without poisoning later retries and skips non-Windows',async()=>{
  let attempts=0;
  const h=warmupHarness({
    helperImpl:async()=>{
      if(++attempts===1)throw Object.assign(new Error('No API key'),{code:'setup'});
      return {key:'k',dataDir:'D:/data',cacheDir:'D:/cache'};
    },
    processResultImpl:async()=>({code:0,output:'running (pid 99)',error:''}),
    spawnImpl:()=>{
      let sent=false;
      return {
        closeStdin(){},
        readLine:async()=>{if(sent)return new Promise(()=>{});sent=true;return '{"type":"auth_state","logged_in":false,"device_name":"MyGo Soloist","is_active":false}';},
        wait:async()=>0,
      };
    },
  });
  // First warmup fails silently; subsequent explicit ensureSoloist succeeds cleanly.
  h.timers[0].fn();
  await new Promise(r=>setImmediate(r));
  await new Promise(r=>setImmediate(r));
  const state=await h.ensureSoloist();
  assert.equal(attempts,2);
  assert.equal(state.logged_in,false);

  let nonWinCalls=0;
  const mac=warmupHarness({
    platform:'darwin',
    helperImpl:async()=>{nonWinCalls++;return {};},
    processResultImpl:async()=>({code:0,output:'',error:''}),
    spawnImpl:()=>{nonWinCalls++;return {closeStdin(){},readLine:async()=>null,wait:async()=>0};},
  });
  mac.timers[0].fn();
  await new Promise(r=>setImmediate(r));
  assert.equal(nonWinCalls,0);
});

test('pure JS PKCE matches RFC 7636 S256 vector and works with or without Web Crypto',()=>{
  const from=source.indexOf('// Pure JS PKCE (RFC 7636)'),to=source.indexOf('function spawnProcess(',from);
  assert(from>=0&&to>from);
  const code=source.slice(from,to);
  const run=(withCrypto)=>{
    const c={Uint8Array,Uint32Array,Math,Date,String};
    if(withCrypto)c.crypto=globalThis.crypto;
    vm.runInNewContext(code+';globalThis.subject={sha256Bytes,toBase64Url,createPkce}',c);
    return c.subject;
  };
  const s=run(true);
  // RFC 7636 Appendix B test vector
  const rfcVerifier='dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(s.toBase64Url(s.sha256Bytes(rfcVerifier)),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  // NIST SHA-256("abc")
  const abcHex=Array.from(s.sha256Bytes('abc'),b=>b.toString(16).padStart(2,'0')).join('');
  assert.equal(abcHex,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  for(const withCrypto of [true,false]){
    const inst=run(withCrypto);
    const pkce=inst.createPkce();
    assert.match(pkce.verifier,/^[A-Za-z0-9_-]{43,128}$/);
    assert.match(pkce.state,/^[A-Za-z0-9_-]{32,128}$/);
    assert.equal(pkce.challenge,inst.toBase64Url(inst.sha256Bytes(pkce.verifier)));
  }
});

test('soloistApiKey setting bypasses PowerShell helper, reuses Soloist default data dir, and stopSoloist isolates stale processes',async()=>{
  let helperCalls=0,killed=0;
  const spawnedArgs=[];
  const h=warmupHarness({
    settings:{soloistApiKey:'  my-direct-key  '},
    helperImpl:async()=>{helperCalls++;return {key:'dpapi-key',dataDir:'D:/dpapi',cacheDir:'D:/cache'};},
    processResultImpl:async()=>({code:0,output:'running (pid 55)',error:''}),
    spawnImpl:(prog,args)=>{
      spawnedArgs.push(args);
      let sent=false,stopRead;
      return {
        closeStdin(){},
        kill(){killed++;stopRead?.(null);},
        readLine:async()=>{
          if(!sent){sent=true;return '{"type":"auth_state","logged_in":true,"device_name":"MyGo Soloist","is_active":false}';}
          return new Promise(r=>{stopRead=r;});
        },
        wait:async()=>0,
      };
    },
  });
  const cfg=await h.resolveConfig();
  assert.equal(helperCalls,0);
  assert.equal(cfg.key,'my-direct-key');
  assert.equal(cfg.source,'setting');
  assert.equal(cfg.dataDir,undefined,'UI key mode must use Soloist default data dir');
  assert.equal(cfg.cacheDir,undefined,'UI key mode must use Soloist default cache dir');

  await h.ensureSoloist();
  assert.deepEqual(Array.from(spawnedArgs[0]),['ctl','trace']);
  h.stopSoloist();
  assert.equal(killed,1,'stopSoloist must terminate existing watcher');
});

test('spawnProcess classifies permission vs missing soloist.exe and signOut blocks stale token refresh',async()=>{
  const from=source.indexOf('const API ='),to=source.indexOf('// --- Catalog Mapping',from);
  assert(from>=0&&to>from);
  const code=source.slice(from,to).replaceAll('export async function','async function').replaceAll('export function','function');
  const store=new Map([['session',{access:'old-access',refresh:'old-refresh',expiresAt:0}]]);
  let releaseFetch;
  const fetchGate=new Promise(r=>{releaseFetch=r;});
  let spawnErr=null;
  const c={
    Date,Math,Promise,Error,JSON,Object,String,Uint8Array,Uint32Array,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,
    playGeneration:0,
    stopSoloist(){},
    warmupSoloist(){},
    host:{
      dir:'D:/plugin',
      t:s=>s,
      setting:k=>k==='clientId'?'cid-1':'',
      storage:{get:k=>store.get(k),set:(k,v)=>store.set(k,v),remove:k=>store.delete(k)},
      spawn:()=>{throw spawnErr;},
    },
    fetch:async()=>{
      await fetchGate;
      return {ok:true,status:200,text:async()=>JSON.stringify({access_token:'stale-new-token',expires_in:3600})};
    },
  };
  vm.runInNewContext(code+';globalThis.subject={spawnProcess,access,signOut}',c);

  spawnErr=new Error('not allowed by permission');
  assert.throws(()=>c.subject.spawnProcess('bin/soloist.exe',[]),e=>e.code==='setup'&&/Allow Spotify Soloist/.test(e.message));

  spawnErr=new Error('exec: "bin/soloist.exe": executable file not found');
  assert.throws(()=>c.subject.spawnProcess('bin/soloist.exe',[]),e=>e.code==='setup'&&/bin\/soloist\.exe was not found/.test(e.message));

  // Start token refresh, then signOut before the network response returns.
  const pending=c.subject.access(true);
  await Promise.resolve();
  c.subject.signOut();
  releaseFetch();
  await assert.rejects(pending,e=>e.code==='signIn');
  assert.equal(store.has('session'),false,'stale refresh must not restore signed-out session');
});

test('playlist CRUD, batch item edits, move index translation, and accurate library saved state',async()=>{
  const calls=[];
  const subject=artistHarness(async(method,url,body,query)=>{
    calls.push({method,url,body,query});
    if(method==='POST'&&url==='/me/playlists')return {id:'pl-new',name:body.name,owner:{id:'me-1',display_name:'Me'},items:{total:0}};
    if(method==='GET'&&url==='/search')return {playlists:{items:[{id:'pl-other',name:'Stranger Mix',owner:{id:'u2',display_name:'Other'},items:{total:5}}],next:null}};
    if(method==='GET'&&url==='/me/playlists')return {items:[
      {id:'pl-mine',name:'Mine',owner:{id:'me-1',display_name:'Me'},items:{total:1}},
      {id:'pl-saved',name:'Saved',owner:{id:'u2',display_name:'Other'},items:{total:2}},
    ],next:null};
    if(method==='GET'&&url==='/playlists/pl-other')return {id:'pl-other',name:'Stranger Mix',owner:{id:'u2',display_name:'Other'},items:{total:1}};
    if(method==='GET'&&url==='/playlists/pl-other/items')return {items:[{item:{id:'t1',name:'S1',artists:[{id:'a1',name:'A1'}],album:{id:'alb1',name:'Alb1'},duration_ms:1000}}],next:null};
    if(method==='GET'&&url==='/albums/alb1')return {id:'alb1',name:'Alb1',artists:[{id:'a1',name:'A1'}],tracks:{items:[{id:'t1',name:'S1',artists:[{id:'a1',name:'A1'}],duration_ms:1000}],next:null}};
    if(method==='GET'&&url==='/me/library/contains')return [query.uris==='spotify:album:alb1'];
    return {};
  });

  await assert.rejects(subject.createPlaylist({name:'   '}),/Enter a playlist name/);
  const created=await subject.createPlaylist({name:'  Road Trip  '});
  assert.equal(created.id,'pl-new');
  assert.equal(created.name,'Road Trip');
  assert.equal(created.mine,true);
  assert.equal(created.saved,false);

  await subject.renamePlaylist({id:'pl-new',name:'  Night Drive  '});
  await subject.deletePlaylist({id:'pl-new'});
  await subject.savePlaylist({id:'pl-other',on:true});
  await subject.savePlaylist({id:'pl-other',on:false});

  const ids105=Array.from({length:105},(_,i)=>`t${i}`);
  await subject.addToPlaylist({id:'pl-new',trackIds:ids105});
  await subject.removeFromPlaylist({id:'pl-new',trackIds:ids105});

  await subject.movePlaylistTrack({id:'pl-new',from:1,to:0}); // move up -> insert_before = 0
  await subject.movePlaylistTrack({id:'pl-new',from:0,to:3}); // move down -> insert_before = 4
  await subject.movePlaylistTrack({id:'pl-new',from:2,to:2}); // no-op

  const searched=await subject.search({query:'mix',kind:'playlists'});
  assert.equal(searched.playlists[0].saved,false,'searched playlist must not default to saved=true');

  const libPls=await subject.playlists();
  assert.equal(libPls[0].mine,true);
  assert.equal(libPls[0].saved,false);
  assert.equal(libPls[1].mine,false);
  assert.equal(libPls[1].saved,true);

  const plDetail=await subject.playlist({id:'pl-other'});
  assert.equal(plDetail.saved,false);

  const albDetail=await subject.album({id:'alb1'});
  assert.equal(albDetail.album.saved,true);

  const addCalls=calls.filter(c=>c.method==='POST'&&c.url==='/playlists/pl-new/items');
  assert.equal(addCalls.length,2);
  assert.equal(addCalls[0].body.uris.length,100);
  assert.equal(addCalls[1].body.uris.length,5);

  const rmCalls=calls.filter(c=>c.method==='DELETE'&&c.url==='/playlists/pl-new/items');
  assert.equal(rmCalls.length,2);
  assert.equal(rmCalls[0].body.items.length,100);
  assert.equal(rmCalls[0].body.items[0].uri,'spotify:track:t0');
  assert.equal(rmCalls[1].body.items.length,5);

  const moveCalls=calls.filter(c=>c.method==='PUT'&&c.url==='/playlists/pl-new/items');
  assert.equal(moveCalls.length,2);
  assert.equal(moveCalls[0].body.range_start,1);
  assert.equal(moveCalls[0].body.insert_before,0);
  assert.equal(moveCalls[1].body.range_start,0);
  assert.equal(moveCalls[1].body.insert_before,4);
});

test('unpaired errors do not trigger a setup lock and passive events preserve playback diagnostics',async()=>{
  const s=controller();
  s.onEvent({type:'auth_state',logged_in:false,is_active:false});
  s.setError('Not paired: select MyGo Soloist in Spotify.');
  s.onEvent({type:'auth_state',logged_in:true,is_active:true});
  assert.equal(s.getError(),'Not paired: select MyGo Soloist in Spotify.');

  s.setError('Transient failure');
  s.onEvent({type:'playback_state',status:'paused',item:{decorations:{playback:{duration_ms:10000}}},position:{position_ms:0,speed:0}});
  assert.equal(s.getError(),'Transient failure');
  s.onEvent({type:'playback_state',status:'playing',item:{decorations:{playback:{duration_ms:10000}}},position:{position_ms:1000,speed:1}});
  assert.equal(s.getError(),'Transient failure');

  const from=source.indexOf('const EXE = "bin/soloist.exe";'),to=source.indexOf('export async function browse(',from);
  assert(from>=0&&to>from);
  const c={
    Date,Math,Promise,Error,JSON,Object,String,
    host:{platform:'windows',setting:()=>'direct-key',spawn:()=>{
      let sent=false;
      return {
        closeStdin(){},
        readLine:async()=>{if(sent)return new Promise(()=>{});sent=true;return '{"type":"auth_state","logged_in":false,"device_name":"MyGo Soloist","is_active":false}';},
        wait:async()=>0,
      };
    }},
    t:s=>s,
    problem:(code,msg)=>Object.assign(new Error(msg),{code}),
    delay:async()=>{},
    helper:async()=>{throw new Error('unused');},
    processResult:async(prog,args)=>args[1]==='status'?{code:0,output:'running (pid 42)',error:''}:{code:3,output:'',error:'not logged in'},
    spawnProcess:(prog,args)=>c.host.spawn(prog,args),
  };
  vm.runInNewContext(source.slice(from,to)+';globalThis.subject={ready,ctl}',c);
  await assert.rejects(c.subject.ready(),e=>e.code===undefined&&/Not paired/.test(e.message));
  await assert.rejects(c.subject.ctl(['play','spotify:track:1']),e=>e.code===undefined&&/Not paired/.test(e.message));
});

test('autoplay after managed track end reports track ended to MyGo, pauses autoplay, and preserves remote takeover detection',async()=>{
  const s = controller({command(args, api) {
    if (args[0] === 'play') {
      api.onEvent(snapshot('oldTrack')); // A queued trace event may arrive before the requested URI.
      api.onEvent(snapshot(args[1].slice(14)));
    }
  }});
  const { commands } = s;
  await s.remotePlay({ids:['trackA','trackB'],start:0});
  assert.deepEqual(commands,[['play','spotify:track:trackA']]);
  commands.length=0;

  // Track A begins playing and nears its end (243s / 243s).
  s.onEvent({type:'playback_state',status:'playing',is_active:true,item:{uri:'spotify:track:trackA',decorations:{playback:{duration_ms:243000}}},context:{uri:'spotify:track:trackA'},position:{position_ms:240000,speed:1},volume:40});
  assert.equal((await s.remoteState()).trackId,'trackA');
  s.tick(3000);

  // Soloist jumps to an unrequested Spotify [autoplay] track when trackA finishes.
  s.onEvent({type:'track_changed',item:{uri:'spotify:track:autoplayX',decorations:{playback:{duration_ms:300000}}}});
  s.onEvent({type:'playback_state',status:'playing',is_active:true,item:{uri:'spotify:track:autoplayX',decorations:{playback:{duration_ms:300000}}},context:{uri:'spotify:track:trackA'},position:{position_ms:500,speed:1},volume:40});
  await new Promise(r=>setImmediate(r));

  // remoteState() must report null so MyGo calls remoteEnded() -> next track, and autoplay must be paused once.
  assert.equal(await s.remoteState(),null);
  assert.deepEqual(commands,[['pause']]);
  commands.length=0;

  // If this was the end of MyGo's queue and user hits Play again, remoteResume() must replay trackA, not autoplayX.
  await s.remoteResume();
  assert.deepEqual(commands,[['play','spotify:track:trackA']]);
  commands.length=0;

  // 2. When MyGo advances to trackB, normal playback resumes cleanly.
  await s.remotePlay({ids:['trackA','trackB'],start:1});
  assert.deepEqual(commands,[['play','spotify:track:trackB']]);
  commands.length=0;
  s.onEvent({type:'playback_state',status:'playing',is_active:true,item:{uri:'spotify:track:trackB',decorations:{playback:{duration_ms:180000}}},context:{uri:'spotify:track:trackB'},position:{position_ms:10000,speed:1},volume:40});
  assert.equal((await s.remoteState()).trackId,'trackB');

  // 3. If the listener genuinely switches to a different album mid-song on phone Spotify, report it normally.
  s.onEvent({type:'playback_state',status:'playing',is_active:true,item:{uri:'spotify:track:phoneSong',decorations:{playback:{duration_ms:210000}}},context:{uri:'spotify:album:otherAlbum'},position:{position_ms:1000,speed:1},volume:40});
  await new Promise(r=>setImmediate(r));
  assert.equal((await s.remoteState()).trackId,'phoneSong');
  assert.deepEqual(commands,[]);
});

test('cold replay of the saved track waits for fresh, active and seekable playback', async () => {
  let stage = 0, sought;
  const s = controller({ active:false, command(args, api) {
    if (args[0] === 'activate') api.onEvent({type:'device_changed',is_active:true});
    if (args[0] === 'play') api.onEvent(snapshot('saved',{status:'buffering',available_actions:{}}));
    if (args[0] === 'seek') sought = [stage, Number(args[1])];
  }, onDelay(api) {
    if (++stage === 1) api.onEvent(snapshot('saved',{available_actions:{}}));
    if (stage === 2) api.onEvent(snapshot('saved'));
  }});
  s.onEvent(snapshot('saved',{is_active:false}));
  await s.remotePlay({ids:['saved'],position:1000});
  assert.deepEqual(sought,[2,1000]);
  assert.equal(s.getError(),'');
  assert.equal((await s.remoteState()).playing,true);
});

test('accepted play survives seek failure, retains a diagnostic across VM reload, and clears it on the next successful play', async () => {
  const s = controller({command(args, api) {
    if (args[0] === 'play') api.onEvent(snapshot('saved'));
    if (args[0] === 'seek') throw new Error('command failed');
  }});
  await s.remotePlay({ids:['saved'],position:12000});
  assert.equal(s.commands.filter(c => c[0] === 'seek').length,2);
  s.onEvent(snapshot('saved'));
  s.onEvent({type:'auth_state',logged_in:true,is_active:true});
  await s.remoteVolume({percent:50});
  assert.match(s.getError(),/saved position/);
  const reopened = controller({saved:s.store, command(args,api) { if(args[0]==='play') api.onEvent(snapshot('saved')); }});
  const page = await reopened.browse({page:'soloist'});
  assert.equal(page.sections[0].title,'Last Playback Error');
  assert.equal(page.sections[0].empty,s.getError());
  await reopened.remotePlay({ids:['saved']});
  assert.equal(reopened.store.has('lastPlaybackError'),false);
  assert.equal((await reopened.browse({page:'soloist'})).sections.length,1);
});

test('a seek acknowledged only by its resulting position is not replayed', async () => {
  const s = controller({command(args,api) {
    if (args[0]==='play') api.onEvent(snapshot('saved'));
    if (args[0]==='seek') throw new Error('timeout');
    if (args[0]==='now') return JSON.stringify(snapshot('saved',{position:{position_ms:42000,speed:1}}));
  }});
  await s.remotePlay({ids:['saved'],position:42000});
  assert.deepEqual(s.commands.map(c=>c[0]),['play','seek','now']);
  assert.equal(s.getError(),'');
});

test('activate retries transient failure, and an ambiguous play is reconciled without resending it', async () => {
  let attempts = 0;
  const s = controller({active:false,command(args,api) {
    if(args[0]==='activate' && ++attempts===1) throw new Error('temporarily unavailable');
    if(args[0]==='play') throw new Error('timeout');
    if(args[0]==='now') return JSON.stringify(snapshot('cold'));
  }});
  await s.remotePlay({ids:['cold']});
  assert.deepEqual(s.commands.map(c=>c[0]),['activate','activate','play','now']);
  assert.equal(s.getError(),'');
});

test('unconfirmed play never adopts an old track, late playback is paused, and a later selection disarms cleanup',async()=>{
  const s = controller({command(args,api) {
    if(args[0]==='now') return JSON.stringify(snapshot('other'));
    if(args[0]==='play' && args[1].endsWith(':next')) api.onEvent(snapshot('next'));
  }});
  s.onEvent(snapshot('late'));
  await assert.rejects(s.remotePlay({ids:['late']}),/did not confirm/);
  s.onEvent(snapshot('other'));
  assert.equal(s.commands.some(c=>c[0]==='pause'),false);
  s.onEvent(snapshot('late'));
  await s.settled();
  assert.equal(s.commands.filter(c=>c[0]==='pause').length,1);
  assert.match(s.getError(),/did not confirm/);
  await assert.rejects(s.remotePlay({ids:['late']}),/did not confirm/);
  await s.remotePlay({ids:['next']});
  s.onEvent(snapshot('late'));
  await s.settled();
  assert.equal(s.commands.filter(c=>c[0]==='pause').length,1);
  assert.equal(s.getError(),'');
});

test('pause serializes behind dispatched play, supersedes its seek/error, and suppresses late startup audio',async()=>{
  let started, finish;
  const dispatched = new Promise(r=>started=r);
  const gate = new Promise(r=>finish=r);
  const s=controller({command:async args=>{if(args[0]==='play'){started();await gate;throw new Error('stale failure');}}});
  const play=s.remotePlay({ids:['old'],position:12000});
  await dispatched;
  const pause=s.remotePause();
  assert.deepEqual(s.commands.map(c=>c[0]),['play']);
  finish();
  await Promise.all([play,pause]);
  assert.deepEqual(s.commands.map(c=>c[0]),['play','pause']);
  s.onEvent(snapshot('old'));
  await s.settled();
  assert.deepEqual(s.commands.map(c=>c[0]),['play','pause','pause']);
  assert.equal(s.getError(),'');
});

test('seek, volume and device controls serialize with resume and preserve actionable failures',async()=>{
  let started,finish;
  const dispatched=new Promise(r=>started=r), gate=new Promise(r=>finish=r);
  const s=controller({command:async(args,api)=>{
    if(args[0]==='play'){started();await gate;api.onEvent(snapshot('track'));}
    if(args[0]==='volume')throw new Error('volume failed');
  }});
  s.onEvent(snapshot('track',{status:'paused'}));
  const resume=s.remoteResume();await dispatched;
  const seek=s.remoteSeek({position:82}), volume=s.remoteVolume({percent:20}), device=s.remoteUse({deviceId:'soloist'});
  assert.deepEqual(s.commands,[['play']]);finish();
  const results=await Promise.allSettled([resume,seek,volume,device]);
  assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','rejected','fulfilled']);
  assert.deepEqual(s.commands,[['play'],['seek','82'],['volume','20']]);
  assert.equal(s.getError(),'volume failed');
  assert.equal((await s.remoteDevices())[0].active,true);
});

test('near-end seek, same-track replay and a phone selection do not trigger an autoplay pause',async()=>{
  const s=controller({command(args,api){
    if(args[0]==='play') api.onEvent(snapshot('a'));
    if(args[0]==='now') return JSON.stringify(snapshot('phone',{context:{uri:'spotify:album:other'}}));
  }});
  await s.remotePlay({ids:['a']});
  s.onEvent({type:'position_sync',position:{position_ms:179800,speed:1}});
  await s.remoteSeek({position:0});
  s.onEvent(snapshot('a'));
  await s.remotePlay({ids:['a']});
  s.onEvent({type:'position_sync',position:{position_ms:179900,speed:1}});
  s.onEvent({type:'track_changed',item:snapshot('phone').item});
  assert.equal((await s.remoteState()).trackId,'phone');
  assert.equal(s.commands.some(c=>c[0]==='pause'),false);
});

test('a device transfer stops tracking without advancing MyGo, and explicit resume retakes the selected URI',async()=>{
  const s=controller({command(args,api){if(args[0]==='play')api.onEvent(snapshot('a'));}});
  await s.remotePlay({ids:['a']});
  s.onEvent({type:'device_changed',is_active:false});
  s.onEvent(snapshot('phone',{is_active:false}));
  await assert.rejects(s.remoteState(),/another Spotify device/);
  s.commands.length=0;
  await s.remoteResume();
  assert.deepEqual(s.commands,[['activate'],['play','spotify:track:a']]);
});

test('autoplay pause failure is visible and retried before MyGo receives track end',async()=>{
  let attempts=0;
  const s=controller({command(args,api){
    if(args[0]==='play')api.onEvent(snapshot('a'));
    if(args[0]==='pause' && ++attempts===1)throw new Error('pause failed');
  }});
  await s.remotePlay({ids:['a']});
  s.onEvent(snapshot('replacement',{context:{uri:'spotify:track:a'}}));
  await new Promise(r=>setImmediate(r));
  assert.equal(s.getError(),'pause failed');
  assert.equal(await s.remoteState(),null);
  assert.equal(attempts,2);
});

test('logout and configuration replacement invalidate controls that were awaiting a play result',async()=>{
  for(const change of ['logout','configuration']){
    let finish,started;
    const gate=new Promise(r=>finish=r),dispatched=new Promise(r=>started=r);
    const s=controller({command:async args=>{if(args[0]==='play'){started();await gate;}}});
    const play=s.remotePlay({ids:['a'],position:12345});
    await dispatched;
    if(change==='logout') s.onEvent({type:'auth_state',logged_in:false,is_active:false});
    else s.stopSoloist();
    finish();
    await assert.rejects(play,change==='logout'?/Not paired/:/configuration changed/);
    assert.deepEqual(s.commands,[['play','spotify:track:a']]);
  }
});

test('trace EOF reconnects without another user command and stale reconnect callbacks cannot revive stopped instances',async()=>{
  let reads=0,end;
  const h=warmupHarness({settings:{soloistApiKey:'test'},processResultImpl:async()=>({code:0,output:'running (pid 1)'}),spawnImpl:()=>{
    reads++;
    let sent=false;
    return {closeStdin(){},kill(){},readLine:async()=>{
      if(sent)return new Promise(r=>end=r);
      sent=true;return JSON.stringify({type:'auth_state',logged_in:true,is_active:true,device_name:String(reads)});
    }};
  }});
  assert.equal((await h.ensureSoloist()).device_name,'1');
  end(null);await new Promise(r=>setImmediate(r));
  const reconnect=h.timers.at(-1);
  assert.equal(reconnect.ms,250);reconnect.fn();
  await new Promise(r=>setImmediate(r));
  assert.equal((await h.ensureSoloist()).device_name,'2');
  end(null);await new Promise(r=>setImmediate(r));
  const stale=h.timers.at(-1);
  h.stopSoloist();stale.fn();assert.equal(reads,2);
});

test('failed daemon probe reaps only the owned daemon and permits a clean restart',async()=>{
  let probes=0,killed=0;
  const h=warmupHarness({settings:{soloistApiKey:'test'},processResultImpl:async()=>{
    if(++probes===1)return {code:1,output:'stopped'};
    if(probes===2)throw new Error('probe timed out');
    return {code:0,output:'running (pid 2)'};
  },spawnImpl:(prog,args)=>{
    if(args[0]!=='ctl')return {closeStdin(){},kill(){killed++;},readLine:async()=>null,wait:()=>new Promise(()=>{})};
    let sent=false;
    return {closeStdin(){},readLine:async()=>{if(sent)return new Promise(()=>{});sent=true;return JSON.stringify({type:'auth_state',logged_in:true,is_active:false});}};
  }});
  await assert.rejects(h.ensureSoloist(),/probe timed out/);
  assert.equal(killed,1);
  assert.equal((await h.ensureSoloist()).logged_in,true);
});

test('processResult releases callers and kills a stuck ctl client even when the pipe never closes',async()=>{
  let killed=0;
  const c={setTimeout,clearTimeout,t:s=>s,spawnProcess:()=>({closeStdin(){},readLine:()=>new Promise(()=>{}),kill(){killed++;throw new Error('already stopped');}})};
  const code=source.slice(source.indexOf('function killProcess('),source.indexOf('async function helper('));
  vm.runInNewContext(code+';globalThis.call=processResult;',c);
  await assert.rejects(c.call('helper',['ctl','play'],5),/timed out/);
  assert.equal(killed,1);
});

test('a late track_changed delta after failure checks the actual device snapshot before pausing',async()=>{
  let late=false;
  const s=controller({command(args){if(args[0]==='now')return JSON.stringify(snapshot(late?'late':'other'));}});
  await assert.rejects(s.remotePlay({ids:['late']}),/did not confirm/);
  s.onEvent({type:'track_changed',item:snapshot('late').item});
  await s.settled();
  assert.equal(s.commands.some(c=>c[0]==='pause'),false);
  late=true;
  s.onEvent({type:'playback_changed',status:'playing'});
  await s.settled();
  assert.equal(s.commands.at(-1)[0],'pause');
});

test('resume at the exact end replays the managed URI while an ordinary pause resumes in place',async()=>{
  const s=controller({command(args,api){if(args[0]==='play')api.onEvent(snapshot('a'));}});
  await s.remotePlay({ids:['a']});
  s.onEvent(snapshot('a',{status:'paused',position:{position_ms:179000,speed:0}}));
  await s.remoteResume();
  s.onEvent(snapshot('a',{status:'paused',position:{position_ms:180000,speed:0}}));
  await s.remoteResume();
  assert.deepEqual(s.commands,[['play','spotify:track:a'],['play'],['play','spotify:track:a']]);
});

test('old configuration rejection does not evict the replacement cached configuration',async()=>{
  let rejectOld,calls=0;
  const h=warmupHarness({helperImpl:async()=>{
    if(++calls===1)return new Promise((_,reject)=>rejectOld=reject);
    return {dataDir:'new'};
  }});
  const old=h.config();h.stopSoloist();
  const effective=await h.config();
  rejectOld(new Error('old configuration failed'));
  await assert.rejects(old,/old configuration/);
  assert.equal(await h.config(),effective);
  assert.equal(calls,2);
});

test('daemon exit retires its trace and late events cannot restore a dead connection',async()=>{
  let probes=0,exit,late,kills=0;
  const h=warmupHarness({settings:{soloistApiKey:'test'},processResultImpl:async()=>++probes===1?{code:1,output:''}:{code:0,output:'running (pid 99)'},
    spawnImpl:(prog,args)=>{
      if(args[0]!=='ctl')return {closeStdin(){},readLine:async()=>null,wait:()=>new Promise(r=>exit=r)};
      let sent=false;return {closeStdin(){},kill(){kills++;},readLine:async()=>{
        if(sent)return new Promise(r=>late=r);
        sent=true;return JSON.stringify({type:'auth_state',logged_in:true,is_active:true});
      }};
    }});
  await h.ensureSoloist();exit(10);await new Promise(r=>setImmediate(r));
  assert.equal(kills,1);assert.equal(h.getAuth(),null);
  late(JSON.stringify({type:'auth_state',logged_in:true,is_active:true}));
  await new Promise(r=>setImmediate(r));assert.equal(h.getAuth(),null);
});

test('startup that exhausts the command budget never dispatches play and reports the timeout',async()=>{
  const s=controller({beforeReady:()=>s.tick(27000)});
  await assert.rejects(s.remotePlay({ids:['late']}),/timed out/);
  assert.deepEqual(s.commands,[]);
  assert.match(s.getError(),/timed out/);
});

test('explicit inactive-device play rejection reactivates and retries only once',async()=>{
  let attempts=0;
  const s=controller({command(args,api){
    if(args[0]==='play' && ++attempts===1)throw Object.assign(new Error('inactive'),{inactive:true,actionUnavailable:true});
    if(args[0]==='play')api.onEvent(snapshot('saved'));
  }});
  await s.remotePlay({ids:['saved']});
  assert.deepEqual(s.commands.map(c=>c[0]),['play','activate','play']);
});

test('a paused replacement that starts later is intercepted once',async()=>{
  const s=controller({command(args,api){if(args[0]==='play')api.onEvent(snapshot('a'));}});
  await s.remotePlay({ids:['a']});
  const replacement={context:{uri:'spotify:track:a'}};
  s.onEvent(snapshot('next',{...replacement,status:'paused'}));
  assert.equal(await s.remoteState(),null);
  assert.equal(s.commands.length,1);
  s.onEvent({type:'playback_changed',status:'playing'});s.onEvent(snapshot('next',replacement));
  await s.settled();
  assert.deepEqual(s.commands,[['play','spotify:track:a'],['pause']]);
});

test('optional shuffle/repeat and diagnostic storage failures cannot detach accepted playback',async()=>{
  const store=new Map();store.set=()=>{throw new Error('disk unavailable');};
  const s=controller({saved:store,command(args,api){
    if(args[0]==='play')api.onEvent(snapshot('a',{options:{shuffle:true,repeat:'track'}}));
    if(args[0]==='shuffle')throw new Error('unavailable');
  }});
  await s.remotePlay({ids:['a']});
  assert.match(s.getError(),/playback options/);
  assert.equal((await s.remoteState()).trackId,'a');
  assert.deepEqual(s.commands.map(c=>c[0]),['play','shuffle','repeat']);
});

test('ctl errors expose the verb, reason and exit code while discarding raw diagnostics',async()=>{
  const c={startGeneration:1,authState:{logged_in:true},EXE:'helper',config:async()=>({}),dataArgs:()=>[],t:s=>s,
    processResult:async()=>({code:3,error:'inactive device [private diagnostic]',output:''})};
  vm.runInNewContext(source.slice(source.indexOf('async function ctl('),source.indexOf('async function ensureSoloist('))+';globalThis.call=ctl;',c);
  await assert.rejects(c.call(['play','spotify:track:test']),e=>e.actionUnavailable && e.inactive && e.message==='Soloist is not the active device. (play, 3)');
});

function updaterHarness({storageInit={},fetchImpl,processResultImpl,spawnImpl}={}){
  const from=source.indexOf('const EXE = "bin/soloist.exe";');
  const to=source.indexOf('// MyGo gives plugin calls 30 seconds',from);
  const helperSlice=source.slice(source.indexOf('function killProcess('),source.indexOf('async function helper('));
  assert(from>=0&&to>from);
  const store=new Map(Object.entries(storageInit));
  const c={
    Date,Math,Number,Promise,Error,JSON,Object,String,AbortController,setTimeout,clearTimeout,
    host:{
      platform:'windows',
      dir:'D:/plugin',
      setting:k=>k==='soloistApiKey'?'test-key':'',
      storage:{get:k=>store.get(k),set:(k,v)=>store.set(k,v),remove:k=>store.delete(k)},
    },
    t:s=>s,
    problem:(code,msg)=>Object.assign(new Error(msg),{code}),
    delay:async()=>{},
    helper:async()=>{throw new Error('unused');},
    spawnProcess:(prog,args)=>spawnImpl(prog,args),
    fetch:fetchImpl,
  };
  let code=helperSlice+'\n'+source.slice(from,to).replaceAll('export async function','async function');
  if(processResultImpl){
    code=code.replace(/async function processResult\([\s\S]*?\n\}\n/,'');
    c.processResult=processResultImpl;
  }
  vm.runInNewContext(code+';globalThis.subject={parseSoloistVersion,soloistDaysRemaining,shouldUpdateSoloist,ensureSoloist,checkForSoloistUpdate,browse,onEvent,getStore:k=>host.storage.get(k)}',c);
  return c.subject;
}

test('Soloist version parsing, 90-day expiry math, and update eligibility rules',()=>{
  const h=updaterHarness({spawnImpl:()=>{throw new Error('unused');}});
  const parsed=h.parseSoloistVersion('soloist 1.4.0.3 build 1795197722 (20261120) (gcedbef4d51) (windows/x86_64)');
  assert.deepEqual({...parsed},{version:'1.4.0.3',buildTimestamp:1795197722,buildDate:'2026-11-20'});
  assert.equal(h.parseSoloistVersion('invalid output'),null);

  const nowMs=1795197722*1000+10*86400000;
  assert.equal(h.soloistDaysRemaining(1795197722,nowMs),80);
  assert.equal(h.soloistDaysRemaining(1795197722,1795197722*1000+91*86400000),-1);

  // Same ETag -> no update; changed ETag -> update; already staged same ETag -> skip duplicate stage.
  assert.equal(h.shouldUpdateSoloist({buildTimestamp:1795197722,etag:'aaa'},{etag:'aaa',lastModifiedMs:0},nowMs),false);
  assert.equal(h.shouldUpdateSoloist({buildTimestamp:1795197722,etag:'aaa'},{etag:'bbb',lastModifiedMs:0},nowMs),true);
  assert.equal(h.shouldUpdateSoloist({buildTimestamp:1795197722,etag:'aaa',staged:{etag:'bbb'}},{etag:'bbb',lastModifiedMs:0},nowMs),false);
  // First check after manual install (no saved ETag) compares Last-Modified against installed buildTimestamp.
  assert.equal(h.shouldUpdateSoloist({buildTimestamp:1793988108,etag:''},{etag:'bbb',lastModifiedMs:1795197722*1000},nowMs),true);
  assert.equal(h.shouldUpdateSoloist({buildTimestamp:1795197722,etag:''},{etag:'bbb',lastModifiedMs:1795197722*1000},nowMs),false);
  // Expired binary always triggers update.
  assert.equal(h.shouldUpdateSoloist({buildTimestamp:1793988108,etag:'aaa'},{etag:'aaa',lastModifiedMs:0},1793988108*1000+95*86400000),true);
});

test('ensureSoloist automatically downloads missing bin/soloist.exe and self-heals expired exit code 10',async()=>{
  let missing=true,expired=true,installs=[];
  let statusChecks=0;
  const h=updaterHarness({
    processResultImpl:async(prog,args)=>{
      if(prog==='powershell.exe'){
        const action=args[args.indexOf('-Action')+1];
        const force=args.includes('-ForceDownload');
        installs.push({action,force});
        missing=false;
        if(force)expired=false;
        return {code:0,output:JSON.stringify({installed:true,version:force?'1.4.0.3':'1.3.10.51',buildTimestamp:force?1795197722:1793988108,etag:force?'etag-new':'etag-old',lastModified:'Fri, 20 Nov 2026 18:35:24 GMT'}),error:''};
      }
      if(missing)throw Object.assign(new Error('missing'),{code:'setup',missingBinary:true});
      if(args[1]==='status')return {code:++statusChecks>=2&&!expired?0:1,output:!expired&&statusChecks>=2?'running (pid 77)':'stopped',error:''};
      return {code:0,output:'',error:''};
    },
    spawnImpl:(prog,args)=>{
      if(args[0]==='--device-name'){
        const shouldExpire=expired;
        return {
          closeStdin(){},
          kill(){},
          readLine:async()=>null,
          wait:async()=>shouldExpire?10:new Promise(()=>{}),
        };
      }
      let sent=false;
      return {
        closeStdin(){},
        kill(){},
        readLine:async()=>{
          if(!sent){sent=true;return '{"type":"auth_state","logged_in":true,"device_name":"MyGo Soloist","is_active":false}';}
          return new Promise(()=>{});
        },
        wait:async()=>0,
      };
    },
  });
  const state=await h.ensureSoloist();
  assert.equal(state.logged_in,true);
  assert.deepEqual(installs,[{action:'install',force:false},{action:'install',force:true}]);
  assert.equal(h.getStore('soloistBuild').version,'1.4.0.3');
  assert.equal(h.getStore('soloistBuild').etag,'etag-new');
});

test('silent background update stages while playing without interrupting, swaps when idle, and shows status in browse',async()=>{
  const psActions=[];
  let headCalls=0;
  const h=updaterHarness({
    storageInit:{soloistBuild:{version:'1.3.10.51',buildTimestamp:1793988108,etag:'etag-old',checkedAt:0}},
    fetchImpl:async(url,opts)=>{
      assert.equal(opts.method,'HEAD');
      headCalls++;
      return {ok:true,headers:{get:k=>k.toLowerCase()==='etag'?'"etag-new"':k.toLowerCase()==='last-modified'?'Fri, 20 Nov 2026 18:35:24 GMT':''}};
    },
    processResultImpl:async(prog,args)=>{
      if(prog==='powershell.exe'){
        const action=args[args.indexOf('-Action')+1];
        psActions.push(action);
        return {code:0,output:JSON.stringify({[action==='stage'?'staged':'installed']:true,version:'1.4.0.3',buildTimestamp:1795197722,etag:'etag-new',lastModified:'Fri, 20 Nov 2026 18:35:24 GMT'}),error:''};
      }
      if(args[1]==='status')return {code:0,output:'running (pid 88)',error:''};
      return {code:0,output:'',error:''};
    },
    spawnImpl:()=>{
      let sent=false;
      return {
        closeStdin(){},
        kill(){},
        readLine:async()=>{
          if(!sent){sent=true;return '{"type":"auth_state","logged_in":true,"device_name":"MyGo Soloist","is_active":true}';}
          return new Promise(()=>{});
        },
        wait:async()=>0,
      };
    },
  });

  await h.ensureSoloist();
  // Simulate active playback: background check must only stage and never interrupt playback.
  h.onEvent({type:'playback_state',status:'playing',is_active:true,item:{uri:'spotify:track:t1',decorations:{playback:{duration_ms:200000}}},position:{position_ms:10000,speed:1}});
  const whilePlaying=await h.checkForSoloistUpdate();
  assert.deepEqual({...whilePlaying},{checked:true,staged:true,version:'1.4.0.3'});
  assert.deepEqual(psActions,['stage']);

  // Playback Status page must display installed version and pending staged update.
  const page=await h.browse({page:'soloist'});
  const engineSection=page.sections.find(s=>s.title==='Soloist Engine');
  assert.ok(engineSection);
  assert.match(engineSection.empty,/1\.3\.10\.51.*2026-11-06/);
  assert.match(engineSection.empty,/1\.4\.0\.3/);

  // Once playback pauses (idle), next check swaps the staged build cleanly without re-fetching HEAD.
  h.onEvent({type:'playback_changed',status:'paused'});
  const whenIdle=await h.checkForSoloistUpdate();
  assert.deepEqual({...whenIdle},{checked:true,updated:true,version:'1.4.0.3'});
  assert.deepEqual(psActions,['stage','install']);
  assert.equal(headCalls,1);
  assert.equal(h.getStore('soloistBuild').version,'1.4.0.3');
  assert.equal(h.getStore('soloistBuild').staged,null);
});

test('per-source lyric disable switches skip disabled providers and setSetting clears lyricsCache',async()=>{
  const from=source.indexOf('const LYRIC_TIMEOUT ='),to=source.indexOf('// The desktop app owns these child processes',from);
  const setFrom=source.indexOf('export function setSetting('),setTo=source.indexOf('export async function account(',setFrom);
  assert(from>=0&&to>from&&setFrom>=0&&setTo>setFrom);
  const settings={disableLrclibLyrics:'true',disableNeteaseLyrics:'true',disableQqLyrics:''};
  const requestedUrls=[];
  let trackCalls=0;
  const timedFetch=async(url)=>{
    requestedUrls.push(String(url));
    if(String(url).includes('c.y.qq.com')){
      return {response:{ok:true,status:200},text:JSON.stringify({data:{song:{list:[{id:101,mid:'m1',name:'Song',singer:[{name:'Artist'}],interval:180}]}}})};
    }
    if(String(url).includes('u.y.qq.com')){
      const lrc=Buffer.from('[00:01.00]QQ Line','utf8').toString('base64');
      const trans=Buffer.from('[00:01.00]QQ 翻译','utf8').toString('base64');
      return {response:{ok:true,status:200},text:JSON.stringify({req:{data:{lyric:lrc,trans}}})};
    }
    throw new Error('Unexpected provider request: '+url);
  };
  const c={
    Date,Math,Map,Promise,Error,Number,String,Array,JSON,URLSearchParams,encodeURIComponent,parseInt,Infinity,
    host:{setting:k=>settings[k]||''},
    signOut(){},stopSoloist(){},warmupSoloist(){},
    api:async()=>{trackCalls++;return {name:'Song',artists:[{name:'Artist'}],album:{name:'Alb'},duration_ms:180000};},
    timedFetch,
  };
  const code=source.slice(from,to).replaceAll('export async function','async function')+'\n'+source.slice(setFrom,setTo).replaceAll('export function','function');
  vm.runInNewContext(code+';globalThis.subject={lyrics,setSetting}',c);

  const qqOnly=await c.subject.lyrics({id:'trk-1'});
  assert.equal(qqOnly.lrc,'[00:01.00]QQ Line');
  assert.equal(qqOnly.translation,'[00:01.00]QQ 翻译');
  assert.equal(requestedUrls.some(u=>u.includes('lrclib.net')||u.includes('music.163.com')),false);
  assert.equal(trackCalls,1);

  // Toggling a lyric switch clears cache; disabling all 3 skips even the Spotify track lookup.
  settings.disableQqLyrics='true';
  c.subject.setSetting({key:'disableQqLyrics',value:'true'});
  const disabledAll=await c.subject.lyrics({id:'trk-1'});
  assert.deepEqual({...disabledAll},{lrc:'',translation:''});
  assert.equal(trackCalls,1);

  // Re-enabling QQ triggers a fresh fetch because cache was cleared.
  settings.disableQqLyrics='false';
  c.subject.setSetting({key:'disableQqLyrics',value:'false'});
  const refetched=await c.subject.lyrics({id:'trk-1'});
  assert.equal(refetched.lrc,'[00:01.00]QQ Line');
  assert.equal(trackCalls,2);
});
