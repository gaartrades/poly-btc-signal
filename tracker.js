/* Read-only, LOCAL paper-signal tracker.
 * A paper setup means that a hypothetical purchase was considered at the ASK;
 * stops/targets are BIDS OBSERVED in the foreground browser, never real fills.
 * Nothing here places an order, measures account P/L, or calibrates probability.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.PolyTracker=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MAX_HISTORY=500;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*1000)/1000;
function freshState(){return {pending:null,confirmedKey:null,active:null,history:[]};}
function confirmSignal(tracker,raw,slug,nowMs,referenceSecond){
  if(!raw||raw.type!=='TRADE'||!slug){
    tracker.pending=null;tracker.confirmedKey=null;return raw;
  }
  const key=`${slug}|${raw.side}`;
  if(tracker.confirmedKey===key)return raw;
  const prev=tracker.pending;
  // Three consecutive 5-second MODEL evaluations with fresh reference seconds.
  // At least ~10 seconds must elapse between first and confirming evaluation.
  if(prev&&prev.key===key&&nowMs-prev.lastAt>=3500&&nowMs-prev.lastAt<=8500&&
     referenceSecond>prev.referenceSecond){
    prev.checks+=1;prev.lastAt=nowMs;prev.referenceSecond=referenceSecond;
    if(prev.checks>=3&&nowMs-prev.firstAt>=9500&&nowMs-prev.firstAt<=22000){
      tracker.pending=null;tracker.confirmedKey=key;
      return {...raw,reasons:['Qualified on 3 consecutive model checks spanning at least 10 seconds.',...(raw.reasons||[])]};
    }
  }else if(!prev||prev.key!==key||nowMs-prev.lastAt>8500||nowMs-prev.firstAt>22000){
    tracker.pending={key,firstAt:nowMs,lastAt:nowMs,referenceSecond,checks:1};
  }
  const count=tracker.pending?.checks||1;
  return {...raw,type:'CONFIRMING',reasons:[
    `Qualifying setup ${count}/3. Requires three 5-second model checks over at least 10 seconds with fresh BRTI data.`,
    ...(raw.reasons||[])
  ]};
}
function paperFromSignal(raw,slug,nowMs,marketEndS,bid){
  if(raw?.type!=='TRADE'||!slug||!['UP','DOWN'].includes(raw.side)||
    ![raw.entry,raw.tp,raw.sl,bid].every(finite)||!finite(marketEndS))return null;
  return {id:`${slug}|${nowMs}`,slug,side:raw.side,score:raw.score,strategyVersion:'v1.7',
    modelUp:raw.probUp,entry:round(raw.entry),tp:round(raw.tp),sl:round(raw.sl),
    edge:round(raw.edge),openedAt:nowMs,marketEndsAt:marketEndS*1000,
    lastBid:round(bid),highBid:round(bid),lowBid:round(bid),lastSeenAt:nowMs,
    observationCount:1,status:'ACTIVE',endedAt:null,exitBid:null,paperMoveCents:null};
}
function closePaper(paper,status,nowMs,bid){
  if(paper.status!=='ACTIVE')return paper;
  paper.status=status;paper.endedAt=nowMs;
  if(finite(bid)&&['TARGET_TOUCH','STOP_TOUCH'].includes(status)){
    paper.exitBid=round(bid);
    paper.paperMoveCents=Math.round((bid-paper.entry)*10000)/100;
  }
  return paper;
}
function advancePaper(paper,nowMs,currentSlug,bid){
  if(!paper||paper.status!=='ACTIVE')return paper;
  if(nowMs>=paper.marketEndsAt || currentSlug!==paper.slug){
    // No verified exit fill or official resolution price: do not assume a win/loss.
    return closePaper(paper,'WINDOW_ENDED_UNRESOLVED',nowMs,null);
  }
  if(!finite(bid)||bid<0||bid>1)return paper;
  paper.lastBid=round(bid);
  paper.highBid=Math.max(paper.highBid,paper.lastBid);
  paper.lowBid=Math.min(paper.lowBid,paper.lastBid);
  paper.lastSeenAt=nowMs;paper.observationCount+=1;
  if(bid>=paper.tp)return closePaper(paper,'TARGET_TOUCH',nowMs,bid);
  if(bid<=paper.sl)return closePaper(paper,'STOP_TOUCH',nowMs,bid);
  return paper;
}
function archive(tracker){
  if(!tracker.active||tracker.active.status==='ACTIVE')return false;
  if(!tracker.history.some(x=>x.id===tracker.active.id))tracker.history.unshift({...tracker.active});
  tracker.history=tracker.history.slice(0,MAX_HISTORY);
  tracker.active=null;
  return true;
}
function seenMarket(tracker,slug){
  return tracker.active?.slug===slug||tracker.history.some(x=>x.slug===slug);
}
function bucket(score){
  if(!finite(score))return 'Unknown';
  if(score>=80)return '80–100';
  if(score>=70)return '70–79';
  if(score>=60)return '60–69';
  return '0–59';
}
function stats(history){
  const out={total:0,target:0,stop:0,unresolved:0,buckets:{}};
  for(const name of ['0–59','60–69','70–79','80–100'])out.buckets[name]={total:0,target:0,stop:0,unresolved:0};
  for(const h of history||[]){
    if(!h||typeof h!=='object')continue;
    const b=out.buckets[bucket(h.score)];
    if(!b)continue;
    out.total++;b.total++;
    if(h.status==='TARGET_TOUCH'){out.target++;b.target++;}
    else if(h.status==='STOP_TOUCH'){out.stop++;b.stop++;}
    else {out.unresolved++;b.unresolved++;}
  }
  return out;
}
function restore(raw){
  const st=freshState();
  if(!raw||typeof raw!=='object')return st;
  if(Array.isArray(raw.history))st.history=raw.history.filter(x=>
    x && typeof x.id==='string' && typeof x.slug==='string' &&
    ['UP','DOWN'].includes(x.side)&&finite(x.entry)&&finite(x.score)&&
    typeof x.status==='string'&&x.status!=='ACTIVE').slice(0,MAX_HISTORY);
  const a=raw.active;
  if(a && typeof a.id==='string'&&typeof a.slug==='string'&&
      ['UP','DOWN'].includes(a.side)&&[a.entry,a.tp,a.sl,a.lastBid,a.marketEndsAt,a.openedAt].every(finite)&&
      a.status==='ACTIVE')st.active=a;
  return st;
}
function asCSV(history){
  const rows=[['Time','Market','Direction','Strategy version','Quality score','Entry ask cents','Target cents',
    'Stop cents','Observed outcome','Observed exit bid cents','Paper bid move cents','Observations']];
  for(const h of history||[])rows.push([
    new Date(h.openedAt).toISOString(),h.slug,h.side,h.strategyVersion||'legacy',h.score,
    (h.entry*100).toFixed(1),(h.tp*100).toFixed(1),(h.sl*100).toFixed(1),h.status,
    finite(h.exitBid)?(h.exitBid*100).toFixed(1):'',
    finite(h.paperMoveCents)?h.paperMoveCents.toFixed(2):'',h.observationCount||0
  ]);
  return rows.map(r=>r.map(s=>'"'+String(s??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
return {MAX_HISTORY,freshState,confirmSignal,paperFromSignal,advancePaper,closePaper,archive,seenMarket,bucket,stats,restore,asCSV};
});
