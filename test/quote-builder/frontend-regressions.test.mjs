import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULT_SETTINGS,activeSettings as readActiveSettings} from '../../tools/quote-builder/settings.mjs';
import * as domain from '../../tools/quote-builder/domain.mjs';

const source = (await readFile(new URL('../../tools/quote-builder/app.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace(/\ninitialize\(\);\s*$/,'');
const deferred = () => {let resolve,reject;const promise = new Promise((yes,no) => {resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle = async () => {for(let index=0;index<15;index++) await Promise.resolve();};

function workspace(overrides = {}) {
  const elements = new Map(), timers = new Map(), listeners = new Map();
  let nextTimer = 0;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector,{disabled:false,hidden:false,textContent:'',innerHTML:'',dataset:{},style:{},classList:{toggle(){}},addEventListener(){},setAttribute(){},append(){},after(){},remove(){}});
    return elements.get(selector);
  };
  const context = vm.createContext({
    ...domain,DEFAULT_SETTINGS,activeSettings:()=>readActiveSettings({getItem:()=>null}),LOCAL_AUDIO_MAX_BYTES:50*1024*1024,console,structuredClone,crypto,TextEncoder,AbortController,Blob,
    URL:{createObjectURL:()=>'blob:local-photo',revokeObjectURL(){}},
    document:{querySelector:element,querySelectorAll:()=>[],getElementById:element,createElement:()=>element(`created-${elements.size}`),addEventListener(name,listener){listeners.set(name,listener);},body:{append(){}}},
    window:{addEventListener(){},scrollTo(){}},navigator:{onLine:true},confirm:()=>true,
    setTimeout(callback,delay){const key=++nextTimer;timers.set(key,{callback,delay});return key;},clearTimeout:key=>timers.delete(key),
    setInterval:()=>1,clearInterval(){},putVisit:async()=>{},putVisits:async()=>{},listVisits:async()=>[],deleteVisit:async()=>{},makeBackup:()=>({}),parseBackup:()=>[],
    fetch:async()=>{throw new Error('Unexpected request');},...overrides,
  });
  vm.runInContext(source,context,{filename:'app.js'});
  vm.runInContext('render = () => {}; renderSummary = () => {}; renderActivity = () => {};',context);
  const app = vm.runInContext('({state,markChanged,saveNow,changeVisit,newVisit,addPhotos,uploadAudio,startRecording,stopRecording,api,getConfiguration,prepareScope,initialize})',context);
  const first = domain.createVisit(), second = domain.createVisit();
  first.customer.name='First visit';second.customer.name='Second visit';
  app.state.visit=first;app.state.areaId=first.areas[0].id;app.state.visits=[structuredClone(first),structuredClone(second)];
  return {...app,context,elements,listeners,timers,element,first,second,fireDeadline(delay){const entry=[...timers.values()].find(timer=>timer.delay===delay);assert.ok(entry,`Expected ${delay} ms deadline`);entry.callback();}};
}

test('switching saves edits made during the first write and rejects overlapping transitions',async()=>{
  const writes=[];
  const app=workspace({putVisit:visit=>{const done=deferred();writes.push({visit,done});return done.promise;}});
  app.first.areas[0].notes='Before switching';app.markChanged();
  const switching=app.changeVisit(app.second.id);
  await settle();assert.equal(writes.length,1);
  app.first.areas[0].notes='Typed during saving';app.markChanged();
  const reentry=app.newVisit();
  await settle();assert.equal(writes.length,1,'a second transition must not start its own write');
  writes[0].done.resolve();await settle();
  assert.equal(app.state.visit.id,app.first.id,'outgoing visit stays active until its latest revision is saved');
  assert.equal(writes.length,2);assert.equal(writes[1].visit.areas[0].notes,'Typed during saving');
  writes[1].done.resolve();await switching;await reentry;
  assert.equal(app.state.visit.id,app.second.id);assert.equal(app.state.dirty,false);
  assert.equal(app.state.visits.find(visit=>visit.id===app.first.id).areas[0].notes,'Typed during saving');
});

test('a failed outgoing write keeps the visit and its edits active',async()=>{
  const done=deferred();const app=workspace({putVisit:()=>done.promise});
  app.first.areas[0].notes='Unsaved work';app.markChanged();
  const switching=app.changeVisit(app.second.id);await settle();done.reject(new Error('Disk full'));
  await assert.rejects(switching,/Disk full/);
  assert.equal(app.state.visit,app.first);assert.equal(app.state.dirty,true);
  assert.equal(app.state.busy.has('visit-transition'),false);
});

test('creating a visit keeps the outgoing visit active through creation and its latest save',async()=>{
  const writes=[];
  const app=workspace({putVisit:visit=>{const done=deferred();writes.push({visit,done});return done.promise;}});
  const creating=app.newVisit();await settle();assert.equal(writes.length,1);
  assert.equal(app.state.visit,app.first);
  app.first.areas[0].notes='Typed while the new visit was created';app.markChanged();
  writes[0].done.resolve();await settle();
  assert.equal(app.state.visit,app.first);assert.equal(writes.length,2);
  assert.equal(writes[1].visit.areas[0].notes,'Typed while the new visit was created');
  writes[1].done.resolve();await creating;
  assert.notEqual(app.state.visit.id,app.first.id);assert.equal(app.state.dirty,false);
  assert.equal(app.state.visits.find(visit=>visit.id===app.first.id).areas[0].notes,'Typed while the new visit was created');
});

test('photo batches cannot reenter or release the first batch lock early',async()=>{
  const resized=deferred();let resizeCalls=0,writes=0;
  const app=workspace({putVisit:async()=>{writes++;}});
  app.context.pendingResize=()=>{resizeCalls++;return resized.promise;};
  vm.runInContext('resizeDataUrl = pendingResize',app.context);
  const firstBatch=app.addPhotos([{name:'front.jpg',type:'image/jpeg'}]);await settle();
  assert.equal(app.element('#photo-input').disabled,true);
  await app.addPhotos([{name:'second.jpg',type:'image/jpeg'}]);
  assert.equal(resizeCalls,1);assert.equal(app.state.busy.has('photos'),true);
  assert.equal(app.element('#visit-select').disabled,true);
  resized.resolve('data:image/jpeg;base64,YWJj');await firstBatch;
  assert.equal(app.first.areas[0].photos.length,1);assert.equal(writes,1);
  assert.equal(app.state.busy.has('photos'),false);assert.equal(app.element('#photo-input').disabled,false);
});

test('rejecting concrete catalogue capacity leaves the entire visit untouched',async()=>{
  const app=workspace();
  app.first.catalogue=Array.from({length:60},(_,index)=>({id:`service-${index}`,name:`Service ${index}`,unit:'job',rateCents:100}));
  app.first.quote.scopeConfirmed=true;app.first.quote.ratesConfirmed=true;
  const before=structuredClone(app.first),revision=app.state.revision;
  const button={dataset:{action:'job-type',value:'concreting'},disabled:false};
  await app.listeners.get('click')({target:{closest:()=>button}});
  assert.deepEqual(app.state.visit,before);assert.equal(app.state.revision,revision);assert.equal(app.state.dirty,false);
  assert.match(app.element('#app-message').textContent,/unused catalogue service/i);
});

test('oversized audio uploads are rejected before reading or mutating the visit',async()=>{
  let reads=0,writes=0;
  const app=workspace({putVisit:async()=>{writes++;},FileReader:class {constructor(){reads++;}}});
  const before=structuredClone(app.first);
  await app.uploadAudio({name:'large.wav',type:'audio/wav',size:80*1024*1024});
  assert.equal(reads,0);assert.equal(writes,0);assert.deepEqual(app.state.visit,before);
  assert.equal(app.state.busy.has('audio-upload'),false);assert.match(app.element('#app-message').textContent,/50|local.*limit/i);
});

test('deadlines include response bodies and abort the underlying request',async()=>{
  for(const [action,delay,bodyMethod] of [['draft',100000,'json'],['transcribe',60000,'json'],['pdf',60000,'blob']]) {
    let signal;
    const app=workspace({fetch:async(_url,options)=>{signal=options.signal;return {ok:true,headers:{get:()=> 'application/pdf'},[bodyMethod]:()=>new Promise(()=>{})};}});
    const request=app.api(action,{});await settle();app.fireDeadline(delay);
    await assert.rejects(request,/timed out|connection/i);assert.equal(signal.aborted,true);
    assert.equal([...app.timers.values()].some(timer=>timer.delay===delay),false);
  }
});

test('a stalled draft releases controls and configuration timeout still reaches offline registration',async()=>{
  const app=workspace({fetch:()=>new Promise(()=>{})});
  const draft=app.prepareScope();await settle();app.fireDeadline(100000);await draft;
  assert.equal(app.state.busy.has('draft'),false);assert.equal(app.element('#visit-select').disabled,false);
  assert.match(app.element('#app-message').textContent,/timed out|connection/i);
  let registrations=0;
  const loading=workspace({listVisits:async()=>[domain.createVisit()],fetch:()=>new Promise(()=>{}),navigator:{onLine:true,serviceWorker:{register:async()=>{registrations++;return {active:{}};},ready:Promise.resolve()}}});
  const initialized=loading.initialize();await settle();loading.fireDeadline(8000);await initialized;
  assert.equal(registrations,1);assert.equal(loading.state.config,null);
});

function microphoneWorkspace(finalChunkBytes) {
  const recorders=[],readBlobs=[];
  const track={stops:0,stop(){this.stops++;}};
  const audioEvent = chunk => {const event=new Event('dataavailable');Object.defineProperty(event,'data',{value:chunk});return event;};
  class Recorder extends EventTarget {
    static isTypeSupported(){return true;}
    constructor(){super();this.mimeType='audio/webm';this.state='inactive';this.stops=0;recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.stops++;this.state='inactive';queueMicrotask(()=>{this.dispatchEvent(audioEvent({size:finalChunkBytes,type:'audio/webm',part:'final'}));this.dispatchEvent(new Event('stop'));});}
  }
  class AudioBlob {
    constructor(parts,{type}={}){this.parts=[...parts];this.size=parts.reduce((sum,part)=>sum+part.size,0);this.type=type;}
  }
  class Reader {
    readAsDataURL(blob){readBlobs.push(blob);this.result='data:audio/webm;base64,YWJj';this.onload();}
  }
  const app=workspace({MediaRecorder:Recorder,Blob:AudioBlob,FileReader:Reader,window:{MediaRecorder:Recorder,addEventListener(){},scrollTo(){}},navigator:{onLine:true,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track]})}}});
  return {...app,recorders,readBlobs,track,audioEvent};
}

test('microphone capture auto-stops at 45 MiB and retains the final audio chunk',async()=>{
  const app=microphoneWorkspace(1024*1024);await app.startRecording();
  const recorder=app.recorders[0],capture=app.state.recorder,first={size:45*1024*1024,type:'audio/webm',part:'first'};
  recorder.dispatchEvent(app.audioEvent(first));await capture.stopPromise;
  assert.equal(recorder.stops,1);assert.ok(app.track.stops>0);assert.equal(app.state.recorder,null);
  assert.equal(app.readBlobs[0].size,46*1024*1024);
  assert.equal(app.readBlobs[0].parts[0],first);assert.equal(app.readBlobs[0].parts[1].part,'final');
  assert.equal(app.first.areas[0].recordings.length,1);assert.equal(app.state.recoveryAudio.size,0);
});

test('unexpected oversized final microphone data remains downloadable without invalidating the visit',async()=>{
  const app=microphoneWorkspace(6*1024*1024);await app.startRecording();
  const capture=app.state.recorder,first={size:45*1024*1024,type:'audio/webm',part:'first'};
  app.recorders[0].dispatchEvent(app.audioEvent(first));await capture.stopPromise;
  assert.equal(app.readBlobs.length,0);assert.equal(app.first.areas[0].recordings.length,0);
  const [[id,recovered]]=app.state.recoveryAudio;
  assert.equal(recovered.blob.size,51*1024*1024);assert.equal(recovered.blob.parts[0],first);assert.equal(recovered.blob.parts[1].part,'final');
  const downloads=[];app.context.recordDownload=(blob,name)=>downloads.push({blob,name});vm.runInContext('download = recordDownload',app.context);
  const button={dataset:{action:'download-recovery-audio',id},disabled:false};
  await app.listeners.get('click')({target:{closest:()=>button}});
  assert.equal(downloads[0].blob,recovered.blob);assert.equal(app.state.recoveryAudio.size,1,'retain the original until the user explicitly dismisses it');
  await app.saveNow();assert.equal(app.state.dirty,false);
});

test('a draft snapshots the browser profile before its awaited save',async()=>{
 const done=deferred();let active={...DEFAULT_SETTINGS,maxSteps:2},sent;
 const app=workspace({activeSettings:()=>structuredClone(active),putVisit:()=>done.promise,fetch:async(_,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({scope:'Sample scope',exclusions:'',items:[],questions:[]})};}});
 const operation=app.prepareScope();await settle();active={...DEFAULT_SETTINGS,maxSteps:4};done.resolve();await operation;
 assert.equal(sent.settings.maxSteps,2);
});
