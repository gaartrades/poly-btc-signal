/* v1.8 Polymarket US: conservative quote-depth + estimated taker fee analytics.
   No account connection, executable orders, or asserted fills. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.PolyExecution=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const price=x=>{if(x&&typeof x==='object'&&'value' in x)x=x.value;const v=Number(x);return Number.isFinite(v)?v:NaN;};
const POSITIONS=5; // simulated 5-contract liquidity check; user should adjust size independently before real orders
const FEE_COEFFICIENTS=[.095,.085,.075,.0695];
function feePerContract(p,theta=.095){return finite(p)&&p>=0&&p<=1&&FEE_COEFFICIENTS.includes(theta)?theta*p*(1-p):NaN;}
function feeForOrder(p,count=POSITIONS,theta=.095){const total=feePerContract(p,theta)*count;return finite(total)?total:NaN;} // indicative, not exchange per-fill rounded fee
function parseLevels(levels,sort){
 if(!Array.isArray(levels))return [];
 return levels.map(x=>({px:price(x?.px??x?.price),qty:price(x?.qty??x?.quantity??x?.size)}))
 .filter(x=>x.px>0&&x.px<1&&x.qty>0)
 .sort((a,b)=>sort==='desc'?b.px-a.px:a.px-b.px);
}
function parseBook(raw){
 const v=raw?.marketData||raw;
 const bids=parseLevels(v?.bids,'desc'),offers=parseLevels(v?.offers,'asc');
 if(!bids.length||!offers.length||bids[0].px>=offers[0].px)throw Error('No valid, uncrossed order-book levels.');
 return {bids,offers,state:String(v?.state||''),transactTime:v?.transactTime||null};
}
function walk(levels,contracts){
 if(!finite(contracts)||contracts<=0)return {filled:false,vwap:NaN,visible:0,impact:NaN};
 let left=contracts,notional=0,visible=0;
 for(const l of levels){const used=Math.min(left,l.qty);notional+=used*l.px;visible+=used;left-=used;if(left<1e-8)break;}
 return {filled:left<1e-8,vwap:left<1e-8?notional/contracts:NaN,visible,needed:contracts};
}
function quote(book,side,action,contracts=POSITIONS){
 if(!book||!['UP','DOWN'].includes(side)||!['BUY','SELL'].includes(action))return null;
 // Polymarket US binary single-instrument: Buy DOWN == Sell UP exposure.
 // Prices and fees are expressed in the selected binary outcome convention.
 const onOffers=(side==='UP'&&action==='BUY')||(side==='DOWN'&&action==='SELL');
 const row=walk(onOffers?book.offers:book.bids,contracts);
 const selected=finite(row.vwap)?(side==='UP'?row.vwap:1-row.vwap):NaN;
 const top=onOffers?book.offers[0].px:book.bids[0].px;
 const expectedTop=side==='UP'?top:1-top;
 return {...row,price:selected,top:expectedTop,impact:finite(selected)?Math.abs(selected-expectedTop):NaN};
}
function opportunity(book,side,probability,theta=.095,contracts=POSITIONS){
 if(!FEE_COEFFICIENTS.includes(theta)||!(probability>0&&probability<1))return null;
 const buy=quote(book,side,'BUY',contracts),sell=quote(book,side,'SELL',contracts);
 if(!buy||!sell)return null;
 const entryFee=buy.filled?feeForOrder(buy.price,contracts,theta)/contracts:NaN;
 const exitFee=sell.filled?feeForOrder(sell.price,contracts,theta)/contracts:NaN;
 const targetSellFee=buy.filled?feeForOrder(Math.min(.99,buy.price+.12),contracts,theta)/contracts:NaN;
 return {buy,sell,contracts,theta,entryFee,exitFee,targetSellFee,
  modeledExpiryEdge:buy.filled?probability-buy.price-entryFee:NaN,
  // For planned early exits reserve the indicative fee at a plausible take-profit,
  // AND add a separate conservative reserve for shifting quotes.
  modeledRoundTripEdge:buy.filled?probability-buy.price-entryFee-targetSellFee-.01:NaN};
}
function regime(trend){
 const sigma=Number(trend?.sigma),r1=Number(trend?.r1),r5=Number(trend?.r5),r10=Number(trend?.r10);
 if(![sigma,r1,r5,r10].every(Number.isFinite))return {name:'UNKNOWN',additionalHurdle:.02};
 const net=(.55*(r5/5)+.45*(r10/10)),short=Math.abs(r1),vol=sigma*100;
 if(vol>.17||short>Math.max(.23,vol*2.2))return {name:'HIGH VOLATILITY',additionalHurdle:.025};
 if(Math.abs(net)<Math.max(.008,vol*.10))return {name:'RANGE',additionalHurdle:.012};
 if(Math.sign(r1)===Math.sign(net))return {name:'TREND',additionalHurdle:.005};
 return {name:'CHOPPY / REVERSAL',additionalHurdle:.025};
}
function riskCheck(result,depth,trend,theta=.095){
 const classification=regime(trend);
 const extra={regime:classification.name,depthVerified:false,netEdge:null,depthImpact:null,feeEstimate:null,depthAgeSeconds:null};
 if(result?.type!=='TRADE')return {...result,...extra};
 const deny=message=>({...result,...extra,type:'WAIT',reasons:[message,...(result.reasons||[])],blockers:[...(result.blockers||[]),message]});
 if(!depth||!Number.isFinite(depth.asOf))return deny('Full order-book depth unavailable: no new entry until verified.');
 const age=(Date.now()-depth.asOf)/1000;extra.depthAgeSeconds=age;
 if(age>18||age< -3)return deny('Full order-book depth is stale; waiting for a fresh snapshot.');
 if(depth.slug!==result.marketSlug && result.marketSlug)return deny('Full order-book snapshot belongs to a different market.');
 const book=depth.book;
 if(book?.state&&!/OPEN/i.test(book.state))return deny('Full order book is not in open state.');
 const o=opportunity(book,result.side,result.modelFair,theta,POSITIONS);
 if(!o?.buy?.filled||!o?.sell?.filled)return deny('Not enough visible liquidity for a five-contract illustrative entry AND exit.');
 if(Math.abs(o.buy.top-result.entry)>.011)return deny('Best quote and full depth disagree by over 1.1¢.');
 const acceptable=regime(trend).additionalHurdle;
 const edge=o.modeledRoundTripEdge;
 Object.assign(extra,{depthVerified:true,netEdge:edge,depthImpact:o.buy.impact,feeEstimate:o.entryFee+o.targetSellFee,
    depthBuyPrice:o.buy.price,depthBidPrice:o.sell.price,feeCoefficient:theta,regime:classification.name});
 if(o.buy.impact>.025)return deny('Buying five illustrative contracts has over 2.5¢ visible price impact.');
 if(!Number.isFinite(edge)||edge<Math.max(.025,acceptable))return deny('Insufficient edge after visible depth, estimated US taker fees and volatility reserve.');
 return {...result,...extra,reasons:[`Regime ${classification.name}; 5-contract depth impact ${(o.buy.impact*100).toFixed(1)}¢; estimated fees ${((o.entryFee+o.targetSellFee)*100).toFixed(2)}¢/contract.`,
   `Model-minus-cost margin ${(edge*100).toFixed(1)}¢ per contract (heuristic, unverified).`,...(result.reasons||[])]};
}
return {POSITIONS,FEE_COEFFICIENTS,feePerContract,feeForOrder,parseLevels,parseBook,walk,quote,opportunity,regime,riskCheck};
});
