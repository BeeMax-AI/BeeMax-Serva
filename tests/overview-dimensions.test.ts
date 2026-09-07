import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Ticket } from '../shared/domain.ts';
import { ageBucket, durationMinutes, overviewDimensions, median, matchesDimension, dimensionHref, readDimension, type DimensionFilter } from '../shared/overview-dimensions.ts';
const at = Date.parse('2026-09-07T12:00:00+08:00'), from = at - 7*86400000;
const ticket = (patch: Partial<Ticket> = {}): Ticket => ({id:'t',subject:'问题',reference:'A',type:'报修',groupId:'g',assigneeId:null,status:'DISPATCHED',priority:'中',createdAt:new Date(at-3600000).toISOString(),acceptedAt:null,closedAt:null,version:1,events:[],...patch});
test('age buckets partition all open records at exact boundaries and isolate bad dates',()=>{
 const rows = [0,1,4,24,48].map(h=>ticket({createdAt:new Date(at-h*3600000).toISOString()}));
 assert.deepEqual(rows.map(t=>ageBucket(t,at)),['under1','from1','from4','over24','over24']);
 rows.push(ticket({createdAt:'invalid'}),ticket({createdAt:new Date(at+1).toISOString()}),ticket({status:'CLOSED'}));
 const result=overviewDimensions(rows,[],from,at);
 assert.deepEqual(result.ages.map(b=>b.count),[1,1,1,2,2]);
 for(const b of result.ages) assert.equal(rows.filter(t=>matchesDimension(t,{kind:'age',key:b.key,from,at})).length,b.count);
});
test('efficiency uses accepted and closed cohorts, medians and only valid durations',()=>{
 const rows = [
 ticket({createdAt:new Date(from-3600000).toISOString(),acceptedAt:new Date(from).toISOString()}),
 ticket({createdAt:new Date(from-7200000).toISOString(),acceptedAt:new Date(from-3600000).toISOString(),closedAt:new Date(from).toISOString(),status:'CLOSED'}),
 ticket({createdAt:'invalid',acceptedAt:new Date(at).toISOString(),closedAt:new Date(at).toISOString(),status:'CLOSED'}),
 ticket({acceptedAt:new Date(at+1).toISOString()}),
 ticket({acceptedAt:new Date(at-7200000).toISOString()}),
 ticket({acceptedAt:new Date(at-1800000).toISOString(),closedAt:new Date(at-1900000).toISOString(),status:'CLOSED'}),
 ];
 const g=overviewDimensions(rows,[{id:'g',name:'组'}],from,at).groups[0];
 assert.deepEqual(g.responses,[60,30]); assert.equal(g.response,45);
 assert.deepEqual(g.processing,[60]); assert.equal(g.process,60);
 assert.equal(durationMinutes(rows[2],'processing',at),null);
 assert.equal(median([]),null); assert.equal(median([9,1,2]),2);
});
test('hour/type aggregations share time range and UTC+8 with their drilldowns',()=>{
 const start=Date.parse('2026-09-07T00:00:00+08:00');
 const rows=[ticket({createdAt:new Date(start).toISOString(),type:'A&B / 类型'}),ticket({createdAt:new Date(start+60000).toISOString(),type:'A&B / 类型'}),ticket({createdAt:new Date(start-1).toISOString()}),ticket({createdAt:new Date(at+1).toISOString()}),ticket({createdAt:'bad'})];
 const data=overviewDimensions(rows,[],start,at);
 assert.equal(data.createdCount,2); assert.equal(data.hours[0].count,2);
 assert.deepEqual(data.types,[{name:'A&B / 类型',count:2}]);
 for(const hour of data.hours) assert.equal(rows.filter(t=>matchesDimension(t,{kind:'hour',key:String(hour.hour),from:start,at})).length,hour.count);
});
test('all group count and duration sample links match their displayed cohorts',()=>{
 const rows=[ticket(),ticket({status:'NO_ACCEPT',groupId:'unknown'}),ticket({status:'ON_HOLD'}),ticket({acceptedAt:new Date(at-1800000).toISOString()}),ticket({status:'CLOSED',acceptedAt:new Date(at-1800000).toISOString(),closedAt:new Date(at).toISOString()})];
 const data=overviewDimensions(rows,[{id:'g',name:'组'},{id:'empty',name:'空组'}],from,at);
 for(const g of data.groups) for(const kind of ['waiting','open','response','processing'] as const) {
 const expected=kind==='response'?g.responses.length:kind==='processing'?g.processing.length:g[kind];
 assert.equal(rows.filter(t=>matchesDimension(t,{kind,key:g.id,from,at})).length,expected);
 }
});
test('drilldown links roundtrip special names and reject malformed filters',()=>{
 const f: DimensionFilter={kind:'type',key:'A&B / 类型#',from,at};
 assert.deepEqual(readDimension(dimensionHref(f)),f);
 for(const hash of ['#tickets?dimension=type&key=x&from=0&at=8640000000000000','#tickets','#tickets?dimension=bad&key=x&from=1&at=2','#tickets?dimension=hour&key=24&from=1&at=2','#tickets?dimension=age&key=missing&from=1&at=2','#tickets?dimension=type&key=x&from=3&at=2','#tickets?dimension=type&key=x&from=NaN&at=2']) assert.equal(readDimension(hash),null);
});
test('no data produces no fabricated durations or problem rankings',()=>{
 const data=overviewDimensions([],[{id:'g',name:'组'}],from,at);
 assert.equal(data.createdCount,0); assert.deepEqual(data.types,[]);
 assert.equal(data.groups[0].response,null); assert.equal(data.groups[0].process,null);
 assert.ok(data.hours.every(h=>h.count===0));
});
