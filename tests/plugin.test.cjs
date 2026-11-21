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
  const c={Map,Promise,Error,String,encodeURIComponent,host:{storage:{get:()=>'me-1'}},api:mockApi};
  vm.runInNewContext(code+';globalThis.subject={artist,followArtist}',c);
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

function warmupHarness({platform='windows',helperImpl,processResultImpl,spawnImpl}){
  const from=source.indexOf('const EXE = "bin/soloist.exe";'),to=source.indexOf('async function ready()',from);
  const tailFrom=source.indexOf('// Start Soloist in the background');
  assert(from>=0&&to>from&&tailFrom>to);
  const timers=[];
  const code=source.slice(from,to)+'\n'+source.slice(tailFrom);
  const c={
    Date,Math,Promise,Error,JSON,Object,
    host:{platform,spawn:spawnImpl},
    t:s=>s,
    problem:(code,msg)=>Object.assign(new Error(msg),{code}),
    delay:async()=>{},
    helper:helperImpl,
    processResult:processResultImpl,
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  };
  vm.runInNewContext(code+';globalThis.subject={ensureSoloist,warmupSoloist}',c);
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
