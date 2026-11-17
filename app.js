/* Polymarket US BTC Signal - read-only iPhone dashboard.
   Important: the official index-history endpoint is the source for BTC readings.
   The dashboard must NEVER substitute exchange spot data for the settlement feed.
*/
(()=>{'use strict';
const E=window.PolyEngine;
const $=id=>document.getElementById(id);
const API='https://gateway.polymarket.us';
const REFRESH_MS=5000,REQ_TIMEOUT_MS=6900;
const state={market:null,book:null,trend:null,minuteCandles:[],secondCandles:[],
  marketAt:0,bookAt:0,minuteAt:0,referenceAt:0,cycleAt:0,inFlight:false,errors:[],
  signal:null,watch:null,lastWindow:0,failures:0,connected:false};
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
function initWatch(){
  try{const raw=localStorage.getItem('poly-btc-watch-v1');if(raw){const w=JSON.parse(raw);
    if(w&&['UP','DOWN'].includes(w.side)&&Number.isFinite(w.entry)&&Number.isFinite(w.tp)&&Number.isFinite(w.sl)&&typeof w.slug==='string')state.watch=w;
  }}catch(err){console.warn('Watch restoration failed',err);}
}
function saveWatch(){try{if(state.watch)localStorage.setItem('poly-btc-watch-v1',JSON.stringify(state.watch));else localStorage.removeItem('poly-btc-watch-v1');}catch(err){console.warn(err);}}
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
    state.signal=E.evaluate({market:state.market,book:state.book,trend:state.trend,nowS});
    state.connected=true;state.failures=0;state.errors=[];state.cycleAt=Date.now();
    updateWatch();
    setConnection('LIVE','green');
  }catch(error){
    state.connected=false;state.failures++;state.errors=[error?.message||String(error)];
    state.signal={type:'WAIT',side:null,score:null,probUp:null,reasons:[...state.errors,'Trade signals disabled until live data is restored.'],blockers:[...state.errors]};
    setConnection('DATA DELAY','red');
  }finally{state.inFlight=false;render();}
}
function updateWatch(){
  const w=state.watch;if(!w||w.done)return;
  if(state.market?.slug!==w.slug){w.done='Expired (market changed)';w.doneAt=Date.now();saveWatch();return;}
  const bid=state.book?.[w.side]?.bid;
  if(!Number.isFinite(bid))return;
  w.lastBid=bid;
  if(bid>=w.tp){w.done='TAKE-PROFIT TRIGGER';w.doneAt=Date.now();saveWatch();}
  else if(bid<=w.sl){w.done='STOP-LOSS TRIGGER';w.doneAt=Date.now();saveWatch();}
}
function render(){
  const s=state.signal||{type:'WAIT',reasons:['Connecting to market…']};
  const trade=s.type==='TRADE',label=trade?'BUY '+s.side:'NO TRADE';
  const signalEl=$('signalName');
  signalEl.textContent=state.connected?label:'DATA UNAVAILABLE';
  signalEl.className='signal-name '+(trade?'buy-'+s.side.toLowerCase():'wait');
  const detail=trade?`Estimated edge ${(s.edge*100).toFixed(1)}¢ after comparing model fair value with current ask.`:
    (s.reasons?.[0]||'Checking entry quality…');
  setText('signalDetail',detail);
  setText('quality',Number.isFinite(s.score)?String(s.score):'--');
  setText('upProbability',Number.isFinite(s.probUp)?`${(s.probUp*100).toFixed(1)}%`:'--');
  $('meterFill').style.width=Number.isFinite(s.score)?`${s.score}%`:'0%';
  setText('entry',trade?cents(s.entry):'--');
  setText('entryNote',trade?`${s.side} contract · ask / buy now`:'No approved setup');
  setText('takeProfit',trade?cents(s.tp):'--');
  setText('stopLoss',trade?cents(s.sl):'--');
  setText('exitNow',trade&&state.book?cents(state.book[s.side].bid):'--');
  setText('exitNowNote',trade?`${s.side} contract · best bid`:'Quoted bid shown on market table');
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
  $('watchButton').disabled=!trade||!!(state.watch&&!state.watch.done);
  renderWatch();draw();tick();
}
function renderWatch(){
  const w=state.watch;
  if(!w){setText('watchText','No setup being watched.');return;}
  let msg=`${w.side} · watched entry ${cents(w.entry)} · TP ${cents(w.tp)} · SL ${cents(w.sl)}`;
  if(w.done)msg+=` · ${w.done}`;
  else msg+=` · Live sell bid ${cents(w.lastBid)}. Watching only; no order placed.`;
  setText('watchText',msg);
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
    $('watchButton').disabled=true;
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
 $('watchButton').addEventListener('click',()=>{
  const s=state.signal;
  if(!s||s.type!=='TRADE'||!state.market||!state.connected)return;
  state.watch={slug:state.market.slug,side:s.side,entry:s.entry,tp:s.tp,sl:s.sl,created:Date.now(),lastBid:state.book[s.side].bid};
  saveWatch();renderWatch();$('watchButton').disabled=true;
 });
 $('clearButton').addEventListener('click',()=>{state.watch=null;saveWatch();render();});
 $('refreshButton').addEventListener('click',()=>{state.marketAt=0;state.minuteAt=0;cycle();});
 $('copyDiag').addEventListener('click',async()=>{
  const info={at:new Date().toISOString(),market:state.market?.slug,connected:state.connected,
    bookAt:state.bookAt,referenceAt:state.referenceAt,errors:state.errors,
    signal:state.signal?.type,ageSeconds:state.trend?.priceAt?Math.floor(Date.now()/1000-state.trend.priceAt):null};
  const msg=JSON.stringify(info,null,2);
  try{await navigator.clipboard.writeText(msg);setText('copyDiag','Copied diagnostics');}
  catch(err){setText('copyDiag','Clipboard blocked · select text manually');}
 });
 window.addEventListener('resize',draw);
 document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='visible'){
     // Avoid implying any signal stayed live while iOS suspended the app.
     setConnection('RECONNECT','amber');state.connected=false;state.cycleAt=0;
     cycle();
   }
 });
 window.addEventListener('online',()=>cycle());
}
function boot(){
 initWatch();wire();render();cycle();
 setInterval(cycle,REFRESH_MS);
 setInterval(tick,1000);
 // Don't cache API data. Service worker is shell-only.
 if('serviceWorker'in navigator&&location.protocol==='https:'){
   navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('PWA install unavailable',err));
 }
}
boot();
})();
