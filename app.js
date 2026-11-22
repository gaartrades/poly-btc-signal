/* Polymarket US BTC Signal - read-only iPhone dashboard.
   Important: the official index-history endpoint is the source for BTC readings.
   The dashboard must NEVER substitute exchange spot data for the settlement feed.
*/
(()=>{'use strict';
const E=window.PolyEngine, T=window.PolyTracker, C=window.PolyCalibration, X=window.PolyExecution;
const $=id=>document.getElementById(id);
const API='https://gateway.polymarket.us';
const FAST_MS=1000,MODEL_MS=5000,REQ_TIMEOUT_MS=4900; // While visible; best effort, not guaranteed
const CAL_KEY='poly-btc-calibration-v1', FEE_KEY='poly-btc-us-fee-tier-v18';
const DEPTH_MS=12000;
let feeTheta=.095;
const state={market:null,book:null,trend:null,minuteCandles:[],secondCandles:[],liveSpot:null,liveSecondAt:0,
 marketAt:0,bookAt:0,minuteAt:0,referenceAt:0,cycleAt:0,fastAt:0,lastEvalAt:0,lastChartAt:0,
 inFlight:false,errors:[],signal:null,tracker:T.freshState(),calibration:C.freshState(),
 calibrationReport:null,settlementLastCheck:0,settlementBusy:false,settlementTries:{},
 lastWindow:0,failures:0,connected:false,nextRequestAt:0,depth:null,depthAt:0,depthErrors:[],depthBusy:false,nextDepthAt:0};
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
      if(!r.ok){
        const err=Error(`HTTP ${r.status} from ${new URL(url).pathname}`);
        err.status=r.status;
        const retry=r.headers.get('Retry-After');
        if(retry){const seconds=Number(retry);err.retryAfterMs=Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry)-Date.now());}
        throw err;
      }
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
function loadCalibration(){
 try{const raw=localStorage.getItem(CAL_KEY);if(raw)state.calibration=C.restore(JSON.parse(raw));}
 catch(err){console.warn('Calibration history unavailable.',err);}
 updateCalibrationReport();
}
function saveCalibration(){
 try{localStorage.setItem(CAL_KEY,JSON.stringify(state.calibration));}
 catch(err){console.warn('Cannot save calibration observations.',err);}
}
function updateCalibrationReport(){state.calibrationReport=C.totals(state.calibration);}
function capturePrediction(raw,slug,nowMs){
 if(C.sample(state.calibration,slug,raw,nowMs)){saveCalibration();updateCalibrationReport();}
}
async function syncSettlement(force=false){
 if(state.settlementBusy||document.visibilityState==='hidden')return;
 const now=Date.now();if(!force&&now-state.settlementLastCheck<20000)return;
 if(!force&&state.nextRequestAt>now)return;
 const pending=C.pendingSlugs(state.calibration,now).filter(slug=>
   now-(state.settlementTries[slug]||0)>60000);
 if(!pending.length)return;
 state.settlementBusy=true;state.settlementLastCheck=now;
 const slug=pending[0];state.settlementTries[slug]=now;
 try{
   const response=await abortable(`${API}/v1/market/slug/${encodeURIComponent(slug)}`);
   const m=response?.market;
   if(m?.slug!==slug||!/^(MARKET_STATUS_)?RESOLVED$/i.test(String(m?.status||'')))return;
   const result=await abortable(`${API}/v1/markets/${encodeURIComponent(slug)}/settlement`);
   if(result?.slug!==slug)throw Error('Settlement slug mismatch, ignoring response.');
   if(C.verifiedSettlement(state.calibration,slug,result.settlement,m.status,Date.now())){
      saveCalibration();updateCalibrationReport();render();
   }
 }catch(error){
   // Never infer a winner from price; no verified settlement means no label.
   if(error.status===429){state.nextRequestAt=Math.max(state.nextRequestAt,Date.now()+Math.min(120000,Math.max(5000,error.retryAfterMs||15000)));}
   console.info('Settlement verification deferred:',error.message);
 }finally{state.settlementBusy=false;}
}
function updatePaperTracking(nowMs){
  const t=state.tracker;
  if(!t.active)return;
  const bid=state.book?.[t.active.side]?.bid;
  // Only observe the correct market with a fresh price. Never reuse old market quotes.
  if(state.bookAt<nowMs-4000||state.market?.slug!==t.active.slug)return;
  T.advancePaper(t.active,nowMs,state.market?.slug, bid);
  if(['TARGET_TOUCH','STOP_TOUCH'].includes(t.active.status)){
    const d=state.depth;
    // Costed exits are indicative only when a fresh depth snapshot matches the observed BBO.
    if(d&&d.slug===t.active.slug&&nowMs-d.asOf<4000&&nowMs>=d.asOf){
      const exit=X.quote(d.book,t.active.side,'SELL',X.POSITIONS);
      const buyPx=t.active.depthEntryPrice;
      if(exit?.filled&&Number.isFinite(buyPx)&&Math.abs(exit.top-bid)<=.011){
        const theta=X.FEE_COEFFICIENTS.includes(t.active.feeCoefficient)?t.active.feeCoefficient:.095;
        const entryFee=X.feeForOrder(buyPx,X.POSITIONS,theta);
        const exitFee=X.feeForOrder(exit.price,X.POSITIONS,theta);
        t.active.estimatedNetDollars=Math.round(((exit.price-buyPx)*X.POSITIONS-entryFee-exitFee)*100)/100;
        t.active.costedExitPrice=exit.price;t.active.exitDepthAt=d.asOf;
      }
    }
  }
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
    expirePaperIfNeeded(Date.now());
    state.lastWindow=start;state.market=null;state.book=null;state.secondCandles=[];
    state.trend=null;state.liveSpot=null;state.liveSecondAt=0;
    state.marketAt=state.bookAt=state.referenceAt=state.depthAt=0;state.depth=null;state.nextDepthAt=0;
    state.tracker.pending=null;state.tracker.confirmedKey=null;
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
async function refreshDepth(){
  if(!state.market||Date.now()<state.nextDepthAt)return;
  // An occasional L2 snapshot avoids hammering the /book endpoint every 1s.
  state.nextDepthAt=Date.now()+DEPTH_MS;
  try{
    const current=state.market.slug;
    const response=await abortable(`${API}/v1/markets/${encodeURIComponent(current)}/book`);
    const book=X.parseBook(response);
    if(state.market?.slug!==current)return;
    state.depth={slug:current,book,asOf:Date.now()};state.depthAt=state.depth.asOf;
    state.depthErrors=[];
  }catch(err){
    state.depthErrors=[err.message];
    if(err.status===429)state.nextDepthAt=Date.now()+Math.max(15000,err.retryAfterMs||15000);
    else state.nextDepthAt=Date.now()+DEPTH_MS;
    // Stale depth is NEVER treated as a valid execution check.
  }
}
async function refreshReferences(nowS){
  // Use official Polymarket US reference API; pull last 70s of 1-second points every fast cycle.
  const start=Math.floor(nowS)-75;
  const endpoint=`${API}/v1/asset-prices/history?assets=crypto%3Abtc&from=${start}&to=0`;
  const oneSec=abortable(`${endpoint}&bucket=ASSET_PRICE_BUCKET_1S`).then(response=>{
    const item=response?.series?.find(s=>s?.asset?.symbol?.toLowerCase()==='btc');
    if(!Array.isArray(item?.candles)||!item.candles.length)throw Error('Empty BTC reference series.');
    state.secondCandles=item.candles;state.referenceAt=Date.now();
    const last=item.candles[item.candles.length-1];
    state.liveSpot=E.n(last?.close);state.liveSecondAt=E.n(last?.timestamp);
  });
  const shouldMinute=!state.minuteCandles.length||Date.now()-state.minuteAt>45000;
  const minute=shouldMinute?abortable(`${API}/v1/asset-prices/history?assets=crypto%3Abtc&from=${Math.floor(nowS)-2100}&to=0&bucket=ASSET_PRICE_BUCKET_1M`).then(response=>{
    const item=response?.series?.find(s=>s?.asset?.symbol?.toLowerCase()==='btc');
    if(!Array.isArray(item?.candles)||!item.candles.length)throw Error('Empty BTC minute series.');
    state.minuteCandles=item.candles;state.minuteAt=Date.now();
  }):Promise.resolve();
  const settled=await Promise.allSettled([oneSec,minute]);
  const failures=settled.filter(s=>s.status==='rejected');
  if(failures.length){
    const err=failures[0].reason||Error('Reference feed unavailable');
    if(failures.length>1)err.message+='; '+(failures[1].reason?.message||'feed unavailable');
    throw err;
  }
  // Momentum/trend is intentionally recomputed only on the 5-second model cadence.
}
function ensureFreshness(){
 const now=Date.now();
 if(now-state.bookAt>4000)throw Error('Order book is stale: entry and exit recommendations paused.');
 if(now-state.referenceAt>4000||Math.floor(now/1000)-state.liveSecondAt>15||state.liveSecondAt>Math.floor(now/1000)+5)throw Error('BRTI reference timestamp is stale or invalid.');
 if(now-state.minuteAt>90000||!state.minuteCandles.length)throw Error('Minute reference history is stale.');
 if(now-state.marketAt>120000)throw Error('Market verification expired.');
}
function invalidateLiveSignal(reason){
  const s=state.signal;
  if(s&&['TRADE','CONFIRMING'].includes(s.type)){
    state.signal={...s,type:'WAIT',reasons:[reason,...(s.reasons||[])]};
    state.tracker.pending=null;state.tracker.confirmedKey=null;
  }
}
function quoteGuard(){
  const s=state.signal;
  if(!s||!['TRADE','CONFIRMING'].includes(s.type))return;
  const nowMs=Date.now(),nowS=Math.floor(nowMs/1000);
  if(document.visibilityState==='hidden'||!state.connected||!state.market||
     state.market.slug!==E.slugFor(nowS)||
     nowMs-state.bookAt>4000||nowMs-state.referenceAt>4000||
     nowS-state.liveSecondAt>15||state.liveSecondAt>nowS+5||
     !Number.isFinite(s.end)||s.end-nowS<=100){
    invalidateLiveSignal('Market window changed, near expiry, or the latest quote/index is stale.');return;
  }
  const q=state.book?.[s.side];
  if(!state.depth||state.depth.slug!==state.market.slug||nowMs-state.depth.asOf>18000){invalidateLiveSignal('Full book expired; reconfirm when fresh depth arrives.');return;}
  if(!q||!Number.isFinite(q.ask)||!Number.isFinite(q.bid)||q.ask>.84||q.ask<.08||
     q.spread>.085||s.modelFair-q.ask<s.requiredEdge||
     !Number.isFinite(s.entry)||Math.abs(q.ask-s.entry)>.03||
     (Number.isFinite(s.tp)&&q.bid>=s.tp)||(Number.isFinite(s.sl)&&q.bid<=s.sl)){
   invalidateLiveSignal('The quote moved, hit the exit zone, or lost its required modeled edge. A fresh model confirmation is needed.');
  }
}function assessModel(nowMs){
 const nowS=Math.floor(nowMs/1000);
 ensureFreshness();
 state.trend=E.collectTrend(state.minuteCandles,state.secondCandles,nowS);
 const bucket=C.bandFor(state.market?.assetPriceTerms ?
   (Date.parse(state.market.assetPriceTerms.windowEnd||state.market.endDate)-nowMs)/1000 : NaN);
 const info=state.calibrationReport?.bands.find(b=>b.band===bucket);
 const raw=E.evaluate({market:state.market,book:state.book,trend:state.trend,nowS,
  calibration:info?.validated?info:null});
 capturePrediction(raw,state.market.slug,nowMs);
 const screened=X.riskCheck({...raw,marketSlug:state.market.slug},state.depth,state.trend,feeTheta);
 state.signal=T.confirmSignal(state.tracker,screened,state.market.slug,nowMs,state.trend.priceAt);
 autoRecordConfirmed(state.signal,nowMs);
 state.lastEvalAt=nowMs;state.cycleAt=nowMs;
}
async function fastCycle(){
 if(state.inFlight||document.visibilityState==='hidden'||Date.now()<state.nextRequestAt)return;
 state.inFlight=true;
 try{
   const nowS=Math.floor(Date.now()/1000);
   await refreshMarket(nowS);
   const readings=await Promise.allSettled([refreshBook(),refreshReferences(nowS),refreshDepth()]);
   const problems=readings.slice(0,2).filter(x=>x.status==='rejected');
   if(problems.length){const error=problems[0].reason||Error('Market feed unavailable.');
     if(problems.length>1)error.message+='; '+(problems[1].reason?.message||'feed unavailable');
     throw error;
   }
   ensureFreshness();
   const nowMs=Date.now();
   updatePaperTracking(nowMs); // Fast 1-second observations independent of 5s model.
   state.connected=true;state.failures=0;state.errors=[];state.fastAt=nowMs;
   state.nextRequestAt=0;
   if(!state.signal||nowMs-state.lastEvalAt>=MODEL_MS)assessModel(nowMs);
   else quoteGuard();
   setConnection('LIVE','green');
 }catch(error){
   state.connected=false;state.failures++;state.errors=[error?.message||String(error)];
   state.tracker.pending=null;state.tracker.confirmedKey=null;
   expirePaperIfNeeded(Date.now());
   const ms=error?.status===429?Math.max(8000,error.retryAfterMs||0):
     Math.min(30000,1000*Math.pow(2,Math.min(5,state.failures)));
   state.nextRequestAt=Date.now()+Math.min(120000,ms);
   state.signal={type:'WAIT',side:null,score:null,probUp:null,
      reasons:[...state.errors,`Retrying after ${Math.ceil(ms/1000)} seconds. No entry until feeds recover.`],blockers:[...state.errors]};
   setConnection(error?.status===429?'RATE LIMITED':'DATA DELAY','red');
 }finally{state.inFlight=false;render();}
}
function render(){
  const s=state.signal||{type:'WAIT',reasons:['Connecting to market…']};
  const trade=state.connected&&s.type==='TRADE', confirming=state.connected&&s.type==='CONFIRMING';
  const paper=state.tracker.active;
  const label=trade?'BUY '+s.side:confirming?'CONFIRMING '+s.side:'NO TRADE';
  const signalEl=$('signalName');
  signalEl.textContent=state.connected?label:'DATA UNAVAILABLE';
  signalEl.className='signal-name '+(trade?'buy-'+s.side.toLowerCase():'wait');
  const detail=trade?`Three model checks confirmed over ≥10 seconds. Estimated model edge ${(s.edge*100).toFixed(1)}¢ versus current ask.`:
    (s.reasons?.[0]||'Checking entry quality…');
  setText('signalDetail',detail);
  setText('quality',Number.isFinite(s.score)?String(s.score):'--');
  setText('upProbability',Number.isFinite(s.probUp)?`${(s.probUp*100).toFixed(1)}%`:'--');
  setText('probSource',s.probabilitySource==='CALIBRATED'?'Validated adjusted estimate':'Uncalibrated estimate');
  $('meterFill').style.width=Number.isFinite(s.score)?`${s.score}%`:'0%';
  // Keep the original paper entry/target/stop visible if new entries are rejected.
  // These are clearly marked PAPER, never presented as a fresh BUY signal.
  const displayed=trade?s:paper;
  setText('entry',displayed?cents(displayed.entry):'--');
  setText('entryNote',trade?`${s.side} contract · CONFIRMED live ask`:
    paper?`LOCKED PAPER ${paper.side} · not a new entry signal`:
    confirming?'Confirming 3 consecutive 5s checks':'No approved setup');
  setText('takeProfit',displayed?cents(displayed.tp):'--');
  setText('stopLoss',displayed?cents(displayed.sl):'--');
  const liveSide=trade?s.side:paper?.side;
  setText('exitNow',liveSide&&state.connected&&state.book?.[liveSide]?cents(state.book[liveSide].bid):'--');
  setText('exitNowNote',liveSide?(state.connected?`${liveSide} contract · live best bid`:'Live exit quote unavailable'):'Quoted bid shown on market table');
  setText('btcPrice',fmtUsd(state.liveSpot));
  setText('priceToBeat',fmtUsd(s.strike||E.n(state.market?.assetPriceTerms?.priceToBeat)));
  const strike=E.n(state.market?.assetPriceTerms?.priceToBeat);
  const gap=strike>0&&state.liveSpot?100*(state.liveSpot/strike-1):NaN;
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
  setText('stressEdge',Number.isFinite(s.stressedEdge)?signed(s.stressedEdge*100,1,'¢'):'--');
  setText('momentumAgreement',s.momentumAlignment||'--');
  setText('regime',s.regime||'--');
  setText('netEdge',Number.isFinite(s.netEdge)?signed(s.netEdge*100,1,'¢'):'--');
  setText('depthImpact',Number.isFinite(s.depthImpact)?`${(s.depthImpact*100).toFixed(1)}¢`:'--');
  setText('feeEstimate',Number.isFinite(s.feeEstimate)?`${(s.feeEstimate*100).toFixed(2)}¢`:'--');
  setText('depthSummary',state.depth&&state.market?.slug===state.depth.slug?`Last book ${clock(state.depth.asOf)} · ${state.depth.book.bids.length} bid levels / ${state.depth.book.offers.length} offer levels · ${(Date.now()-state.depth.asOf<18000)?'fresh':'stale'}`:`Awaiting full depth · ${state.depthErrors.join(' · ')||'no snapshot yet'}`);
  setText('dataAge',state.liveSecondAt?`${Math.max(0,Math.floor(Date.now()/1000-state.liveSecondAt))}s`:'--');
  setText('referenceStatus',state.liveSecondAt?`Index ${clock(state.liveSecondAt*1000)}`:'Index unavailable');
  $('referenceDot').className='small-dot '+(state.connected?'green':'red');
  const reasons=$('reasons');reasons.replaceChildren();
  for(const reason of (s.reasons||['No decision yet.'])){const li=document.createElement('li');li.textContent=reason;reasons.append(li);}
  setText('dMarket',state.market?.slug||'Not found');
  setText('dBook',state.bookAt?`${clock(state.bookAt)} · ${book?.state||'unknown'} · L2 ${state.depthAt?clock(state.depthAt):'unavailable'}`:'Unavailable');
  setText('dBRTI',state.referenceAt?`${clock(state.referenceAt)} · ${state.secondCandles.length} reference seconds`:'Unavailable');
  setText('dRefresh',state.fastAt?`${clock(state.fastAt)} price · ${state.cycleAt?clock(state.cycleAt):'--'} model`:'Not yet completed');
  setText('diagnosticsText',state.errors.length?`Last error: ${state.errors.join(' · ')}`:'Reference and order-book reads are independent. A missing feed disables new trade signals.');
  const cooldown=Math.max(0,Math.ceil((state.nextRequestAt-Date.now())/1000));
  setText('refreshLabel',cooldown?`Cooldown ${cooldown}s · auto backoff`:'Target 1s quotes/index · 5s model');
  // Public event pages omit the 'cpc-' instrument prefix used by the US gateway.
  const eventSlug=state.market?.slug?.replace(/^cpc-/, '');
  const marketHref=eventSlug?`https://polymarket.us/event/${encodeURIComponent(eventSlug)}`:'https://polymarket.us';
  $('marketLink').href=marketHref;
  $('clearButton').disabled=!paper;
  $('exportButton').disabled=!state.tracker.history.length;
  $('clearHistoryButton').disabled=!state.tracker.history.length;
  renderPaper();renderCalibration();if(Date.now()-state.lastChartAt>=4500){draw();state.lastChartAt=Date.now();}tick();
}
function renderPaper(){
  const a=state.tracker.active;
  setText('paperStatus',a?'ACTIVE PAPER':'LOCAL SIMULATION');
  if(!a)setText('watchText','No active paper setup. A confirmed BUY signal is automatically recorded here.');
  else{
    const missing=Date.now()-a.lastSeenAt>5000;
    const move=(a.lastBid-a.entry)*100;
    setText('watchText',`${a.side} · locked ${cents(a.entry)} entry / ${cents(a.tp)} target / ${cents(a.sl)} stop · Quality ${a.score}/100. `+
      `${missing?'Last observed':'Observed'} bid ${cents(a.lastBid)} (${signed(move,1,'¢')} vs hypothetical ask). `+
      `${a.observationCount} observed quotes; no actual shares purchased.`);
  }
  const sum=T.stats(state.tracker.history);
  setText('perfSummary',`${sum.total} archived setups · ${sum.target} target touches · ${sum.stop} stop touches · ${sum.unresolved} unresolved`);
  const costed=state.tracker.history.filter(h=>Number.isFinite(h.estimatedNetDollars));
  const pnl=costed.reduce((a,h)=>a+h.estimatedNetDollars,0);
  setText('costedSummary',costed.length?`${costed.length} depth-observed illustrative exits · ${pnl>=0?'+':''}$${pnl.toFixed(2)} net estimated for 5 contracts each (not executed)`:'No depth-validated entry/exit paper estimates yet; touch counts are not P/L.');
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
    const net=Number.isFinite(h.estimatedNetDollars)?` · est. $${h.estimatedNetDollars.toFixed(2)} net/5`:' · no fill-cost estimate';
    li.textContent=`${new Date(h.openedAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · ${h.side} · ${h.score}/100 · ${status}${move}${net}`;
    ul.append(li);
  }
  if(!state.tracker.history.length){const li=document.createElement('li');li.textContent='No finished paper setups yet.';ul.append(li);}
}
function renderCalibration(){
 const report=state.calibrationReport||C.totals(state.calibration);
 setText('calibrationSummary',`${report.verified} verified snapshots from ${report.verifiedMarkets} settled markets · ${report.pending} awaiting settlement`);
 const ul=$('calibrationBands');ul.replaceChildren();
 for(const b of report.bands){
   const li=document.createElement('div');li.className='bucket-row';
   const label=document.createElement('span');label.textContent=`${b.band} · ${b.count}/240 verified`;
   const value=document.createElement('b');
   value.textContent=b.validated?`Validated · T=${b.temperature.toFixed(1)}`:'Uncalibrated';
   li.title=b.reason;li.append(label,value);ul.append(li);
 }
 $('exportCalibration').disabled=!report.samples;
 $('clearCalibration').disabled=!report.samples;
 $('syncCalibration').disabled=!C.pendingSlugs(state.calibration,Date.now()).length;
}
function tick(){
  const nowS=Date.now()/1000;
  const wasActionable=['TRADE','CONFIRMING'].includes(state.signal?.type);
  quoteGuard();
  // Render the rejection immediately rather than leaving a BUY visible until the
  // next asynchronous network refresh (which can be delayed on iPhones).
  if(wasActionable&&state.signal?.type==='WAIT'){
    setText('signalName',state.connected?'NO TRADE':'DATA UNAVAILABLE');
    $('signalName').className='signal-name wait';
    setText('signalDetail',state.signal.reasons?.[0]||'Checking fresh quotes…');
    setText('entryNote',state.tracker.active?`LOCKED PAPER ${state.tracker.active.side} · not a new entry signal`:'No approved setup');
  }
  const start=marketStart(nowS),left=(start+900)-nowS;
  const min=Math.floor(Math.max(0,left)/60),sec=Math.floor(Math.max(0,left)%60);
  setText('countdown',`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} REMAINING`);
  setText('windowBadge',new Date(start*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
  if(state.liveSecondAt){setText('dataAge',`${Math.max(0,Math.floor(nowS-state.liveSecondAt))}s`);}
  if(state.connected&&(Date.now()-state.fastAt>5000)){
    state.connected=false;invalidateLiveSignal('Data polling stalled. Reconfirm after fresh updates.');
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
function downloadCSV(csv,name){
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
 const href=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=href;a.download=name+'-'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),5000);
}
function wire(){
 try{const saved=Number(localStorage.getItem(FEE_KEY));if(X.FEE_COEFFICIENTS.includes(saved))feeTheta=saved;}catch(e){}
 $('feeTier').value=String(feeTheta);
 $('feeTier').addEventListener('change',()=>{const next=Number($('feeTier').value);if(!X.FEE_COEFFICIENTS.includes(next))return;feeTheta=next;try{localStorage.setItem(FEE_KEY,String(next));}catch(e){}state.signal={type:'WAIT',reasons:['Fee tier changed. Waiting for three new checks.']};state.lastEvalAt=0;state.tracker.pending=null;state.tracker.confirmedKey=null;render();});
 $('clearButton').addEventListener('click',()=>{
   const t=state.tracker;
   if(!t.active)return;
   T.closePaper(t.active,'USER_DISMISSED',Date.now(),null);
   T.archive(t);saveTracker();render();
 });
 $('exportButton').addEventListener('click',()=>{
   if(!state.tracker.history.length)return;
   downloadCSV(T.asCSV(state.tracker.history),'poly-paper-history');
 });
 $('clearHistoryButton').addEventListener('click',()=>{
   if(!state.tracker.history.length||!window.confirm('Delete all locally stored paper history on this device? This cannot be undone.'))return;
   state.tracker.history=[];saveTracker();render();
 });
 $('refreshButton').addEventListener('click',()=>{state.marketAt=0;state.minuteAt=0;state.nextRequestAt=0;fastCycle();});
 $('exportCalibration').addEventListener('click',()=>downloadCSV(C.asCSV(state.calibration),'poly-probability-data'));
 $('syncCalibration').addEventListener('click',()=>syncSettlement(true));
 $('clearCalibration').addEventListener('click',()=>{
   if(!window.confirm('Delete ALL saved probability snapshots and verified outcomes on this iPhone? This cannot be undone.'))return;
   state.calibration=C.freshState();state.settlementTries={};saveCalibration();updateCalibrationReport();render();
 });
 $('copyDiag').addEventListener('click',async()=>{
  const info={at:new Date().toISOString(),market:state.market?.slug,connected:state.connected,
    bookAt:state.bookAt,referenceAt:state.referenceAt,errors:state.errors,
    signal:state.signal?.type,paperActive:!!state.tracker.active,paperHistory:state.tracker.history.length,
    ageSeconds:state.liveSecondAt?Math.floor(Date.now()/1000-state.liveSecondAt):null,
    calibration:state.calibrationReport?.bands.map(b=>({band:b.band,count:b.count,validated:b.validated})),
    depthAgeSeconds:state.depth?Math.floor((Date.now()-state.depth.asOf)/1000):null,
    lastDepthError:state.depthErrors,feeTheta,regime:state.signal?.regime,netEdge:state.signal?.netEdge,
    nextRequestInSeconds:Math.max(0,Math.ceil((state.nextRequestAt-Date.now())/1000))};
  const msg=JSON.stringify(info,null,2);
  try{await navigator.clipboard.writeText(msg);setText('copyDiag','Copied diagnostics');}
  catch(err){setText('copyDiag','Clipboard blocked · select text manually');}
 });
 window.addEventListener('resize',draw);
 document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='hidden'){state.connected=false;invalidateLiveSignal('App in background; live entry is unavailable.');}
   if(document.visibilityState==='visible'){
     // iOS may suspend the app; require fresh data and new confirmation.
     setConnection('RECONNECT','amber');state.connected=false;state.cycleAt=0;state.fastAt=0;
     state.lastEvalAt=0;state.marketAt=0;state.nextRequestAt=0;state.depth=null;state.depthAt=0;state.nextDepthAt=0;
     state.tracker.pending=null;state.tracker.confirmedKey=null;
     expirePaperIfNeeded(Date.now());fastCycle();syncSettlement(true);
   }
 });
 window.addEventListener('online',()=>{state.nextRequestAt=0;fastCycle();});
}
function boot(){
 initTracker();loadCalibration();expirePaperIfNeeded(Date.now());wire();render();fastCycle();
 setInterval(fastCycle,FAST_MS);
 setInterval(tick,1000);
 setInterval(()=>syncSettlement(false),20000); // bounded background task ONLY while page is active
 if('serviceWorker'in navigator&&location.protocol==='https:'){
   navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('PWA install unavailable',err));
 }
}
boot();
})();
