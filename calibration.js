/* Local, settlement-verified probability calibration. v1.6
 * Never trains on target/stop touches or unverified price readings.
 * Learns separately for early/mid/late time horizons; strictly later holdout.
 * Calibrated estimates are enabled only after independent validation improves Brier score.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PolyCalibration=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const ENGINE_VERSION='brti-v16-base-1',MAX_SAMPLES=1800;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function bandFor(secondsLeft){return secondsLeft>600?'EARLY':secondsLeft>300?'MID':secondsLeft>100?'LATE':null;}
function freshState(){return {samples:[]};}
function sample(state,slug,raw,nowMs){
  const band=bandFor(raw?.secondsLeft),p=raw?.rawProbUp;
  if(!band||typeof slug!=='string'||!slug.startsWith('cpc-btc-updown-15m-')||!Number.isFinite(p)||p<=0||p>=1)return false;
  const id=slug+'|'+band;
  if(state.samples.some(s=>s.id===id))return false;
  state.samples.push({id,slug,band,engine:ENGINE_VERSION,at:nowMs,pRaw:p,outcome:null,verifiedAt:null,endMs:Number.isFinite(raw.end)?raw.end*1000:null});
  if(state.samples.length>MAX_SAMPLES)state.samples.splice(0,state.samples.length-MAX_SAMPLES);
  return true;
}
function applyTemperature(p,t){
  if(!(p>0&&p<1)||!(t>0))return p;
  const logit=Math.log(p/(1-p));return clamp(1/(1+Math.exp(-logit/t)),.01,.99);
}
function brier(rows,t){return rows.reduce((acc,r)=>acc+(applyTemperature(r.pRaw,t)-r.outcome)**2,0)/rows.length;}
function logLoss(rows,t){return rows.reduce((acc,r)=>{
  const p=clamp(applyTemperature(r.pRaw,t),.001,.999);
  return acc-(r.outcome?Math.log(p):Math.log(1-p));
},0)/rows.length;}
function calibrationFor(state,band){
  const rows=(state?.samples||[]).filter(s=>s.engine===ENGINE_VERSION&&s.band===band&&(s.outcome===0||s.outcome===1))
    .sort((a,b)=>a.at-b.at||a.slug.localeCompare(b.slug));
  const holdout=Math.max(60,Math.floor(rows.length*.25));
  const info={band,count:rows.length,required:240,holdout,validated:false,temperature:1,
    rawBrier:null,calibratedBrier:null,reason:'Awaiting 240 verified, time-bucket-matched outcomes.'};
  if(rows.length<240)return info;
  const train=rows.slice(0,rows.length-holdout),test=rows.slice(rows.length-holdout);
  const count1=rs=>rs.filter(r=>r.outcome===1).length;
  if(count1(train)<20||train.length-count1(train)<20||count1(test)<8||test.length-count1(test)<8){
    info.reason='Not enough UP and DOWN outcomes in training and independent holdout.';return info;
  }
  let bestT=1,best=Infinity;
  for(let i=7;i<=40;i++){
    const t=i/10;
    const objective=logLoss(train,t)+.0015*Math.log(t)**2;
    if(objective<best){best=objective;bestT=t;}
  }
  const rawBrier=brier(test,1),calBrier=brier(test,bestT);
  info.temperature=bestT;info.rawBrier=rawBrier;info.calibratedBrier=calBrier;
  if(calBrier<=rawBrier-.003 && logLoss(test,bestT)<=logLoss(test,1)+.002){
    info.validated=true;info.reason='Validated on later held-out markets; still not a guarantee.';
  }else info.reason='Adjustment did not reliably improve out-of-sample accuracy; raw estimate retained.';
  return info;
}
function verifiedSettlement(state,slug,settlement,marketStatus,nowMs){
  if(!/^(MARKET_STATUS_)?RESOLVED$/i.test(String(marketStatus||'')))return false;
  const v=(settlement&&typeof settlement==='object'&&'value'in settlement)?Number(settlement.value):Number(settlement);
  if(v!==0&&v!==1)return false; // No inferred winner from market quotes or intermediate prices.
  let changed=false;
  for(const r of state.samples){if(r.slug===slug&&r.outcome===null){r.outcome=v;r.verifiedAt=nowMs;changed=true;}}
  return changed;
}
function pendingSlugs(state,nowMs){
  return [...new Set(state.samples.filter(s=>s.outcome===null && (Number.isFinite(s.endMs)?s.endMs:s.at+900000)<nowMs-15000).map(s=>s.slug))];
}
function totals(state){
  const samples=state.samples||[];
  const verified=samples.filter(s=>s.outcome===0||s.outcome===1).length;
  const markets=new Set(samples.filter(s=>s.outcome===0||s.outcome===1).map(s=>s.slug)).size;
  return {samples:samples.length,verified,pending:samples.length-verified,verifiedMarkets:markets,
    bands:['EARLY','MID','LATE'].map(b=>calibrationFor(state,b))};
}
function restore(raw){const st=freshState();if(!raw||!Array.isArray(raw.samples))return st;
  const seen=new Set();
  st.samples=raw.samples.filter(s=>{
    if(!s||typeof s.id!=='string'||seen.has(s.id)||typeof s.slug!=='string'||!s.slug.startsWith('cpc-btc-updown-15m-')||
      !['EARLY','MID','LATE'].includes(s.band)||!Number.isFinite(s.at)||!Number.isFinite(s.pRaw)||!(s.pRaw>0&&s.pRaw<1)||
      ![null,0,1].includes(s.outcome)||typeof s.engine!=='string')return false;
    seen.add(s.id);return true;
  }).slice(-MAX_SAMPLES);
  return st;
}
function asCSV(state){
 const lines=[['Timestamp UTC','Market','Time band','Raw model UP probability','Official settled UP outcome (1/0)','Settlement verified UTC','Model version']];
 for(const s of state.samples)lines.push([new Date(s.at).toISOString(),s.slug,s.band,s.pRaw.toFixed(6),s.outcome===null?'':s.outcome,s.verifiedAt?new Date(s.verifiedAt).toISOString():'',s.engine]);
 return lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
return {ENGINE_VERSION,MAX_SAMPLES,bandFor,freshState,sample,applyTemperature,calibrationFor,verifiedSettlement,pendingSlugs,totals,restore,asCSV};
});
