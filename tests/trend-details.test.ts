import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Ticket } from '../shared/domain.ts';
import { trendDetails,comparison } from '../shared/trend-details.ts';
import { matchesDimension,dimensionHref,readDimension } from '../shared/overview-dimensions.ts';
const today='2026-09-07', now=Date.parse(today+'T12:00:00+08:00');
const t=(patch:Partial<Ticket>={}):Ticket=>({id:'a',subject:'问题',type:'报修',groupId:'g',reference:'A',assigneeId:null,status:'DISPATCHED',priority:'中',createdAt:today+'T08:00:00+08:00',acceptedAt:null,closedAt:null,events:[],version:1,...patch});
test('previous window has equal calendar length and matches elapsed time of unfinished day',()=>{
 for(const [period,n] of [['day',1],['week',7],['month',30]] as const){
 const d=trendDetails([],[],today,period,now);
 assert.equal(d.days.length,n); assert.equal(d.from-d.previousFrom,n*86400000);
 assert.equal(d.at-d.from,d.previousAt-d.previousFrom); assert.equal(d.at,now);
 }
});
test('comparison excludes later hours from prior final day and uses all created records for shares',()=>{
 const rows=[t(),t({type:'清洁'}),t({createdAt:'2026-08-31T12:00:00+08:00'}),t({createdAt:'2026-08-31T12:00:01+08:00'})];
 const d=trendDetails(rows,[],today,'week',now);
 assert.equal(d.total,2);assert.equal(d.previousTotal,1);
 assert.deepEqual(d.types.find(r=>r.id==='报修'),{id:'报修',name:'报修',current:1,previous:1});
 assert.equal(comparison(4,2),'+2 单（+100%）');assert.equal(comparison(0,2),'-2 单（-100%）');assert.equal(comparison(4,0),'— · 上期未记录');
});
test('daily medians preserve zero values and null gaps, assigned by accepted/closed dates',()=>{
 const rows=[t({createdAt:'2026-08-31T23:00:00+08:00',acceptedAt:'2026-09-01T00:00:00+08:00',closedAt:'2026-09-02T00:00:00+08:00',status:'CLOSED'}),t({acceptedAt:today+'T08:00:00+08:00'}),t({acceptedAt:'2026-09-07T13:00:00+08:00'}),t({createdAt:'bad',acceptedAt:today+'T09:00:00+08:00'})];
 const d=trendDetails(rows,[],today,'week',now);
 assert.equal(d.days[0].response,60);assert.equal(d.days[0].created,0);assert.equal(d.days[1].process,1440);assert.equal(d.days[2].response,null);assert.equal(d.days[6].response,0);
});
test('daily counts and medians drilldowns use exactly the displayed cohorts',()=>{
 const rows=[t(),t({groupId:'other',type:'A&B'}),t({createdAt:'2026-08-30T10:00:00+08:00',closedAt:today+'T10:00:00+08:00',status:'CLOSED'}),t({acceptedAt:today+'T10:00:00+08:00',closedAt:today+'T11:00:00+08:00',status:'CLOSED'}),t({createdAt:'bad',closedAt:today+'T10:00:00+08:00',status:'CLOSED'})];
 const d=trendDetails(rows,[{id:'g',name:'组'}],today,'week',now);
 for(const day of d.days){
 for(const [kind,count] of [['created',day.created],['closed',day.closed],['response_all',day.responses.length],['processing_all',day.processing.length]] as const){
 const f={kind,key:'',from:day.from,at:day.at};assert.equal(rows.filter(row=>matchesDimension(row,f)).length,count);assert.deepEqual(readDimension(dimensionHref(f)),f);
 }
 for(const g of d.groups) assert.equal(rows.filter(row=>matchesDimension(row,{kind:'group_created',key:g.id,from:day.from,at:day.at})).length,day.groups.get(g.id)||0);
 assert.equal(day.net,day.created-day.closed);
 }
});
test('empty source does not fabricate efficiency samples or comparison rates',()=>{
 const d=trendDetails([],[{id:'g',name:'组'}],today,'month',now);
 assert.equal(d.days.length,30);assert.ok(d.days.every(day=>day.response===null && day.process===null && day.net===0));assert.deepEqual(d.types,[]);assert.equal(d.groups[0].current,0);
});
