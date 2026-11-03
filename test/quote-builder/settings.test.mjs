import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,validateSettings,selectScopeModel,emptyProfiles,storeProfiles,loadProfiles,activeSettings} from '../../tools/quote-builder/settings.mjs';
import {runQuoteHarness} from '../../lib/quote-builder/harness.mjs';
import {createVisit,DEFAULT_CATALOGUE} from '../../tools/quote-builder/domain.mjs';
test('settings reject unknown models, arbitrary keys and execution limits above server caps',()=>{
 for(const patch of [{scopeModel:'unknown'},{maxSteps:5},{maxOutputTokens:2201},{timeoutMs:22001},{includeImages:'yes'},{apiKey:'secret'}])assert.throws(()=>validateSettings(patch));
 assert.equal(validateSettings({maxSteps:2}).maxSteps,2);
});
test('profiles round trip and activate only a saved version without changing older versions',()=>{
 let raw;const storage={getItem:()=>raw??null,setItem:(_,value)=>{raw=value;}};
 const profiles=emptyProfiles();profiles.profiles.push({id:'one',name:'Original',createdAt:new Date().toISOString(),settings:{...DEFAULT_SETTINGS}});profiles.activeId='one';storeProfiles(profiles,storage);
 const edit=loadProfiles(storage);edit.profiles.push({id:'two',name:'Short scopes',createdAt:new Date().toISOString(),settings:{...DEFAULT_SETTINGS,maxSteps:2}});edit.activeId='two';storeProfiles(edit,storage);
 assert.equal(activeSettings(storage).maxSteps,2);assert.equal(loadProfiles(storage).profiles[0].settings.maxSteps,4);
 edit.activeId='one';storeProfiles(edit,storage);assert.equal(activeSettings(storage).maxSteps,4);
 assert.throws(()=>storeProfiles({...edit,activeId:'missing'},storage));assert.equal(activeSettings(storage).maxSteps,4);
});
test('image routing respects the image context toggle',()=>{
 const settings={...DEFAULT_SETTINGS,imageModel:'anthropic/claude-sonnet-4.6'};
 assert.equal(selectScopeModel(settings,true),settings.imageModel);assert.equal(selectScopeModel({...settings,includeImages:false},true),settings.scopeModel);
});
test('harness applies instructions and response/step limits and omits excluded context',async()=>{
 const visit=createVisit();visit.areas[0].recordings=[{transcript:'PRIVATE TRANSCRIPT'}];visit.areas[0].photos=[{name:'picture',dataUrl:'data:image/png;base64,YWJj'}];let calls=0;
 await assert.rejects(()=>runQuoteHarness(visit,DEFAULT_CATALOGUE,{settings:{...DEFAULT_SETTINGS,maxSteps:1,maxOutputTokens:300,instructions:'Use short sentences.',includeImages:false,includeTranscripts:false},callModel:async payload=>{calls++;assert.equal(payload.max_tokens,300);assert.match(payload.system,/Use short sentences/);assert.doesNotMatch(JSON.stringify(payload.messages),/PRIVATE TRANSCRIPT|base64/);return {content:[{type:'text',text:'No tools'}]};}}),/step limit/);
 assert.equal(calls,1);
});
test('disabled drafting stops before invoking the model',async()=>{let called=false;await assert.rejects(()=>runQuoteHarness(createVisit(),DEFAULT_CATALOGUE,{settings:{...DEFAULT_SETTINGS,draftingEnabled:false},callModel:async()=>{called=true;}}),/disabled/i);assert.equal(called,false);});
test('provider receives the selected model and bounded timeout, without internal fields in its body',async()=>{
 const {callGatewayModel}=await import('../../lib/quote-builder/harness.mjs');const original=globalThis.fetch;let request;
 globalThis.fetch=async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({content:[]})};};
 try{const response=await callGatewayModel({model:'anthropic/claude-sonnet-4.6',requestTimeoutMs:5000,messages:[]},{ANTHROPIC_API_KEY:'test-only'});assert.equal(response.model,'claude-sonnet-4-6');assert.equal(JSON.parse(request.body).model,'claude-sonnet-4-6');assert.ok(!('requestTimeoutMs' in JSON.parse(request.body)));assert.ok(request.signal);}finally{globalThis.fetch=original;}
});
test('provider keeps the server configured model when no profile model is supplied',async()=>{
 const {callGatewayModel}=await import('../../lib/quote-builder/harness.mjs');const original=globalThis.fetch;let model;
 globalThis.fetch=async(_,options)=>{model=JSON.parse(options.body).model;return {ok:true,json:async()=>({content:[]})};};
 try{await callGatewayModel({messages:[]},{AI_GATEWAY_API_KEY:'test-only',QUOTE_AI_MODEL:'anthropic/claude-sonnet-4.6'});assert.equal(model,'anthropic/claude-sonnet-4.6');}finally{globalThis.fetch=original;}
});
