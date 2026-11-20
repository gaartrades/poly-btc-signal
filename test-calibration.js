const assert=require('node:assert/strict');
const C=require('./calibration.js');
assert.equal(C.bandFor(720),'EARLY');assert.equal(C.bandFor(420),'MID');
assert.equal(C.bandFor(270),'LATE');assert.equal(C.bandFor(60),null);
const st=C.freshState();const base=Date.parse('2026-10-01T00:00:00Z');
for(let i=0;i<300;i++){
  const now=base+i*900000;
  const slug='cpc-btc-updown-15m-'+i;
  const pRaw=i%2===0?.90:.10;
  const y=i%2===0?(i%10<6?1:0):(i%10<6?0:1); // Empirical 60% / 40%, raw says 90% / 10%.
  assert(C.sample(st,slug,{rawProbUp:pRaw,secondsLeft:700,end:now/1000+900},now));
  assert(!C.sample(st,slug,{rawProbUp:pRaw,secondsLeft:700,end:now/1000+900},now+5000));
  assert(!C.verifiedSettlement(st,slug,y,'MARKET_STATUS_UNRESOLVED',now+100));
  assert(C.verifiedSettlement(st,slug,y,'MARKET_STATUS_RESOLVED',now+100));
}
const r=C.calibrationFor(st,'EARLY');
assert.equal(r.count,300);assert(r.validated,'Overconfident 90% estimate should improve on held-out data');
assert(r.temperature>1, 'Calibration should reduce overconfidence');
assert(C.applyTemperature(.9,r.temperature)<.9);
assert.equal(C.calibrationFor(st,'MID').validated,false);
const restored=C.restore(JSON.parse(JSON.stringify(st)));
assert.equal(restored.samples.length,300);assert.equal(C.totals(restored).verifiedMarkets,300);
assert(C.asCSV(restored).includes('Official settled UP outcome'));
const pending=C.freshState();
C.sample(pending,'cpc-btc-updown-15m-future',{rawProbUp:.6,secondsLeft:700,end:base/1000+900},base);
assert.equal(C.pendingSlugs(pending,base+5000).length,0);
assert.equal(C.pendingSlugs(pending,base+901000).length,0);
assert.equal(C.pendingSlugs(pending,base+920000).length,1);
console.log('Calibration tests passed',r);
