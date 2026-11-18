/* Polymarket US BTC Signal - read-only iPhone dashboard.
   Important: the official index-history endpoint is the source for BTC readings.
   The dashboard must NEVER substitute exchange spot data for the settlement feed.
*/
(()=>{'use strict';
const E=window.PolyEngine, T=window.PolyTracker;
const $=id=>document.getElementById(id);
const API='https://gateway.polymarket.us';
const REFRESH_MS=5000,REQ_TIMEOUT_MS=6900;
const state={market:null,book:null,trend:null,minuteCandles:[],secondCandles:[],
  marketAt:0,bookAt:0,minuteAt:0,referenceAt:0,cycleAt:0,inFlight:false,errors:[],
  signal:null,tracker:T.freshState(),lastWindow:0,failures:0,connected:false};
const fmtUsd=x=>Number.isFinite(x)?x.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}):'--';
const cents=x=>Number.isFinite(x)?`${Math.round(x*100)}¢`:'--';
const signed=(x,d=3,suffix='%')=>Number.isFinite(x)?`${x>=0?'+':''}${x.toFixed(d)}${suffix}`:'--';
const clock=ms=>new Date(ms).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});
function setText(id,x){$(id).textContent=x;}
function status(id,label,ok){const el=$(id);el.textContent=label;el.className='small-dot '+(ok?'green':'red');}
function setConnection(text,color){setText('connectionText',text);$('connectionDot').className='dot '+color;}
function abortable(url){
  const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),REQ_TIMEOUT_MS);
  return fetch(url,{method:'GET',cache:'no-store',mode:'cors',signal:ctl.signal,headers:{'Accept':'application/json'}})
    .then(async r=>{
      if(!r.ok)throw Error(`HTTP ${r.status} from ${new URL(url).pathname}`);
      return r.json();
    }).finally(()=>clearTimeout(timeout));
}
const PAPER_KEY='poly-btc-paper-v2';
function initTracker(){
  try{const raw=localStorage.getItem(PAPER_KEY);if(raw)state.tracker=T.restore(JSON.parse(raw));}
  catch(err){console.warn('Unable to restore local paper history.',err);}
}
function saveTracker(){
  try{localStorage.setItem(PAPER_KEY,JSON.stringify({active:state.tracker.active,history:state.tracker.history}));}
  catch(err){console.warn('Unable to store local paper history.',err);}
}
function updatePaperTracking(nowMs){
  const t=state.tracker;
  if(!t.active)return;
  const bid=state.book?.[t.active.side]?.bid;
  T.advancePaper(t.active,nowMs,state.market?.slug, bid);
  T.archive(t);
  saveTracker();
}
function expirePaperIfNeeded(nowMs){
  const t=state.tracker;
  if(t.active&&nowMs>=t.active.marketEndsAt){
    T.advancePaper(t.active,nowMs,t.active.slug,null);
    T.archive(t);saveTracker();
  }
}
function autoRecordConfirmed(s,nowMs){
  if(s.type!=='TRADE'||!state.market||T.seenMarket(state.tracker,state.market.slug))return;
  const sample=T.paperFromSignal(s,state.market.slug,nowMs,s.end,state.book?.[s.side]?.bid);
  if(sample){state.tracker.active=sample;saveTracker();}
}
function marketStart(nowS){return Math.floor(nowS/900)*900;}
async function refreshMarket(nowS){
  const start=marketStart(nowS),slug=E.slugFor(nowS);
  if(start!==state.lastWindow){
    state.lastWindow=start;state.market=null;state.book=null;state.minuteCandles=[];state.secondCandles=[];
    state.trend=null;state.marketAt=state.bookAt=state.referenceAt=state.minuteAt=0;
  }
  if(state.market&&Date.now()-state.marketAt<50000)return;
  let response;
  try{
    response=await abortable(`${API}/v1/market/slug/${slug}`);
    const m=response?.market;
    if(!m||m.slug!==slug)throw Error('The market slug did not match the current 15-minute window.');
    if(m.assetPriceTerms?.asset?.symbol?.toLowerCase()!=='btc')throw Error('Market metadata is not for BTC.');
    state.market=m;
    state.marketAt=Date.now();
  }catch(err){
    // Keep a previously fetched matching market for at most 120 seconds.
    if(!state.market||Date.now()-state.marketAt>120000)throw Error(`Market discovery: ${err.message}`);
  }
}
async function refreshBook(){
  if(!state.market)throw Error('No market to quote.');
  const raw=await abortable(`${API}/v1/markets/${state.market.slug}/bbo`);
  const quotes=E.quotesFromBbo(raw);
  state.book=quotes;state.bookAt=Date.now();
}
async function refreshReferences(nowS){
  // Fine-grained 1-second BRTI-like reference history every 5 seconds.
  const start=Math.floor(nowS)-240;
  const endpoint=`${API}/v1/asset-prices/history?assets=crypto%3Abtc&from=${start}&to=0`;
  const oneSec=abortable(`${endpoint}&bucket=ASSET_PRICE_BUCKET_1S`).then(response=>{
    const item=response?.series?.find(s=>s?.asset?.symbol?.toLowerCase()==='btc');
    if(!Array.isArray(item?.candles)||!item.candles.length)throw Error('Empty BTC reference series.');
    state.secondCandles=item.candles;state.referenceAt=Date.now();
  });
  const shouldMinute=!state.minuteCandles.length||Date.now()-state.minuteAt>45000;
  const minute=shouldMinute?abortable(`${API}/v1/asset-prices/history?assets=crypto%3Abtc&from=${Math.floor(nowS)-2100}&to=0&bucket=ASSET_PRICE_BUCKET_1M`).then(response=>{
    const item=response?.series?.find(s=>s?.asset?.symbol?.toLowerCase()==='btc');
    if(!Array.isArray(item?.candles)||!item.candles.length)throw Error('Empty BTC minute series.');
    state.minuteCandles=item.candles;state.minuteAt=Date.now();
  }):Promise.resolve();
  const settled=await Promise.allSettled([oneSec,minute]);
  const failures=settled.filter(s=>s.status==='rejected');
  if(failures.length){throw Error(failures.map(f=>f.reason?.message||'Reference feed unavailable').join('; '));}
  state.trend=E.collectTrend(state.minuteCandles,state.secondCandles,nowS);
}
function ensureFreshness(){
  const now=Date.now();
  if(now-state.bookAt>12500)throw Error('Order book is stale: cannot calculate a live entry/exit.');
  if(now-state.referenceAt>12500)throw Error('Reference fetch is stale: pausing new entries.');
  if(now-state.minuteAt>90000)throw Error('Longer-term reference history is stale.');
  if(now-state.marketAt>120000)throw Error('Market verification expired.');
}
async function cycle(){
  if(state.inFlight||document.visibilityState==='hidden')return;
  state.inFlight=true;const nowS=Math.floor(Date.now()/1000),issues=[];
  try{
    await refreshMarket(nowS);
    // Force a fresh quote and BRTI update. If either fails, NO TRADE.
    const results=await Promise.allSettled([refreshBook(),refreshReferences(nowS)]);
    for(let i=0;i<results.length;i++)if(results[i].status==='rejected')issues.push(`${i===0?'Order book':'BRTI'}: ${results[i].reason?.message||'failed'}`);
    if(issues.length)throw Error(issues.join(' | '));
    ensureFreshness();
    // A complete, fresh cycle is required before confirming signals or monitoring exits.
    const rawSignal=E.evaluate({market:state.market,book:state.book,trend:state.trend,nowS});
    state.connected=true;state.failures=0;state.errors=[];state.cycleAt=Date.now();
    const nowMs=Date.now();
    updatePaperTracking(nowMs);
    state.signal=T.confirmSignal(state.tracker,rawSignal,state.market.slug,nowMs,state.trend.priceAt);
    autoRecordConfirmed(state.signal,nowMs);
    setConnection('LIVE','green');
  }catch(error){
    state.connected=false;state.failures++;state.errors=[error?.message||String(error)];
    // A failed poll breaks the consecutive-confirmation chain.
    state.tracker.pending=null;state.tracker.confirmedKey=null;
    expirePaperIfNeeded(Date.now());
    state.signal={type:'WAIT',side:null,score:null,probUp:null,reasons:[...state.errors,'Trade signals disabled until live data is restored.'],blockers:[...state.errors]};
    setConnection('DATA DELAY','red');
  }finally{state.inFlight=false;render();}
}
function render(){
  const s=state.signal||{type:'WAIT',reasons:['Connecting to market…']};
  const trade=s.type==='TRADE', confirming=s.type==='CONFIRMING';
  const paper=state.tracker.active;
  const label=trade?'BUY '+s.side:confirming?'CONFIRMING '+s.side:'NO TRADE';
  const signalEl=$('signalName');
  signalEl.textContent=state.connected?label:'DATA UNAVAILABLE';
  signalEl.className='signal-name '+(trade?'buy-'+s.side.toLowerCase():'wait');
  const detail=trade?`Two live checks confirmed. Estimated model edge ${(s.edge*100).toFixed(1)}¢ versus current ask.`:
    (s.reasons?.[0]||'Checking entry quality…');
  setText('signalDetail',detail);
  setText('quality',Number.isFinite(s.score)?String(s.score):'--');
  setText('upProbability',Number.isFinite(s.probUp)?`${(s.probUp*100).toFixed(1)}%`:'--');
  $('meterFill').style.width=Number.isFinite(s.score)?`${s.score}%`:'0%';
  // Keep the original paper entry/target/stop visible if new entries are rejected.
  // These are clearly marked PAPER, never presented as a fresh BUY signal.
  const displayed=trade?s:paper;
  setText('entry',displayed?cents(displayed.entry):'--');
  setText('entryNote',trade?`${s.side} contract · CONFIRMED live ask`:
    paper?`LOCKED PAPER ${paper.side} · not a new entry signal`:
    confirming?'Confirming 1 of 2 live refreshes':'No approved setup');
  setText('takeProfit',displayed?cents(displayed.tp):'--');
  setText('stopLoss',displayed?cents(displayed.sl):'--');
  const liveSide=trade?s.side:paper?.side;
  setText('exitNow',liveSide&&state.connected&&state.book?.[liveSide]?cents(state.book[liveSide].bid):'--');
  setText('exitNowNote',liveSide?(state.connected?`${liveSide} contract · live best bid`:'Live exit quote unavailable'):'Quoted bid shown on market table');
  setText('btcPrice',fmtUsd(state.trend?.spot));
  setText('priceToBeat',fmtUsd(s.strike||E.n(state.market?.assetPriceTerms?.priceToBeat)));
  const strike=E.n(state.market?.assetPriceTerms?.priceToBeat);
  const gap=strike>0&&state.trend?.spot?100*(state.trend.spot/strike-1):NaN;
  const gapEl=$('gapValue');gapEl.textContent=signed(gap);gapEl.style.color=gap>=0?'var(--green)':'var(--red)';
  const book=state.book;
  for(const side of ['UP','DOWN'])for(const f of ['ask','bid','spread']){
    setText(side.toLowerCase()+f[0].toUpperCase()+f.slice(1),book?cents(book[side][f]):'--');
  }
  setText('quotesStamp',book?`Quote response: ${clock(state.bookAt)} · Down side derived as complement of UP book`:'Waiting for quotes');
  for(const [id,key] of [['m1','r1'],['m3','r3'],['m5','r5'],['m10','r10']]){
    const val=state.trend?.[key],el=$(id);el.textContent=signed(val);el.style.color=val>0?'var(--green)':val<0?'var(--red)':'var(--white)';
  }
  setText('edge',Number.isFinite(s.edge)?signed(s.edge*100,1,'¢'):'--');
  setText('dataAge',state.trend?.priceAt!=null?`${Math.max(0,Math.floor(Date.now()/1000-state.trend.priceAt))}s`:'--');
  setText('referenceStatus',state.trend?`Index ${clock(state.trend.priceAt*1000)}`:'Index unavailable');
  $('referenceDot').className='small-dot '+(state.connected?'green':'red');
  const reasons=$('reasons');reasons.replaceChildren();
  for(const reason of (s.reasons||['No decision yet.'])){const li=document.createElement('li');li.textContent=reason;reasons.append(li);}
  setText('dMarket',state.market?.slug||'Not found');
  setText('dBook',state.bookAt?`${clock(state.bookAt)} · ${book?.state||'unknown'}`:'Unavailable');
  setText('dBRTI',state.referenceAt?`${clock(state.referenceAt)} · ${state.secondCandles.length} reference seconds`:'Unavailable');
  setText('dRefresh',state.cycleAt?clock(state.cycleAt):'Not yet completed');
  setText('diagnosticsText',state.errors.length?`Last error: ${state.errors.join(' · ')}`:'Reference and order-book reads are independent. A missing feed disables new trade signals.');
  setText('refreshLabel',`${Math.round(REFRESH_MS/1000)}s polling · visible only`);
  const marketHref=state.market?.slug?`https://polymarket.us/event/${encodeURIComponent(state.market.slug)}`:'https://polymarket.us';
  $('marketLink').href=marketHref;
  $('clearButton').disabled=!paper;
  $('exportButton').disabled=!state.tracker.history.length;
  $('clearHistoryButton').disabled=!state.tracker.history.length;
  renderPaper();draw();tick();
}
function renderPaper(){
  const a=state.tracker.active;
  setText('paperStatus',a?'ACTIVE PAPER':'LOCAL SIMULATION');
  if(!a)setText('watchText','No active paper setup. A confirmed BUY signal is automatically recorded here.');
  else{
    const missing=Date.now()-a.lastSeenAt>13500;
    const move=(a.lastBid-a.entry)*100;
    setText('watchText',`${a.side} · locked ${cents(a.entry)} entry / ${cents(a.tp)} target / ${cents(a.sl)} stop · Quality ${a.score}/100. `+
      `${missing?'Last observed':'Observed'} bid ${cents(a.lastBid)} (${signed(move,1,'¢')} vs hypothetical ask). `+
      `${a.observationCount} observed quotes; no actual shares purchased.`);
  }
  const sum=T.stats(state.tracker.history);
  setText('perfSummary',`${sum.total} archived setups · ${sum.target} target touches · ${sum.stop} stop touches · ${sum.unresolved} unresolved`);
  const buckets=$('scoreBuckets');buckets.replaceChildren();
  for(const b of ['0–59','60–69','70–79','80–100']){
    const r=sum.buckets[b],line=document.createElement('div');line.className='bucket-row';
    const name=document.createElement('span');name.textContent=`Score ${b}`;
    const result=document.createElement('b');result.textContent=`${r.target} TP / ${r.stop} SL / ${r.unresolved} other`;
    line.append(name,result);buckets.append(line);
  }
  const ul=$('paperHistory');ul.replaceChildren();
  for(const h of state.tracker.history.slice(0,6)){
    const li=document.createElement('li');
    const status=h.status==='TARGET_TOUCH'?'Target observed':h.status==='STOP_TOUCH'?'Stop observed':
      h.status==='USER_DISMISSED'?'Dismissed':'Window ended / unobserved';
    const move=Number.isFinite(h.paperMoveCents)?` · ${signed(h.paperMoveCents,1,'¢')} bid move`:'';
    li.textContent=`${new Date(h.openedAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · ${h.side} · ${h.score}/100 · ${status}${move}`;
    ul.append(li);
  }
  if(!state.tracker.history.length){const li=document.createElement('li');li.textContent='No finished paper setups yet.';ul.append(li);}
}
function tick(){
  const nowS=Date.now()/1000;
  const start=marketStart(nowS),left=(start+900)-nowS;
  const min=Math.floor(Math.max(0,left)/60),sec=Math.floor(Math.max(0,left)%60);
  setText('countdown',`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} REMAINING`);
  setText('windowBadge',new Date(start*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
  if(state.trend){setText('dataAge',`${Math.max(0,Math.floor(nowS-state.trend.priceAt))}s`);}
  if(state.connected&&(Date.now()-state.cycleAt>13000)){
    // A fast stale-data guard between requests. Display can never leave a false LIVE tag.
    setConnection('STALE','red');
    setText('signalName','DATA STALE');
    $('signalName').className='signal-name wait';
  }
}
function draw(){
  const canvas=$('priceChart');if(!canvas)return;
  const rect=canvas.getBoundingClientRect();if(rect.width<1)return;
  const dpr=Math.min(2,window.devicePixelRatio||1),W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  const c=canvas.getContext('2d');c.clearRect(0,0,W,H);c.scale(dpr,dpr);
  const width=rect.width,height=rect.height,left=8,right=width-8,top=15,bottom=height-13;
  const data=state.trend?.points||[];
  if(data.length<2){c.font='12px -apple-system, sans-serif';c.fillStyle='#829db5';c.textAlign='center';c.fillText('Reference chart loads when data is available',width/2,height/2);c.setTransform(1,0,0,1,0,0);return;}
  const entries=data.slice(-30).map(p=>({t:p.timestamp,v:p.close}));
  const spot=state.trend?.spot,stamp=state.trend?.priceAt;
  if(Number.isFinite(spot)&&Number.isFinite(stamp)&&stamp>entries[entries.length-1].t)entries.push({t:stamp,v:spot});
  const strike=E.n(state.market?.assetPriceTerms?.priceToBeat);
  const vals=entries.map(p=>p.v);if(strike>0)vals.push(strike);
  const lo=Math.min(...vals),hi=Math.max(...vals),padding=Math.max(hi-lo,.0008*lo)*.15,min=lo-padding,max=hi+padding;
  const timeMin=entries[0].t,timeMax=entries[entries.length-1].t;
  const x=t=>left+(t-timeMin)/Math.max(1,timeMax-timeMin)*(right-left);
  const y=v=>bottom-(v-min)/Math.max(1,max-min)*(bottom-top);
  c.strokeStyle='#29445e';c.lineWidth=1;
  for(let i=0;i<4;i++){const yy=top+(bottom-top)*i/3;c.beginPath();c.moveTo(left,yy);c.lineTo(right,yy);c.stroke();}
  if(strike>0){c.setLineDash([4,4]);c.strokeStyle='#e1ae72';c.beginPath();c.moveTo(left,y(strike));c.lineTo(right,y(strike));c.stroke();c.setLineDash([]);}
  const points=entries.map(p=>[x(p.t),y(p.v)]);
  c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));
  c.lineTo(points[points.length-1][0],bottom);c.lineTo(points[0][0],bottom);c.closePath();
  const grad=c.createLinearGradient(0,top,0,bottom);grad.addColorStop(0,'#50aefa43');grad.addColorStop(1,'#50aefa02');c.fillStyle=grad;c.fill();
  c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.strokeStyle='#78bfff';c.lineWidth=2.2;c.stroke();
  c.beginPath();const last=points[points.length-1];c.arc(last[0],last[1],3.6,0,Math.PI*2);c.fillStyle='#8ed9ff';c.fill();
  c.setTransform(1,0,0,1,0,0);
}
function wire(){
 $('clearButton').addEventListener('click',()=>{
   const t=state.tracker;
   if(!t.active)return;
   T.closePaper(t.active,'USER_DISMISSED',Date.now(),null);
   T.archive(t);saveTracker();render();
 });
 $('exportButton').addEventListener('click',()=>{
   if(!state.tracker.history.length)return;
   const csv=T.asCSV(state.tracker.history);
   const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
   const href=URL.createObjectURL(blob),a=document.createElement('a');
   a.href=href;a.download='poly-paper-history-'+new Date().toISOString().slice(0,10)+'.csv';
   document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),5000);
 });
 $('clearHistoryButton').addEventListener('click',()=>{
   if(!state.tracker.history.length||!window.confirm('Delete all locally stored paper history on this device? This cannot be undone.'))return;
   state.tracker.history=[];saveTracker();render();
 });
 $('refreshButton').addEventListener('click',()=>{state.marketAt=0;state.minuteAt=0;cycle();});
 $('copyDiag').addEventListener('click',async()=>{
  const info={at:new Date().toISOString(),market:state.market?.slug,connected:state.connected,
    bookAt:state.bookAt,referenceAt:state.referenceAt,errors:state.errors,
    signal:state.signal?.type,paperActive:!!state.tracker.active,paperHistory:state.tracker.history.length,
    ageSeconds:state.trend?.priceAt?Math.floor(Date.now()/1000-state.trend.priceAt):null};
  const msg=JSON.stringify(info,null,2);
  try{await navigator.clipboard.writeText(msg);setText('copyDiag','Copied diagnostics');}
  catch(err){setText('copyDiag','Clipboard blocked · select text manually');}
 });
 window.addEventListener('resize',draw);
 document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='visible'){
     // iOS may suspend the app; require fresh data and new confirmation.
     setConnection('RECONNECT','amber');state.connected=false;state.cycleAt=0;
     state.tracker.pending=null;state.tracker.confirmedKey=null;
     expirePaperIfNeeded(Date.now());cycle();
   }
 });
 window.addEventListener('online',()=>cycle());
}
function boot(){
 initTracker();expirePaperIfNeeded(Date.now());wire();render();cycle();
 setInterval(cycle,REFRESH_MS);
 setInterval(tick,1000);
 // Don't cache API data. Service worker is shell-only.
 if('serviceWorker'in navigator&&location.protocol==='https:'){
   navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('PWA install unavailable',err));
 }
}
boot();
})();
