/* Polymarket US BTC Signal - deterministic strategy functions.
 * The score is a HEURISTIC setup-quality score, NOT a calibrated probability.
 * Reference candles are obtained from Polymarket US, NOT an exchange spot proxy.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PolyEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const n=x=>{
  if(x===null||x===undefined||x==='')return NaN;
  if(x && typeof x==='object' && 'value' in x) x=x.value;
  const v=Number(x);return Number.isFinite(v)?v:NaN;
};
const round=(x,d=2)=>Number.isFinite(x)?Number(x.toFixed(d)):NaN;
function slugFor(seconds){
  const windowStart=Math.floor(seconds/900)*900;
  const d=new Date(windowStart*1000);
  return 'cpc-btc-updown-15m-'+d.toISOString().slice(0,10)+'-'+d.toISOString().slice(11,16).replace(':','')+'z';
}
function avg(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;}
function stdev(a){if(a.length<3)return NaN;const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)**2)));}
function cdf(x){ // Abramowitz-Stegun approximation to normal CDF.
  const z=Math.abs(x),t=1/(1+.2316419*z),
  density=.3989422804014327*Math.exp(-z*z/2);
  const tail=density*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x>=0?1-tail:tail;
}
function candleAt(candles,ageMin){
  const target=candles[candles.length-1].timestamp-ageMin*60;
  for(let i=candles.length-1;i>=0;i--)if(candles[i].timestamp<=target)return candles[i];
  return null;
}
function collectTrend(minuteCandles,secondCandles,nowS){
  const mins=(minuteCandles||[]).map(c=>({timestamp:n(c.timestamp),close:n(c.close),tickCount:n(c.tickCount)}))
    .filter(c=>Number.isFinite(c.timestamp)&&c.close>0&&c.tickCount>0).sort((a,b)=>a.timestamp-b.timestamp);
  const secs=(secondCandles||[]).map(c=>({timestamp:n(c.timestamp),close:n(c.close),tickCount:n(c.tickCount)}))
    .filter(c=>Number.isFinite(c.timestamp)&&c.close>0&&c.tickCount>0).sort((a,b)=>a.timestamp-b.timestamp);
  const latest=secs[secs.length-1];
  if(!latest||nowS-latest.timestamp>15||latest.timestamp>nowS+5)throw Error('BRTI reference timestamp is stale or ahead of device time; new signals paused.');
  if(mins.length<12)throw Error('Insufficient reference history (need at least 12 real 1-minute candles).');
  const spot=latest.close;
  const recent=mins.filter(c=>c.timestamp<=Math.floor(nowS/60)*60);
  const last=recent[recent.length-1];
  const at=(minutes)=>{
    // Use last precise second for the current value and minute history for lookback.
    const target=nowS-minutes*60;
    let match=null;
    for(const c of recent){if(c.timestamp<=target)match=c;else break;}
    return match?.close||NaN;
  };
  const pct=(minutes)=>{const base=at(minutes);return base>0?(spot/base-1)*100:NaN;};
  const r1=pct(1),r3=pct(3),r5=pct(5),r10=pct(10);
  if(![r1,r3,r5,r10].every(Number.isFinite))throw Error('Waiting for complete momentum history.');
  const returns=[];
  for(let i=1;i<recent.length;i++){
    const a=recent[i-1],b=recent[i];
    // Do not interpret gaps as real consecutive-minute returns.
    if(b.timestamp-a.timestamp===60)returns.push(Math.log(b.close/a.close));
  }
  if(returns.length<8)throw Error('Too few continuous 1-minute BRTI changes to estimate volatility.');
  const sigma=clamp(stdev(returns.slice(-25))||0.0005,0.00045,0.006);
  // Last 20 seconds of change, useful for seeing reversals but deliberately low weight.
  let short=null;
  for(const c of secs){if(c.timestamp<=latest.timestamp-20)short=c;else break;}
  const r20=short?((spot/short.close-1)*100):0;
  return {spot,priceAt:latest.timestamp,r1,r3,r5,r10,r20,sigma,volSamples:returns.length,points:mins,seconds:secs};
}
function quotesFromBbo(raw){
  // US single binary CLOB: bestAsk/bestBid quote the LONG/Up side.
  // In the complementary NO/Down outcome: ask=1-upBid, bid=1-upAsk.
  const v=raw?.marketData||raw;
  const upAsk=n(v?.bestAsk),upBid=n(v?.bestBid);
  if(!Number.isFinite(upAsk)||!Number.isFinite(upBid))throw Error('Order book has no two-sided executable quotes.');
  if(upAsk<=0||upAsk>=1||upBid<=0||upBid>=1||upAsk<upBid)throw Error('Invalid or crossed UP order book.');
  return {
    UP:{ask:upAsk,bid:upBid,spread:upAsk-upBid},
    DOWN:{ask:1-upBid,bid:1-upAsk,spread:upAsk-upBid},
    state:String(v?.state||''),
    bidDepth:n(v?.bidDepth),askDepth:n(v?.askDepth),
    asOf:Date.now()
  };
}
function evaluate({market,book,trend,nowS,calibration=null}){
  const reasons=[], blockers=[];
  const terms=market?.assetPriceTerms||{};
  const start=Date.parse(terms.windowStart||market?.startDate||'')/1000;
  const end=Date.parse(terms.windowEnd||market?.endDate||'')/1000;
  const strike=n(terms.priceToBeat);
  const result={type:'WAIT',side:null,score:null,probUp:null,entry:null,tp:null,sl:null,
    spread:null,edge:null,stressedEdge:null,requiredEdge:null,modelFair:null,limit:null,momentumAlignment:null,
    reasons,blockers,start,end,strike,secondsLeft:Number.isFinite(end)?end-nowS:NaN};
  if(!Number.isFinite(start)||!Number.isFinite(end)||Math.abs(end-start-900)>5 ||
    Math.abs(start-Math.floor(nowS/900)*900)>5)blockers.push('Official market window does not match the current 15-minute slot.');
  if(!String(market?.slug||'').startsWith('cpc-btc-updown-15m-')||terms.asset?.symbol?.toLowerCase()!=='btc')blockers.push('Not a verified BTC 15-minute market.');
  if(market?.closed===true||market?.active===false||(/RESOLVED|CLOSED|HALT|SUSPEND/i.test(String(market?.status||''))))blockers.push('Market is closed or not tradeable.');
  if(book?.state && !/OPEN/i.test(book.state))blockers.push('Order book is not open.');
  if(!(strike>0))blockers.push('Official price to beat has not been published.');
  if(result.secondsLeft<=100)blockers.push('Too close to the final BRTI settlement averaging minute.');
  if(nowS-start<40)blockers.push('Opening volatility: waiting 40 seconds.');
  if(trend?.priceAt==null||nowS-trend.priceAt>15||trend.priceAt>nowS+5)blockers.push('Reference feed timestamp is invalid or stale.');
  if(!trend?.spot||!book?.UP||!book?.DOWN)blockers.push('Live quotes or reference price missing.');
  if(blockers.length){result.reasons=[...blockers];return result;}

  const leftM=Math.max(1/60,result.secondsLeft/60);
  const logGap=Math.log(trend.spot/strike);
  const gapPct=(trend.spot/strike-1)*100;
  // Trend per minute in log-space. Shrunk to reduce momentum overfitting.
  const driftPctPerM=.38*trend.r1+.33*(trend.r3/3)+.19*(trend.r5/5)+.10*(trend.r10/10);
  const projectedDrift=clamp(driftPctPerM/100*leftM*.30,-2*trend.sigma,2*trend.sigma);
  // The settlement compares an average over the LAST minute, not a single tick.
  const effectiveM=Math.max(0.65,leftM-.5);
  const sigmaAtEnd=Math.max(0.0007,trend.sigma*Math.sqrt(effectiveM));
  const pRaw=cdf((logGap+projectedDrift)/sigmaAtEnd);
  const rawProbUp=clamp(.5+(pRaw-.5)*.80,.08,.92); // original uncalibrated model
  const calibrated=calibration?.validated===true&&Number.isFinite(calibration?.temperature)&&calibration.temperature>=.7&&calibration.temperature<=4;
  const pUp=calibrated?clamp(1/(1+Math.exp(-Math.log(rawProbUp/(1-rawProbUp))/calibration.temperature)),.01,.99):rawProbUp;
  const side=pUp>=.5?'UP':'DOWN';
  const q=book[side],fair=side==='UP'?pUp:1-pUp;
  const spread=q.spread;
  const liquidityPlausible=Number.isFinite(spread)&&spread>=0&&spread<=.085;
  const nearLimit=q.ask>.84||q.ask<.08;
  // Fee/slippage precaution: model does NOT know your realized fee tier or fill price.
  const feeSlippageReserve=.025+spread*.23;
  const minEdge=.025+feeSlippageReserve;
  const edge=fair-q.ask;
  const shortMom=.65*trend.r1+.35*trend.r20;
  const longerMom=.58*(trend.r5/5)+.42*(trend.r10/10);
  const hardReversal=(side==='UP'&&shortMom<-.07&&longerMom>.02)||
                     (side==='DOWN'&&shortMom>.07&&longerMom<-.02);
  const tinySignal=Math.abs(pUp-.5)<.035;
  // Additional risk filters only; the raw probability formula remains IDENTICAL to v1.6,
  // so existing settlement-calibration observations remain comparable and are preserved.
  const direction=side==='UP'?1:-1;
  const oneMinuteVolPct=trend.sigma*100;
  const horizons=[{returnPct:trend.r1,minutes:1},{returnPct:trend.r3,minutes:3},{returnPct:trend.r5,minutes:5}];
  const aligned=horizons.filter(h=>direction*h.returnPct>Math.max(.012,oneMinuteVolPct*.18*Math.sqrt(h.minutes))).length;
  const opposedStrong=horizons.filter(h=>direction*h.returnPct<-Math.max(.035,oneMinuteVolPct*.75*Math.sqrt(h.minutes))).length;
  const momentumAlignment=`${aligned}/3`;
  const abruptReversal=direction*trend.r20<-Math.max(.085,oneMinuteVolPct*1.25) &&
    direction*trend.r1<-Math.max(.035,oneMinuteVolPct*.65);
  // Probability-error stress: ask whether a deliberately less-confident version of
  // the same model still clears a small positive margin, instead of betting on the
  // model's most optimistic estimate. This is NOT a calibrated confidence interval.
  const stressedUp=.5+(pUp-.5)*.70;
  const stressedFair=side==='UP'?stressedUp:1-stressedUp;
  const stressedEdge=stressedFair-q.ask;
  const stressHurdle=calibrated ? .005 : .015;
  const shock=Number.isFinite(trend.r20) && Math.abs(trend.r20)>Math.max(.19,oneMinuteVolPct*2.65);
  const score=clamp(Math.round(49+Math.abs(pUp-.5)*83+Math.max(-.12,edge)*36-
    Math.max(0,spread-.025)*110-(hardReversal?8:0)-(opposedStrong>=2?9:0)-(shock?7:0)),0,96);
  Object.assign(result,{side,score,probUp:pUp,entry:q.ask,spread,edge,stressedEdge,momentumAlignment,requiredEdge:minEdge,
    modelFair:fair,limit:.84,gapPct,rawProbUp,probabilitySource:calibrated?'CALIBRATED':'UNCALIBRATED'});
  reasons.push(`Model estimate: Up ${(100*pUp).toFixed(1)}% / Down ${(100*(1-pUp)).toFixed(1)}% (${calibrated?'validated time-bucket adjustment':'uncalibrated'}).`);
  reasons.push(`BRTI gap vs. official start average: ${gapPct>=0?'+':''}${gapPct.toFixed(3)}%.`);
  reasons.push(`Momentum 1m ${trend.r1>=0?'+':''}${trend.r1.toFixed(3)}%, 3m ${trend.r3>=0?'+':''}${trend.r3.toFixed(3)}%, 5m ${trend.r5>=0?'+':''}${trend.r5.toFixed(3)}%.`);
  reasons.push(`Estimated value edge ${(edge*100).toFixed(1)}¢; hurdle ${(minEdge*100).toFixed(1)}¢ including a fee/slippage buffer.`);
  reasons.push(`Momentum agreement ${momentumAlignment} bullish/bearish horizons; conservative stress-margin ${(stressedEdge*100).toFixed(1)}¢ (not a confidence interval).`);
  if(!liquidityPlausible)blockers.push('Bid/ask spread exceeds 8.5¢, or book invalid.');
  if(nearLimit)blockers.push('Entry outside 8¢–84¢ range.');
  if(tinySignal)blockers.push('Near coin-flip BTC direction.');
  if(hardReversal && score<68)blockers.push('Short-term momentum reversal against the signal.');
  if(opposedStrong>=2)blockers.push('Two or more BTC momentum horizons strongly oppose this direction.');
  if(abruptReversal)blockers.push('Strong 20-second reversal against the trade direction.');
  if(shock)blockers.push('Rapid 20-second BTC jump: waiting for price/odds to stabilize.');
  if(stressedEdge<stressHurdle)blockers.push('Conservative probability stress test no longer supports the entry price.');
  if(edge<minEdge)blockers.push('Market already prices in the move; insufficient modeled edge.');
  if(score<54)blockers.push('Setup-quality score below 54/100.');
  if(blockers.length){result.reasons=[...blockers,...reasons];return result;}

  // Suggested profit-taking and risk stop measured in contract/share cents.
  // Exit tracking uses the EXECUTABLE BID for the selected side, not the mid.
  const profit=clamp(.09+(score-54)*.0025,.09,.18);
  const risk=clamp(.085+spread*.28,.085,.115);
  result.tp=round(Math.min(.985,q.ask+profit),3);
  result.sl=round(Math.max(.01,q.ask-risk),3);
  if(result.tp-q.ask<.055){result.blockers.push('Not enough remaining price room for an exit target.');result.reasons=[...result.blockers,...reasons];return result;}
  if((result.tp-q.ask)/Math.max(.001,q.ask-result.sl)<1.05){
    result.blockers.push('Suggested exit target does not sufficiently exceed downside risk.');
    result.reasons=[...result.blockers,...reasons];return result;
  }
  result.type='TRADE';
  reasons.push(`Target ${Math.round(result.tp*100)}¢; stop ${Math.round(result.sl*100)}¢. These are suggested triggers, not guaranteed fills.`);
  return result;
}
return {clamp,n,round,slugFor,cdf,collectTrend,quotesFromBbo,evaluate};
});
