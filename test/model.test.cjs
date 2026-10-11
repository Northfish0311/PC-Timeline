const test = require('node:test');
const assert = require('node:assert/strict');
const {dateKey, filterEvents, weekCounts, diskSeries} = require('../public/model.js');
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
