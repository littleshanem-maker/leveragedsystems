import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisit } from '../../tools/quote-builder/domain.mjs';
import { makeBackup, parseBackup, transactionComplete } from '../../tools/quote-builder/storage.mjs';

test('a backup round trip preserves editable drafts and original local media', () => {
  const visit = createVisit();
  visit.customer.name = 'A customer';
  visit.areas[0].notes = 'Keep the existing citrus tree.';
  visit.areas[0].photos.push({id:'photo-1',name:'garden.jpg',type:'image/jpeg',dataUrl:'data:image/jpeg;base64,YWJj'});
  visit.areas[0].recordings.push({id:'audio-1',name:'visit.webm',type:'audio/webm',dataUrl:'data:audio/webm;base64,YWJj',transcript:'Two garden beds.'});
  visit.quote.items.push({id:'line-1',serviceId:'turf',quantity:'',description:'Draft quantity',confirmed:false});
  visit.areas[0].sketchDraft = {dataUrl:'data:image/png;base64,YWJj'};
  const backup = makeBackup([visit]);
  const restored = parseBackup(JSON.stringify(backup));
  assert.deepEqual(restored, [visit]);
  assert.notEqual(restored[0], visit);
});

test('corrupt or incompatible backups are rejected before any data is written', () => {
  const visit = createVisit();
  assert.throws(() => parseBackup('{broken'), /valid JSON/i);
  assert.throws(() => parseBackup(JSON.stringify({format:'other',version:1,visits:[visit]})), /quote builder backup/i);
  assert.throws(() => parseBackup(JSON.stringify({...makeBackup([visit]),version:2})), /version/i);
  const duplicate = structuredClone(visit);
  assert.throws(() => parseBackup(JSON.stringify(makeBackup([visit,duplicate]))), /duplicate/i);
  const badMedia = structuredClone(visit);
  badMedia.areas[0].photos.push({id:'p',name:'bad.svg',type:'image/svg+xml',dataUrl:'data:text/html;base64,YWJj'});
  assert.throws(() => parseBackup(JSON.stringify({...makeBackup([visit]),visits:[badMedia]})), /photo/i);
  const badCatalogue = structuredClone(visit);
  badCatalogue.quote.items = [{id:'x',serviceId:'missing',quantity:'1',confirmed:false,description:''}];
  assert.throws(() => parseBackup(JSON.stringify({...makeBackup([visit]),visits:[badCatalogue]})), /service/i);
  const malformedActivity = structuredClone(visit);
  malformedActivity.activity = [null];
  assert.throws(() => parseBackup(JSON.stringify(makeBackup([malformedActivity]))), /activity/i);
  const malformedProposal = structuredClone(visit);
  malformedProposal.scopeSuggestion = {scope:'Proposed work',exclusions:'',items:{},questions:[],model:'test-model'};
  assert.throws(() => parseBackup(JSON.stringify(makeBackup([malformedProposal]))), /proposed items/i);
  const missingRecording = structuredClone(visit);
  missingRecording.pendingActions = [{action:'transcribe',areaId:visit.areas[0].id,recordingId:'missing'}];
  assert.throws(() => parseBackup(JSON.stringify(makeBackup([missingRecording]))), /missing recording/i);
  const malformedQueue = structuredClone(visit);
  malformedQueue.pendingActions = [{action:'email'}];
  assert.throws(() => parseBackup(JSON.stringify(makeBackup([malformedQueue]))), /pending request/i);
});

test('a save only settles after transaction completion and rejects an aborted write', async () => {
  const tx = new EventTarget();
  let saved = false;
  const completion = transactionComplete(tx).then(() => { saved = true; });
  tx.dispatchEvent(new Event('success'));
  await Promise.resolve();
  assert.equal(saved,false);
  tx.dispatchEvent(new Event('complete'));
  await completion;
  assert.equal(saved,true);
  const aborting = new EventTarget();
  const failure = transactionComplete(aborting);
  aborting.dispatchEvent(new Event('abort'));
  await assert.rejects(failure,/save|transaction|storage/i);
});
