const test = require('node:test');
const assert = require('node:assert/strict');
const {dateKey, filterEvents, weekCounts, diskSeries, formatDelta, nearestSample, filterInventory, searchSegments} = require('../public/model.js');
const now = new Date(2026,9,11,12);
const e = (day,type='usb',title='USB mouse') => ({time:new Date(2026,9,day,10).toISOString(),type,title,detail:'example'});
test('filters use local calendar boundaries and exclude future dates',()=>{
  const items=[e(11),e(10),e(4),e(12)];
  assert.equal(filterEvents(items,{range:'today'},now).length,1);
  assert.equal(filterEvents(items,{range:'week'},now).length,2);
});
test('combines category, query and chosen date',()=>{
  assert.equal(filterEvents([e(11),e(11,'software','Editor'),e(10)],{type:'usb',query:'MOUSE',day:dateKey(now)},now).length,1);
});
test('weekly changes exclude baseline events',()=>{
  const counts=weekCounts([e(11),e(11,'system')],now);
  assert.equal(counts.length,7);assert.equal(counts.at(-1).count,1);assert.equal(counts[0].count,0);
});
test('disk series only uses actual points and sorts timestamps',()=>{
  const samples=[{time:e(11).time,drives:[{id:'C:',free:5}]},{time:e(10).time,drives:[{id:'C:',free:6}]},{time:e(9).time,drives:[{id:'D:',free:7}]}];
  const result=diskSeries(samples,'C:');assert.equal(result.length,2);assert.equal(result[0].free,6);assert.equal(diskSeries(samples,'X:').length,0);
});
test('explicit day takes precedence over a previously selected relative range',()=>{
  const items=[e(11),e(10)];assert.equal(filterEvents(items,{range:'today',day:dateKey(e(10).time)},now).length,1);
  assert.equal(filterEvents(items,{range:'today',day:dateKey(e(10).time)},now)[0].time,e(10).time);
});
test('weekly coverage distinguishes not-started dates from recorded zero changes',()=>{
  const counts=weekCounts([],now,e(10).time);assert.equal(counts[0].tracked,false);assert.equal(counts.at(-1).tracked,true);assert.equal(counts.at(-1).count,0);
});

test('disk deltas preserve small changes, signs and true zero',()=>{
  assert.equal(formatDelta(0),'无净变化');assert.equal(formatDelta(32*1024**2),'+32.0 MiB');
  assert.equal(formatDelta(-1536),'-1.5 KiB');assert.equal(formatDelta(2*1024**3),'+2.0 GB');
  assert.equal(formatDelta(1),'+1 B');assert.equal(formatDelta(NaN),'—');
});

test('sample selection uses actual timestamps rather than point positions',()=>{
  const points=[0,1,10].map(minute=>({time:new Date(2026,9,11,12,minute).toISOString(),free:1}));
  assert.equal(nearestSample(points,.2),1);assert.equal(nearestSample(points,.6),2);
  assert.equal(nearestSample(points,-1),0);assert.equal(nearestSample(points,2),2);
  assert.equal(nearestSample([],0),-1);assert.equal(nearestSample([points[0]],1),0);
});

test('inventory search combines name, version and status without mutating its source',()=>{
  const items=[{name:'Demo Editor',version:'1.2',status:'OK'},{name:'USB Audio',version:'Sound',status:'Error'}];
  assert.equal(filterInventory(items,'EDITOR 1.2')[0],items[0]);assert.equal(filterInventory(items,'audio error')[0],items[1]);
  assert.equal(filterInventory(items,'audio OK').length,0);assert.equal(filterInventory(items,'   ').length,2);
  assert.equal(items[0].name,'Demo Editor');
});

test('event searches combine terms across title and detail in any order',()=>{
  const event={...e(11), detail:'Mouse driver 2.0'};
  assert.equal(filterEvents([event],{query:'2.0 USB'},now).length,1);
  assert.equal(filterEvents([event],{query:'2.0 printer'},now).length,0);
});

test('search highlighting preserves text and treats regex and markup as literal text',()=>{
  const text='USB [Mouse] v1.0 <img src=x> USB';
  const parts=searchSegments(text,'[Mouse] v1.0 <img');
  assert.equal(parts.map(part=>part.text).join(''),text);
  assert.deepEqual(parts.filter(part=>part.match).map(part=>part.text),['[Mouse]','v1.0','<img']);
  assert.deepEqual(searchSegments('AB ab','ab').filter(part=>part.match).map(part=>part.text),['AB','ab']);
  assert.deepEqual(searchSegments('plain text','  '),[{text:'plain text',match:false}]);
});
