export const LOCAL_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
import { validateCatalogue } from './domain.mjs';

const DATABASE = 'leveraged-systems-landscaping';
const STORE = 'visits';
let databasePromise;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
}
function string(value, label, max = 20000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}.`);
}
function id(value, label) {
  string(value, label, 100);
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}.`);
}
function array(value, label, max = 1000) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${label}.`);
}
function media(value, kind) {
  object(value, kind);
  id(value.id, `${kind} ID`);
  string(value.name, `${kind} name`, 500);
  string(value.type, `${kind} type`, 100);
  string(value.dataUrl, `${kind} data`, 100 * 1024 * 1024);
  const allowed = kind === 'photo' ? /^image\/(?:jpeg|png|webp)$/ : /^(?:audio\/[a-zA-Z0-9.+-]+|video\/webm)(?:;codecs=[a-zA-Z0-9.,-]+)?$/;
  if (!allowed.test(value.type) || !value.dataUrl.startsWith(`data:${value.type};base64,`) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataUrl.slice(value.dataUrl.indexOf(',') + 1))) throw new Error(`Invalid ${kind} data.`);
  if (kind === 'recording') {
    string(value.transcript, 'recording transcript', 100000);
    if (value.sourceTranscript !== undefined) string(value.sourceTranscript, 'original transcript', 100000);
    if (value.previousTranscripts !== undefined) {
      array(value.previousTranscripts, 'previous transcripts', 100);
      value.previousTranscripts.forEach(transcript => string(transcript, 'previous transcript', 100000));
    }
  }
}

function sketch(value) {
  object(value, 'sketch');
  string(value.dataUrl, 'sketch data', 10 * 1024 * 1024);
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(value.dataUrl)) throw new Error('Invalid sketch data.');
}

export function validateVisit(value) {
  object(value, 'visit');
  if (value.version !== 1) throw new Error('Unsupported visit version.');
  id(value.id, 'visit ID');
  for (const key of ['createdAt', 'updatedAt']) {
    string(value[key], key, 40);
    if (!Number.isFinite(Date.parse(value[key]))) throw new Error(`Invalid ${key}.`);
  }
  for (const key of ['customer', 'business']) {
    object(value[key], key);
    for (const field of ['name', 'email', 'phone']) string(value[key][field], `${key} ${field}`, 500);
  }
  string(value.customer.address, 'property address', 1000);
  string(value.business.abn, 'ABN', 100);
  array(value.areas, 'areas', 100);
  if (!value.areas.length) throw new Error('A visit needs at least one area.');
  const areaIds = new Set();
  for (const area of value.areas) {
    object(area, 'area');
    id(area.id, 'area ID');
    if (areaIds.has(area.id)) throw new Error('Duplicate area IDs.');
    areaIds.add(area.id);
    if (!['turf', 'mulch', 'planting', 'cleanup', 'concreting'].includes(area.jobType)) throw new Error('Invalid area job type.');
    for (const field of ['name', 'notes', 'access', 'materials', 'disposal']) string(area[field], `area ${field}`);
    for (const field of ['length', 'width', 'depthMm']) if (!['string','number'].includes(typeof area[field])) throw new Error('Invalid measurement.');
    if (typeof area.quantityConfirmed !== 'boolean') throw new Error('Invalid measurement confirmation.');
    array(area.photos, 'photos', 100);
    array(area.recordings, 'recordings', 100);
    area.photos.forEach(photo => media(photo, 'photo'));
    area.recordings.forEach(recording => media(recording, 'recording'));
    if (area.sketch !== null) sketch(area.sketch);
    if (area.sketchDraft !== undefined) sketch(area.sketchDraft);
  }
  const catalogue = validateCatalogue(value.catalogue);
  const services = new Set(catalogue.map(service => service.id));
  object(value.quote, 'quote');
  for (const field of ['reference','issueDate','scope','exclusions']) string(value.quote[field], `quote ${field}`);
  array(value.quote.items, 'quote items', 60);
  const lineIds = new Set();
  for (const line of value.quote.items) {
    object(line, 'quote line');
    id(line.id, 'quote line ID');
    if (lineIds.has(line.id)) throw new Error('Duplicate quote line IDs.');
    lineIds.add(line.id);
    if (!services.has(line.serviceId)) throw new Error('A quote line refers to an unknown service.');
    if (!['string','number'].includes(typeof line.quantity)) throw new Error('Invalid quote quantity.');
    string(line.description, 'line description', 1000);
    if (typeof line.confirmed !== 'boolean') throw new Error('Invalid line confirmation.');
    if (line.areaId && !areaIds.has(line.areaId)) throw new Error('A quote line refers to an unknown area.');
  }
  if (![0,1000].includes(value.quote.taxRateBps)) throw new Error('Invalid GST setting.');
  if (typeof value.quote.scopeConfirmed !== 'boolean' || typeof value.quote.ratesConfirmed !== 'boolean') throw new Error('Invalid quote approvals.');
  if (!['string','number'].includes(typeof value.quote.validDays)) throw new Error('Invalid quote validity.');
  if (value.quote.questions !== undefined) {
    array(value.quote.questions, 'scope questions', 100);
    value.quote.questions.forEach(question => string(question, 'scope question', 12000));
  }
  array(value.activity, 'activity', 1000);
  for (const entry of value.activity) {
    object(entry, 'activity entry');
    string(entry.at, 'activity time', 40);
    string(entry.event, 'activity event', 500);
    string(entry.detail, 'activity detail', 5000);
  }
  if (value.pendingActions !== undefined) {
    array(value.pendingActions, 'pending requests', 100);
    for (const action of value.pendingActions) {
      object(action, 'pending request');
      if (!['draft','transcribe'].includes(action.action)) throw new Error('Invalid pending request.');
      if (action.action === 'transcribe' && !value.areas.some(area => area.id === action.areaId && area.recordings.some(recording => recording.id === action.recordingId))) throw new Error('A pending request refers to a missing recording.');
    }
  }
  if (value.scopeSuggestion !== undefined) {
    const suggestion = value.scopeSuggestion;
    object(suggestion, 'scope proposal');
    string(suggestion.scope, 'proposed scope', 12000);
    string(suggestion.exclusions, 'proposed exclusions', 6000);
    string(suggestion.model, 'proposal model', 500);
    array(suggestion.questions, 'proposed questions', 100);
    suggestion.questions.forEach(question => string(question, 'proposed question', 2000));
    array(suggestion.items, 'proposed items', 60);
    for (const item of suggestion.items) {
      object(item, 'proposed item');
      if (!services.has(item.serviceId)) throw new Error('A proposal refers to an unknown service.');
      if (!['string','number'].includes(typeof item.quantity) || !Number.isFinite(Number(item.quantity))) throw new Error('Invalid proposed quantity.');
      if (item.description !== undefined) string(item.description, 'proposed description', 800);
      if (item.areaId && !areaIds.has(item.areaId)) throw new Error('A proposal refers to an unknown area.');
    }
  }
  return value;
}

export function makeBackup(visits) {
  return {format:'leveraged-systems-quote-backup',version:1,exportedAt:new Date().toISOString(),visits:structuredClone(visits)};
}

export function parseBackup(source) {
  let backup;
  try { backup = JSON.parse(source); } catch { throw new Error('Choose a valid JSON backup.'); }
  object(backup, 'backup');
  if (backup.format !== 'leveraged-systems-quote-backup') throw new Error('This is not a quote builder backup.');
  if (backup.version !== 1) throw new Error('This backup version is not supported.');
  array(backup.visits, 'backup visits', 500);
  const seen = new Set();
  for (const visit of backup.visits) {
    validateVisit(visit);
    if (seen.has(visit.id)) throw new Error('Duplicate visits in this backup.');
    seen.add(visit.id);
  }
  return structuredClone(backup.visits);
}

export function transactionComplete(transaction) {
  return new Promise((resolve,reject) => {
    transaction.addEventListener('complete', () => resolve(), {once:true});
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('Local storage transaction was aborted; changes were not saved.')), {once:true});
    transaction.addEventListener('error', () => reject(transaction.error || new Error('Local storage could not save the changes.')), {once:true});
  });
}

export function openDatabase() {
  if (!databasePromise) databasePromise = new Promise((resolve,reject) => {
    if (!globalThis.indexedDB) { reject(new Error('This browser does not provide local storage for visits.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.addEventListener('upgradeneeded', () => {
      const store = request.result.createObjectStore(STORE, {keyPath:'id'});
      store.createIndex('updatedAt','updatedAt');
    });
    request.addEventListener('success', () => {
      const db = request.result;
      db.addEventListener('versionchange', () => { db.close(); databasePromise = undefined; });
      resolve(db);
    }, {once:true});
    request.addEventListener('error', () => { databasePromise = undefined; reject(request.error || new Error('Could not open local visit storage.')); }, {once:true});
    request.addEventListener('blocked', () => { databasePromise = undefined; reject(new Error('Close other quote builder tabs, then reload to open local storage.')); }, {once:true});
  });
  return databasePromise;
}

export async function putVisits(visits) {
  visits.forEach(validateVisit);
  const db = await openDatabase();
  const transaction = db.transaction(STORE,'readwrite');
  const done = transactionComplete(transaction);
  const store = transaction.objectStore(STORE);
  for (const visit of visits) store.put(structuredClone(visit));
  await done;
}
export const putVisit = visit => putVisits([visit]);
export async function listVisits() {
  const db = await openDatabase();
  const transaction = db.transaction(STORE,'readonly');
  const done = transactionComplete(transaction);
  const request = transaction.objectStore(STORE).getAll();
  const result = new Promise((resolve,reject) => {
    request.addEventListener('success', () => resolve(request.result), {once:true});
    request.addEventListener('error', () => reject(request.error), {once:true});
  });
  const [visits] = await Promise.all([result,done]);
  return visits.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteVisit(id) {
  const db = await openDatabase();
  const transaction = db.transaction(STORE,'readwrite');
  const done = transactionComplete(transaction);
  transaction.objectStore(STORE).delete(id);
  await done;
}
