const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../index.js'),'utf8');
function stateMachine(){let now=1000;const from=source.indexOf('function onEvent('),to=source.indexOf('async function watch(',from);assert(from>=0&&to>from);const c={Date:{now:()=>now},Math};vm.runInNewContext('let authState=null,playback=null,anchoredAt=0;'+source.slice(from,to)+';globalThis.subject={onEvent,positionNow,get:()=>playback,auth:()=>authState}',c);return {...c.subject,tick:ms=>now+=ms}}
// Locally elapsed time must advance position without trusting the daemon's wall clock.
test('playback progress interpolates locally and freezes on pause',()=>{const s=stateMachine();s.onEvent({type:'playback_state',status:'playing',item:{decorations:{playback:{duration_ms:60000}}},position:{position_ms:10000,timestamp_ms:999999999,speed:1}});s.tick(1500);assert.equal(s.positionNow(),11500);s.onEvent({type:'playback_changed',status:'paused'});s.tick(3000);assert.equal(s.positionNow(),11500);s.onEvent({type:'position_sync',position:{position_ms:30000,speed:0}});assert.equal(s.positionNow(),30000)});
// Track changes must reset position and the duration cap; logout clears the old playback.
test('track transition, volume, device and logout events replace state',()=>{const s=stateMachine();s.onEvent({type:'auth_state',logged_in:true,is_active:true});s.onEvent({type:'playback_state',status:'playing',item:{decorations:{playback:{duration_ms:50000}}},position:{position_ms:10000,speed:1},volume:40});s.onEvent({type:'track_changed',item:{decorations:{playback:{duration_ms:2000}}}});s.tick(3000);assert.equal(s.positionNow(),2000);s.onEvent({type:'volume_changed',volume:65});assert.equal(s.get().volume,65);s.onEvent({type:'device_changed',is_active:false,device_name:'MyGo Soloist'});assert.equal(s.get().is_active,false);assert.equal(s.auth().is_active,false);s.onEvent({type:'auth_state',logged_in:false});assert.equal(s.get(),null)});
function queueMachine(){const from=source.indexOf('let queueJob = Promise.resolve();'),to=source.indexOf('export async function remoteResume()',from);assert(from>=0&&to>from);const requests=[];let unblock;const gate=new Promise(r=>unblock=r);let readyCalls=0;const c={Date,Math,Promise,Error,authState:{device_name:'MyGo Soloist'},t:s=>s,delay:async()=>{},ready:async()=>{if(++readyCalls===1)await gate},ctl:async()=>{},api:async(method,url,body)=>{if(method==='GET')return {devices:[{id:'device',name:'MyGo Soloist'}]};requests.push(body)}};vm.runInNewContext(source.slice(from,to).replaceAll('export async function','async function')+';globalThis.subject={remotePlay,remotePause}',c);return {...c.subject,requests,unblock}}
// A later selection supersedes a request that is still waiting for the backend.
test('latest selection supersedes queued playback',async()=>{const q=queueMachine();const first=q.remotePlay({ids:['old']});await Promise.resolve();await Promise.resolve();const second=q.remotePlay({ids:['new']});q.unblock();await Promise.all([first,second]);assert.equal(q.requests.length,1);assert.equal(q.requests[0].uris[0],'spotify:track:new')});
// Pausing while Soloist starts must not produce a delayed playback request.
test('pause cancels pending playback',async()=>{const q=queueMachine();const first=q.remotePlay({ids:['old']});await Promise.resolve();await Promise.resolve();await q.remotePause();q.unblock();await first;assert.equal(q.requests.length,0)});

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
    spawnProcess:(prog,args)=>spawnImpl(prog,args),
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  };
  vm.runInNewContext(code+';globalThis.subject={ensureSoloist,warmupSoloist,resolveConfig,stopSoloist}',c);
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
        readLine:async()=>{if(sent)return null;sent=true;return '{"type":"auth_state","logged_in":true,"device_name":"MyGo Soloist","is_active":false}';},
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
        readLine:async()=>{if(sent)return null;sent=true;return '{"type":"auth_state","logged_in":false,"device_name":"MyGo Soloist","is_active":false}';},
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

test('soloistApiKey setting bypasses PowerShell helper and stopSoloist isolates stale processes',async()=>{
  let helperCalls=0,killed=0;
  const h=warmupHarness({
    settings:{soloistApiKey:'  my-direct-key  '},
    dataDir:'C:/Users/me/AppData/Roaming/MyGo Music/plugin-data/spotify-soloist/',
    helperImpl:async()=>{helperCalls++;return {key:'dpapi-key',dataDir:'D:/dpapi',cacheDir:'D:/cache'};},
    processResultImpl:async()=>({code:0,output:'running (pid 55)',error:''}),
    spawnImpl:()=>{
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
  assert.equal(cfg.dataDir,'C:/Users/me/AppData/Roaming/MyGo Music/plugin-data/spotify-soloist/soloist/data');
  assert.equal(cfg.cacheDir,'C:/Users/me/AppData/Roaming/MyGo Music/plugin-data/spotify-soloist/soloist/cache');

  await h.ensureSoloist();
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
