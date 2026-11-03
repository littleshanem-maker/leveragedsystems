import test from 'node:test';
import assert from 'node:assert/strict';
import {runQuoteHarness} from '../../lib/quote-builder/harness.mjs';
import {createVisit,DEFAULT_CATALOGUE} from '../../tools/quote-builder/domain.mjs';
for(const kind of ['service','area','tool'])test(`rejects an unknown ${kind} after catalogue access`,async()=>{
 const visit=createVisit();let step=0;const errors=[];
 await assert.rejects(()=>runQuoteHarness(visit,DEFAULT_CATALOGUE,{callModel:async payload=>{
  for(const message of payload.messages)for(const block of Array.isArray(message.content)?message.content:[])if(block.type==='tool_result'&&block.is_error)errors.push(block.content);
  step++;return {content:step===1?[{type:'tool_use',id:'catalogue',name:'get_services',input:{}}]:[{type:'tool_use',id:`bad-${step}`,name:kind==='tool'?'run_shell':'prepare_scope',input:{scope:'Work',exclusions:'',items:[{serviceId:kind==='service'?'unknown':'turf',areaId:kind==='area'?'unknown':visit.areas[0].id,quantity:2,description:'Work'}],questions:[]}}]};
 }}),/step limit/);
 assert.ok(errors.some(error=>new RegExp(kind==='service'?'valid service':kind==='area'?'valid work area':'not permitted').test(error)));
});
