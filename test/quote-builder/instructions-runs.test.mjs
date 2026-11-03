import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,validateSettings} from '../../tools/quote-builder/settings.mjs';
import {CORE_RULES,EVIDENCE_PREFIX,TOOL_DEFINITIONS,buildSystemInstructions} from '../../tools/quote-builder/instructions.mjs';
import {runQuoteHarness,HarnessError} from '../../lib/quote-builder/harness.mjs';
import {createVisit,DEFAULT_CATALOGUE} from '../../tools/quote-builder/domain.mjs';
import {loadRuns,saveRun} from '../../tools/quote-builder/runs.mjs';
function modelFixture(visit,capture){let index=0;return async payload=>{capture.push(structuredClone(payload));index++;return {reportedModel:'provider-reported-test-model',usage:{input_tokens:10,output_tokens:20},content:index===1?[{type:'tool_use',id:'catalogue',name:'get_services',input:{}}]:[{type:'tool_use',id:'proposal',name:'prepare_scope',input:{scope:'Supply turf to measured area.',exclusions:'Irrigation.',items:[{serviceId:'turf',areaId:visit.areas[0].id,quantity:30,description:'Turf supply and installation'}],questions:[]}}]};};}
test('the visible instruction builder is exactly the model system prompt, with editable brief and fixed rules',async()=>{
 const visit=createVisit(),capture=[],settings=validateSettings({...DEFAULT_SETTINGS,workingBrief:'Ask about drainage before proposing concreting.'});
 const result=await runQuoteHarness(visit,DEFAULT_CATALOGUE,{settings,callModel:modelFixture(visit,capture)});
 assert.equal(capture[0].system,buildSystemInstructions(settings));assert.equal(result.run.systemInstructions,capture[0].system);assert.match(capture[0].system,/Ask about drainage/);assert.ok(capture[0].system.startsWith(CORE_RULES));assert.ok(capture[0].messages[0].content[0].text.startsWith(EVIDENCE_PREFIX));assert.deepEqual(capture[0].tools,TOOL_DEFINITIONS);
 assert.equal(result.run.status,'success');assert.equal(result.run.steps.length,2);assert.equal(result.run.steps[0].toolCalls[0].name,'get_services');assert.equal(result.run.steps[1].toolResults[0].isError,false);assert.equal(result.run.modelReported,'provider-reported-test-model');assert.equal(result.run.output.scope,result.scope);
});
test('a failed real model attempt carries truthful instructions and errors, without image bytes or customer identifiers',async()=>{
 const visit=createVisit();visit.customer.name='CONTACT MUST STAY OUT';visit.areas[0].photos=[{name:'Site image',dataUrl:'data:image/png;base64,YWJj'}];
 let run;try{await runQuoteHarness(visit,DEFAULT_CATALOGUE,{callModel:async()=>{throw new HarnessError('Connection is not configured.','AI_NOT_CONFIGURED',503);}});}catch(error){run=error.run;assert.equal(error.status,503);}
 assert.ok(run);assert.equal(run.status,'error');assert.equal(run.modelReported,null);assert.equal(run.output,null);assert.equal(run.usage,null);assert.equal(run.usageComplete,false);assert.equal(run.error.code,'AI_NOT_CONFIGURED');assert.equal(run.imageSummary.length,1);assert.doesNotMatch(JSON.stringify(run),/YWJj|CONTACT MUST STAY OUT/);assert.ok(run.elapsedMs>=0);
});
test('browser run history keeps actual records bounded, deduplicates IDs and exposes storage failures',async()=>{
 const visit=createVisit(),capture=[];const {run}=await runQuoteHarness(visit,DEFAULT_CATALOGUE,{callModel:modelFixture(visit,capture)});let raw;const storage={getItem:()=>raw??null,setItem:(_,value)=>{raw=value;}};
 saveRun(run,storage);saveRun(run,storage);assert.equal(loadRuns(storage).length,1);
 for(let i=0;i<25;i++)saveRun({...run,id:`run-${i}`},storage);assert.equal(loadRuns(storage).length,20);assert.equal(loadRuns(storage)[0].id,'run-24');
 assert.throws(()=>saveRun(run,{getItem:()=>null,setItem:()=>{throw new Error('Storage full');}}),/Storage full/);
});
test('older profiles receive a default working brief without losing existing preferences',()=>{const {workingBrief,...legacy}=DEFAULT_SETTINGS;const restored=validateSettings({...legacy,instructions:'Old saved preference'});assert.equal(restored.workingBrief,workingBrief);assert.equal(restored.instructions,'Old saved preference');assert.throws(()=>validateSettings({workingBrief:''}),/Working brief/);});
test('a later model timeout keeps earlier reported usage explicitly incomplete',async()=>{
 let step=0,run;try{await runQuoteHarness(createVisit(),DEFAULT_CATALOGUE,{callModel:async()=>{if(++step===1)return {usage:{input_tokens:10,output_tokens:20},content:[{type:'tool_use',id:'catalogue',name:'get_services',input:{}}]};throw new HarnessError('Request timed out.','AI_TIMEOUT',504);}});}catch(error){run=error.run;}
 assert.equal(run.steps.length,2);assert.deepEqual(run.usage,{input_tokens:10,output_tokens:20});assert.equal(run.usageComplete,false);assert.equal(run.status,'error');
});
