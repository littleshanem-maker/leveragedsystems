import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as settings from '../../tools/quote-builder/settings.mjs';
import * as instructions from '../../tools/quote-builder/instructions.mjs';
import * as history from '../../tools/quote-builder/runs.mjs';
import * as domain from '../../tools/quote-builder/domain.mjs';

const source = (await readFile(new URL('../../tools/quote-builder/settings-page.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const deferred = () => {let resolve;const promise = new Promise(done => {resolve = done;});return {promise,resolve};};
const settle = async () => {for (let index=0;index<20;index++) await Promise.resolve();};

class Element {
  constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.type='text';this.children=[];this.listeners=new Map();this.style={};this.classList={toggle(){}};this.ownText='';}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent??String(child)).join('\n');}
  append(...children){this.children.push(...children);if(!this.value&&children[0]?.value)this.value=children[0].value;}
  replaceChildren(...children){this.ownText='';this.children=[];this.append(...children);}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  click(){return this.listeners.get('click')?.();}
}
function page(post = async()=>({ok:true,status:200,json:async()=>({})})) {
  const elements=new Map(),data=new Map(),posts=[],windowListeners=new Map();
  let failRunWrites=false;
  const storage={getItem:key=>data.get(key)??null,setItem(key,value){if(failRunWrites&&key===history.RUNS_KEY)throw new Error('Storage full');data.set(key,value);}};
  const element = selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
  for(const [key,value]of Object.entries(settings.DEFAULT_SETTINGS)){const input=element('#'+key);input.type=typeof value==='boolean'?'checkbox':typeof value==='number'?'number':'text';}
  element('#timeoutSeconds').type='number';element('#profile-name').value='My edited profile';
  element('#settings-form').elements={namedItem:key=>element('#'+key)};
  const context=vm.createContext({
    ...settings,...instructions,...domain,console,structuredClone,crypto,Blob,URL,AbortSignal,setTimeout,clearTimeout,confirm:()=>true,
    loadProfiles:()=>settings.loadProfiles(storage),storeProfiles:profiles=>settings.storeProfiles(profiles,storage),activeSettings:()=>settings.activeSettings(storage),
    loadRuns:()=>history.loadRuns(storage),saveRun:run=>history.saveRun(run,storage),
    document:{querySelector:element,createElement:()=>new Element()},window:{addEventListener:(name,listener)=>windowListeners.set(name,listener)},
    fetch:async(url,options={})=>{if(options.method!=='POST')return {ok:true,json:async()=>({ai:{configured:true}})};const body=JSON.parse(options.body);posts.push(body);return post(body,posts.length);},
  });
  vm.runInContext(source,context,{filename:'settings-page.js'});
  return {element,storage,posts,windowListeners,failRunWrites(){failRunWrites=true;},api:vm.runInContext('({read,updateInstructionPreview,requestSample})',context)};
}
function runFor(body,status='success') {
  return {id:crypto.randomUUID(),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),elapsedMs:5,status,modelRequested:body.settings.scopeModel,modelReported:null,systemInstructions:instructions.buildSystemInstructions(body.settings),requestText:'Fixture request evidence',imageSummary:[],tools:structuredClone(instructions.TOOL_DEFINITIONS),settings:body.settings,trace:[{event:'fixture',detail:'Explicit test fixture'}],steps:[],usage:null,output:status==='success'?{scope:'Fixture scope',exclusions:'Fixture exclusions',items:[],questions:['Fixture question']}:null,error:status==='error'?{code:'AI_BILLING_REQUIRED',message:'Billing verification required.'}:null};
}
function response(body,status='success') {
  const run=runFor(body,status);
  return {ok:status==='success',status:status==='success'?200:503,json:async()=>status==='success'?{...run.output,run}:{error:run.error.message,run}};
}

test('edited brief uses the shared exact instruction builder without activating the profile',async()=>{
  const app=page();app.element('#workingBrief').value='Prepare an <exact> scope for beds.';
  app.element('#workingBrief').listeners.get('input')();
  assert.equal(app.element('#system-instructions').textContent,instructions.buildSystemInstructions(app.api.read()));
  assert.equal(app.element('#fixed-rules').textContent,instructions.CORE_RULES);
  assert.equal(app.element('#evidence-prefix').textContent,instructions.EVIDENCE_PREFIX);
  assert.deepEqual(JSON.parse(app.element('#tool-definitions').textContent),instructions.TOOL_DEFINITIONS);
  await app.element('#save-version').click();
  const saved=settings.loadProfiles(app.storage);
  assert.equal(saved.profiles[0].settings.workingBrief,'Prepare an <exact> scope for beds.');assert.equal(saved.activeId,null);
  assert.equal(settings.activeSettings(app.storage).workingBrief,settings.DEFAULT_SETTINGS.workingBrief);
});

test('local comparison makes no model request and leaves active settings and run history unchanged',async()=>{
  const app=page();app.element('#workingBrief').value='Edited working brief';
  await app.element('#compare-local').click();
  assert.equal(app.posts.length,0);assert.deepEqual(history.loadRuns(app.storage),[]);assert.equal(settings.loadProfiles(app.storage).activeId,null);
  assert.match(app.element('#test-result').textContent,/No AI requests were made/);
  assert.match(app.element('#test-result').textContent,/Edited working brief/);
  assert.match(app.element('#test-result').textContent,/Before · active settings/);
});

test('real comparison snapshots both settings and one shared capture before awaiting',async()=>{
  const first=deferred();const app=page(async(body,index)=>index===1?first.promise:response(body));
  app.element('#workingBrief').value='Captured edited brief';app.element('#test-image').checked=true;
  const comparing=app.element('#compare-ai').click();await settle();
  for(const id of ['check-settings','test-ai','compare-local','compare-ai'])assert.equal(app.element('#'+id).disabled,true);
  const capturedBefore=structuredClone(app.posts[0]);
  app.element('#workingBrief').value='Typed after request started';app.element('#test-image').checked=false;
  settings.storeProfiles({version:1,activeId:'other',profiles:[{id:'other',name:'Other tab',createdAt:new Date().toISOString(),settings:{...settings.DEFAULT_SETTINGS,workingBrief:'Changed active settings'}}]},app.storage);
  first.resolve(response(capturedBefore));await comparing;
  assert.equal(app.posts.length,2);assert.equal(app.posts[0].settings.workingBrief,settings.DEFAULT_SETTINGS.workingBrief);
  assert.equal(app.posts[1].settings.workingBrief,'Captured edited brief');
  assert.deepEqual(app.posts[0].visit,app.posts[1].visit);assert.deepEqual(app.posts[0].catalogue,app.posts[1].catalogue);
  assert.equal(history.loadRuns(app.storage).length,2);assert.equal(app.element('#compare-ai').disabled,false);
  assert.match(app.element('#test-result').textContent,/Model variation/);
});

test('provider failure is retained as an actual run and skips the edited comparison request',async()=>{
  const app=page(async body=>response(body,'error'));await app.element('#compare-ai').click();
  assert.equal(app.posts.length,1);const runs=history.loadRuns(app.storage);assert.equal(runs.length,1);assert.equal(runs[0].status,'error');
  assert.match(app.element('#test-result').textContent,/Billing verification required/);assert.match(app.element('#test-result').textContent,/edited request was not sent/);
  assert.doesNotMatch(app.element('#test-result').textContent,/AI request succeeded/);
});

test('run storage failure stays visible without hiding the received AI result',async()=>{
  const app=page(async body=>response(body));app.failRunWrites();await app.element('#test-ai').click();
  assert.equal(app.element('#run-storage-error').hidden,false);assert.match(app.element('#run-storage-error').textContent,/Storage full/);
  assert.match(app.element('#test-result').textContent,/Fixture scope/);assert.match(app.element('#test-result').textContent,/AI request succeeded/);
  assert.equal(app.element('#export-run').disabled,false);assert.deepEqual(history.loadRuns(app.storage),[]);
});

test('malformed HTTP 200 is never presented as a successful AI execution',async()=>{
  const app=page();await app.element('#test-ai').click();
  assert.match(app.element('#test-result').textContent,/incomplete response/);assert.doesNotMatch(app.element('#test-result').textContent,/AI request succeeded/);
  assert.equal(app.element('#test-ai').disabled,false);assert.deepEqual(history.loadRuns(app.storage),[]);
});
