const assert=require('node:assert/strict');
const T=require('./tracker.js');
function signal(side='DOWN'){return {type:'TRADE',side,score:74,entry:.70,tp:.84,sl:.61,probUp:.23,edge:.067}}
let t=T.freshState();const market='cpc-btc-updown-15m-test';const at=1_700_000_000_000;
let a=T.confirmSignal(t,signal(),market,at,1700000000);
assert.equal(a.type,'CONFIRMING');
a=T.confirmSignal(t,signal(),market,at+1800,1700000001);
assert.equal(a.type,'CONFIRMING','Too-early refresh must not pass confirmation');
a=T.confirmSignal(t,signal(),market,at+5000,1700000000);
assert.equal(a.type,'CONFIRMING','Same index second cannot be a second confirmation');
a=T.confirmSignal(t,signal(),market,at+5100,1700000005);
assert.equal(a.type,'TRADE');assert(a.reasons[0].includes('Confirmed'));
const p=T.paperFromSignal(a,market,at+5100,(at+900000)/1000,.69);
assert(p);t.active=p;
assert.equal(T.seenMarket(t,market),true);
T.advancePaper(t.active,at+7000,market,.75);
assert.equal(t.active.status,'ACTIVE');assert.equal(t.active.entry,.70);
T.advancePaper(t.active,at+11000,market,.86);
assert.equal(t.active.status,'TARGET_TOUCH');
assert.equal(t.active.exitBid,.86);assert.equal(t.active.paperMoveCents,16);
assert.equal(T.archive(t),true);assert.equal(t.active,null);
assert.equal(t.history[0].entry,.70);
assert.equal(T.seenMarket(t,market),true);
assert.equal(T.stats(t.history).target,1);
assert.equal(T.stats(t.history).buckets['70–79'].target,1);
const restored=T.restore(JSON.parse(JSON.stringify({active:null,history:t.history})));
assert.equal(restored.history.length,1);assert.equal(restored.confirmedKey,null);
const csv=T.asCSV(restored.history);assert(csv.includes('TARGET_TOUCH'));
let wait=T.confirmSignal(t,{type:'WAIT',reasons:['no edge']},market,at+12000,1700000006);
assert.equal(wait.type,'WAIT');assert.equal(t.confirmedKey,null);
// A large gap should not produce a confirmation on its own.
t=T.freshState();T.confirmSignal(t,signal('UP'),market,at,1700000000);
a=T.confirmSignal(t,signal('UP'),market,at+22000,1700000022);
assert.equal(a.type,'CONFIRMING');
// Stops are triggered at *observed bid*, not the price to beat or implied market midpoint.
const p2=T.paperFromSignal(signal('UP'),market,at,(at+900000)/1000,.68);
T.advancePaper(p2,at+5000,market,.60);
assert.equal(p2.status,'STOP_TOUCH');assert.equal(p2.paperMoveCents,-10);
// If a window ends while app was suspended, do NOT claim a target or stop.
const p3=T.paperFromSignal(signal('UP'),market,at,(at+900000)/1000,.68);
T.advancePaper(p3,at+901000,market,null);
assert.equal(p3.status,'WINDOW_ENDED_UNRESOLVED');assert.equal(p3.exitBid,null);
// Missing quotes cannot manufacture an outcome.
const p4=T.paperFromSignal(signal('UP'),market,at,(at+900000)/1000,.68);
T.advancePaper(p4,at+5000,market,NaN);
assert.equal(p4.status,'ACTIVE');
console.log('Tracker tests passed: 2-cycle confirmation, locked paper, target, stop, expiry, stats, CSV and persistence.');
