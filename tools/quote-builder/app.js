import { createVisit, calculateQuote, deriveMeasurements, formatMoney } from './domain.mjs';
import { putVisit, putVisits, listVisits, deleteVisit, makeBackup, parseBackup } from './storage.mjs';

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const uid = () => crypto.randomUUID();
const jobNames = {turf:'Turf',mulch:'Mulch / beds',planting:'Planting',cleanup:'Cleanup'};
const state = {visit:null,visits:[],areaId:null,step:'capture',mediaTab:'photos',config:null,busy:new Set(),dirty:false,revision:0,saveTimer:null,saveChain:Promise.resolve(),recorder:null,recordTimer:null,sketchTool:'draw',offlineReady:false};
const limits = () => ({maxAudioBytes:2500000,maxImageBytes:300000,maxImages:6,maxInputChars:24000,...state.config?.limits});
const currentArea = () => state.visit?.areas.find(area => area.id === state.areaId) || state.visit?.areas[0];
const quoteInput = () => ({...state.visit.quote,customer:state.visit.customer,business:state.visit.business,catalogue:state.visit.catalogue});
const dateLabel = date => {const value = new Date(`${date}T12:00:00`);return Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric'}).format(value) : 'Date required';};
const sizeLabel = dataUrl => { const bytes = Math.floor((dataUrl.split(',')[1]?.length || 0) * .75); return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`; };
const audioBytes = dataUrl => Math.floor((dataUrl.split(',')[1]?.length || 0) * .75);

function message(text, error = false) {
  const element = $('#app-message');
  element.hidden = !text;
  element.textContent = text;
  element.classList.toggle('error',error);
}
function savedStatus(text, type = '') {
  const element = $('#save-status');
  element.textContent = text;
  element.className = `status ${type}`;
}
function activity(event, detail = '') {
  if (!state.visit) return;
  state.visit.activity.unshift({at:new Date().toISOString(),event,detail:String(detail).slice(0,3000)});
  state.visit.activity = state.visit.activity.slice(0,200);
  renderActivity();
}
function traceActivity(trace) {
  if (Array.isArray(trace)) trace.slice(0,30).forEach(entry => {
    if (entry && typeof entry.event === 'string') activity(entry.event,typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail ?? ''));
  });
}
function markChanged() {
  state.dirty = true;
  state.revision += 1;
  state.visit.updatedAt = new Date().toISOString();
  savedStatus('Unsaved changes','saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveNow().catch(() => {}),650);
  renderSummary();
}
async function saveNow() {
  clearTimeout(state.saveTimer);
  if (!state.visit) return;
  const snapshot = structuredClone(state.visit), revision = state.revision;
  savedStatus('Saving on this device…','saving');
  const operation = state.saveChain.catch(() => {}).then(() => putVisit(snapshot));
  state.saveChain = operation;
  try {
    await operation;
    const existing = state.visits.findIndex(visit => visit.id === snapshot.id);
    if (existing >= 0) state.visits[existing] = snapshot; else state.visits.push(snapshot);
    if (state.visit.id === snapshot.id && state.revision === revision) {
      state.dirty = false;
      savedStatus('Saved on this device');
    }
    renderVisitPicker();
  } catch (error) {
    state.dirty = true;
    savedStatus('Not saved — retry','error');
    message(`Your latest changes are not saved. ${error.message} Export a backup before closing this page.`,true);
    throw error;
  }
}
function renderVisitPicker() {
  const visits = [...state.visits];
  if (state.visit && !visits.some(visit => visit.id === state.visit.id)) visits.push(state.visit);
  visits.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  $('#visit-select').innerHTML = visits.map(visit => `<option value="${html(visit.id)}" ${visit.id === state.visit?.id ? 'selected' : ''}>${html(visit.customer.name || visit.customer.address || 'Untitled visit')} · ${html(dateLabel(visit.quote.issueDate))}</option>`).join('');
}
function busy(key, on) {
  if (on) state.busy.add(key); else state.busy.delete(key);
  syncBusy();
}
function syncBusy() {
  const working = state.busy.size > 0;
  for (const element of document.querySelectorAll('[data-network-action]')) {
    const key = element.dataset.networkAction;
    element.disabled = working || !!state.recorder;
    if (element.dataset.normalText === undefined) element.dataset.normalText = element.textContent;
    element.textContent = state.busy.has(key) ? (key === 'pdf' ? 'Generating PDF…' : key === 'draft' ? 'Preparing scope…' : key.startsWith('transcribe-') ? 'Transcribing…' : 'Processing…') : element.dataset.normalText;
  }
  for (const selector of ['#visit-select','#new-visit','#delete-visit','#import-backup']) $(selector).disabled = working || !!state.recorder;
  for (const element of document.querySelectorAll('[data-action="select-area"],[data-action="add-area"],[data-action="delete-area"],[data-action="remove-recording"]')) element.disabled = working || !!state.recorder;
  const recordButton = $('[data-action="record"]');
  if (recordButton) recordButton.disabled = working;
  const upload = $('#audio-input');
  if (upload) upload.disabled = working || !!state.recorder;
  document.querySelectorAll('[data-recording]').forEach(input => {input.disabled = state.busy.has(`transcribe-${input.dataset.recording}`);});
  document.querySelectorAll('.sketch-tools button').forEach(button => {button.disabled = state.busy.has('sketch');});
}
function networkStatus() {
  const online = navigator.onLine !== false;
  $('#network-status').innerHTML = `<i></i>${online ? 'Online' : 'Offline'}`;
  $('#network-status').classList.toggle('offline',!online);
  const pending = state.visit?.pendingActions?.length || 0;
  const banner = $('#offline-banner');
  banner.hidden = online && !pending;
  if (!online) banner.innerHTML = `Offline. Capture, measurements and pricing work locally.${state.offlineReady ? ' The app shell is ready offline.' : ''} ${pending ? `${pending} request${pending === 1 ? '' : 's'} waiting.` : 'Scope and transcription requests can wait until you reconnect.'}`;
  else if (pending) banner.innerHTML = `${pending} request${pending === 1 ? '' : 's'} waiting. Nothing is sent automatically. Use the latest notes and image selections.<button class="button button-small" type="button" data-action="run-pending" data-network-action="pending">Run pending requests</button><button class="text-button" type="button" data-action="clear-pending">Clear queue</button>`;
  syncBusy();
}
function field(label, path, value, options = {}) {
  const id = `field-${path.replaceAll('.','-')}`;
  const attributes = `${options.max ? `maxlength="${options.max}"` : ''} ${options.type === 'number' ? `min="${options.min ?? 0}" step="${options.step ?? '0.01'}" inputmode="decimal"` : ''} ${options.type === 'email' ? 'autocomplete="email"' : ''}`;
  return `<div class="field ${options.full ? 'full' : ''} ${options.mobileFull ? 'mobile-full' : ''}"><label for="${id}">${label}</label>${options.multiline ? `<textarea id="${id}" data-field="${path}" rows="${options.rows || 3}" maxlength="${options.max || 12000}" placeholder="${html(options.placeholder || '')}">${html(value)}</textarea>` : `<input id="${id}" data-field="${path}" type="${options.type || 'text'}" value="${html(value)}" ${attributes} placeholder="${html(options.placeholder || '')}">`}${options.hint ? `<p class="hint">${options.hint}</p>` : ''}</div>`;
}
function check(label, path, checked, extra = '') {
  return `<label class="check-label"><input type="checkbox" data-field="${path}" ${checked ? 'checked' : ''} ${extra}><span>${label}</span></label>`;
}
function render() {
  if (!state.visit) return;
  const renderer = {capture:renderCapture,scope:renderScope,pricing:renderPricing,quote:renderQuote};
  $('#step-content').innerHTML = renderer[state.step]();
  document.querySelectorAll('[data-step]').forEach(button => {
    if (button.dataset.step === state.step) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
  });
  renderSummary();
  renderActivity();
  renderVisitPicker();
  if (state.step === 'capture' && state.mediaTab === 'sketch') initSketch();
  document.querySelectorAll('label.button[for]').forEach(label => {label.tabIndex = 0;label.setAttribute('role','button');});
  networkStatus();
}
function renderCapture() {
  const visit = state.visit, area = currentArea();
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">SITE VISIT</p><h1>From the site to the quote.</h1></div><span class="badge">Device only</span></div><div class="field-grid">${field('Customer name','customer.name',visit.customer.name,{max:160})}${field('Property address','customer.address',visit.customer.address,{max:400})}${field('Email <span class="optional">optional</span>','customer.email',visit.customer.email,{type:'email',max:254})}${field('Phone <span class="optional">optional</span>','customer.phone',visit.customer.phone,{type:'tel',max:50})}</div></section>
  <div class="section-row"><p class="eyebrow">AREAS ON THIS VISIT</p><span class="subtle">${visit.areas.length} area${visit.areas.length === 1 ? '' : 's'}</span></div><div class="area-tabs" aria-label="Visit areas">${visit.areas.map((item,index) => `<button type="button" class="area-tab ${item.id === area.id ? 'active' : ''}" data-action="select-area" data-id="${html(item.id)}" aria-pressed="${item.id === area.id}"><span class="number">${String(index + 1).padStart(2,'0')}</span><span><strong>${html(item.name || 'Unnamed area')}</strong><small>${jobNames[item.jobType]}</small></span></button>`).join('')}<button type="button" class="area-tab add" data-action="add-area">+ Add area</button></div>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">CAPTURE THE WORK</p><h2>${html(area.name || 'Unnamed area')}</h2></div>${visit.areas.length > 1 ? `<button type="button" class="text-button danger-text" data-action="delete-area">Remove area</button>` : ''}</div><div class="field-grid">${field('Area name','area.name',area.name,{max:160})}<div class="field"><label>Job type</label><div class="job-types" role="group" aria-label="Job type">${Object.entries(jobNames).map(([key,name]) => `<button type="button" data-action="job-type" data-value="${key}" aria-pressed="${area.jobType === key}">${name}</button>`).join('')}</div></div><div class="full">${field('Site notes','area.notes',area.notes,{multiline:true,max:12000,placeholder:'What is here now? What should change? Record condition, finish and constraints.'})}<div class="voice-controls" id="voice-controls">${recordingControls()}<label class="button button-quiet" for="audio-input" style="margin:0">Upload audio<input id="audio-input" type="file" accept="audio/*,.webm,.m4a,.mp4,.ogg,.wav" hidden></label></div><p class="hint">Audio stays on this device. Use Transcribe to send one recording for transcription, or type your notes above.</p><div id="recordings">${renderRecordings(area)}</div></div></div>
  <div class="media-tabs" aria-label="Site media"><button type="button" data-action="media-tab" data-value="photos" class="${state.mediaTab === 'photos' ? 'active' : ''}">Photos (${area.photos.length})</button><button type="button" data-action="media-tab" data-value="sketch" class="${state.mediaTab === 'sketch' ? 'active' : ''}">Sketch ${area.sketch ? '· saved' : ''}</button></div>${state.mediaTab === 'photos' ? renderPhotos(area) : renderSketch(area)}
  <hr class="section-divider"><div class="section-row"><div><p class="eyebrow">MEASUREMENTS</p><h3>Measure on site</h3></div></div><div class="field-grid three">${field('Length (m)','area.length',area.length,{type:'number'})}${field('Width (m)','area.width',area.width,{type:'number'})}${field('Depth (mm)','area.depthMm',area.depthMm,{type:'number',step:'1'})}</div><div class="measurement-result" id="measurement-result">${measurementMarkup(area)}</div>${check('I have checked these measurements on site.','area.quantityConfirmed',area.quantityConfirmed)}<p class="hint">Sketches are visual notes. Enter measurements separately; dimensions are never inferred from a drawing or photo.</p>
  <hr class="section-divider"><div class="field-grid">${field('Access & constraints','area.access',area.access,{multiline:true,max:4000,placeholder:'Gate width, slopes, parking, machinery access…'})}${field('Materials & finish','area.materials',area.materials,{multiline:true,max:4000,placeholder:'Turf variety, mulch, plant sizes, edging…'})}${field('Removal & disposal','area.disposal',area.disposal,{full:true,multiline:true,rows:2,max:4000,placeholder:'What needs to be removed? Include green waste, soil and existing material.'})}</div></section><div class="step-footer"><p class="hint">Capture each area, then prepare the scope.</p><button class="button button-primary" type="button" data-action="next" data-value="scope">Continue to scope →</button></div>`;
}
function recordingControls() {
  return state.recorder ? `<button type="button" class="button button-danger" data-action="stop-recording"><span aria-hidden="true">■</span> Stop recording</button><span class="recording-live"><i></i><span id="recording-time">${state.recorder.elapsed || '00:00'}</span> · keep this page open</span>` : `<button type="button" class="button" data-action="record"><span class="record-icon" aria-hidden="true"></span> Record notes</button>`;
}
function renderRecordings(area) {
  if (!area.recordings.length) return '';
  return area.recordings.map(recording => `<div class="recording-card"><div class="recording-heading"><strong>${html(recording.name)}</strong><button type="button" class="text-button danger-text" data-action="remove-recording" data-id="${html(recording.id)}">Remove</button></div><audio controls preload="none" src="${html(recording.dataUrl)}" aria-label="${html(recording.name)}"></audio><label for="transcript-${html(recording.id)}">Editable transcript / recording notes</label><textarea id="transcript-${html(recording.id)}" data-recording="${html(recording.id)}" maxlength="100000" placeholder="Transcribe this recording, or type a transcript yourself.">${html(recording.transcript)}</textarea>${recording.sourceTranscript ? `<details class="original-transcript"><summary>Original transcription</summary><p class="hint" style="white-space:pre-wrap">${html(recording.sourceTranscript)}</p></details>` : ''}<div class="voice-controls"><span class="hint">Original audio retained · ${sizeLabel(recording.dataUrl)}</span><button type="button" class="button button-small" data-action="transcribe" data-id="${html(recording.id)}" data-network-action="transcribe-${html(recording.id)}">Transcribe</button></div></div>`).join('');
}
function renderPhotos(area) {
  return `<label class="button button-quiet" for="photo-input" style="margin:0">+ Add site photos<input id="photo-input" type="file" accept="image/*" multiple hidden></label><p class="hint">Resized on this device before saving. Select up to ${Math.min(6,limits().maxImages)} photos or sketches across all areas for Prepare scope.</p>${area.photos.length ? `<div class="photo-grid">${area.photos.map(photo => `<div class="photo-card"><img src="${html(photo.dataUrl)}" alt="${html(photo.name)}" loading="lazy"><button type="button" class="photo-remove" data-action="remove-photo" data-id="${html(photo.id)}" aria-label="Remove ${html(photo.name)}">×</button><div class="photo-meta"><p title="${html(photo.name)}">${html(photo.name)} · ${sizeLabel(photo.dataUrl)}</p><label class="check-label"><input type="checkbox" data-photo="${html(photo.id)}" ${photo.includeInScope !== false ? 'checked' : ''}><span>Use for scope</span></label></div></div>`).join('')}</div>` : '<div class="empty" style="margin-top:16px">Add photos of the area, access and existing condition.</div>'}`;
}
function renderSketch(area) {
  const unsaved = !!area.sketchDraft;
  return `<div class="sketch-tools"><button type="button" class="button button-small ${state.sketchTool === 'draw' ? 'active' : ''}" data-action="sketch-tool" data-value="draw" aria-pressed="${state.sketchTool === 'draw'}">Draw</button><button type="button" class="button button-small ${state.sketchTool === 'erase' ? 'active' : ''}" data-action="sketch-tool" data-value="erase" aria-pressed="${state.sketchTool === 'erase'}">Erase</button><button type="button" class="button button-small button-quiet" data-action="sketch-clear">Clear</button><span class="spacer"></span><button type="button" class="button button-small" data-action="sketch-save">Save sketch</button></div><div class="sketch-wrap"><canvas id="sketch-canvas" width="1200" height="700" tabindex="0" aria-label="Freehand site sketch. Draw with a finger, stylus or mouse; enter measurements in the fields below."></canvas></div><p class="hint" id="sketch-status">${unsaved ? 'Working sketch retained locally. Use Save sketch to attach this version for scope.' : area.sketch ? 'Sketch attached to this area.' : 'Draw with a finger, stylus or mouse. Save to attach this sketch.'}</p>${area.sketch ? `<div style="margin-top:12px">${check('Use saved sketch for scope','area.sketch.includeInScope',area.sketch.includeInScope !== false)}<button type="button" class="text-button danger-text" data-action="sketch-remove">Remove saved sketch</button></div>` : ''}`;
}
function measurementMarkup(area) {
  const {areaM2,volumeM3} = deriveMeasurements(area);
  return `<span>Calculated area<strong>${areaM2 === null ? '—' : `${areaM2.toLocaleString('en-AU',{maximumFractionDigits:2})} m²`}</strong></span><span>Calculated volume<strong>${volumeM3 === null ? '—' : `${volumeM3.toLocaleString('en-AU',{maximumFractionDigits:3})} m³`}</strong></span>`;
}
function renderScope() {
  const visit = state.visit, configured = state.config?.ai?.configured;
  const selected = selectedImageCount();
  const suggestion = visit.scopeSuggestion;
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">DEFINE THE WORK</p><h1>A scope you can stand behind.</h1></div></div><p class="subtle">Use the visit notes to prepare a draft, then review every item. You can write the scope and price the work manually at any time.</p><div class="scope-area-list">${visit.areas.map(area => {const measurements = deriveMeasurements(area);return `<div class="scope-area-row"><strong>${html(area.name || 'Unnamed area')}<br><span>${jobNames[area.jobType]}</span></strong><span>${measurements.areaM2 === null ? 'No area measurement' : `${measurements.areaM2} m²${area.quantityConfirmed ? ' · checked' : ' · unchecked'}`}<br>${area.photos.filter(photo => photo.includeInScope !== false).length + (area.sketch && area.sketch.includeInScope !== false ? 1 : 0)} selected images · ${area.recordings.filter(recording => recording.transcript.trim()).length} transcript${area.recordings.filter(recording => recording.transcript.trim()).length === 1 ? '' : 's'}</span></div>`;}).join('')}</div><div class="scope-action"><button type="button" class="button button-primary" data-action="prepare-scope" data-network-action="draft">Prepare scope</button><p>Sends site notes, measurements, editable transcripts and ${selected} selected image${selected === 1 ? '' : 's'} to the AI service. Original audio stays local. ${configured === false ? '<strong>AI is not configured; manual editing is available below.</strong>' : state.config ? 'AI service access may depend on account configuration and billing.' : 'Service configuration is unavailable; requests need an internet connection.'}</p></div></section>
  ${suggestion ? `<section class="panel suggestion-panel"><div class="panel-heading"><div><p class="eyebrow">REVIEW BEFORE APPLYING</p><h2>Proposed scope</h2></div><button type="button" class="text-button" data-action="discard-suggestion">Discard</button></div><p class="hint">${html(suggestion.model ? `Prepared by ${suggestion.model}. ` : '')}This proposal has not changed your quote.</p><h4 style="margin-top:18px">Work included</h4><div class="suggestion-text">${html(suggestion.scope)}</div><h4>Exclusions</h4><div class="suggestion-text">${html(suggestion.exclusions || 'No exclusions proposed. Review before applying.')}</div><h4>Proposed line items</h4><ul>${suggestion.items.map(item => `<li>${html(item.description || state.visit.catalogue.find(service => service.id === item.serviceId)?.name || item.serviceId)} · ${html(item.quantity)} ${html(state.visit.catalogue.find(service => service.id === item.serviceId)?.unit || '')}${item.areaId ? ` · ${html(visit.areas.find(area => area.id === item.areaId)?.name || '')}` : ''}</li>`).join('')}</ul>${suggestion.questions.length ? `<h4>Questions to resolve</h4><ul>${suggestion.questions.map(question => `<li>${html(question)}</li>`).join('')}</ul>` : ''}<div class="callout" style="margin-top:18px">Applying replaces the scope and exclusions below, adds these line items to existing items, and marks all proposed quantities as unconfirmed. Review pricing next.</div><label class="check-label"><input id="suggestion-reviewed" type="checkbox"><span>I have reviewed this proposal and want to apply it to this quote.</span></label><button class="button button-primary" type="button" data-action="apply-suggestion" disabled>Apply reviewed draft</button></section>` : ''}
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">YOUR QUOTE</p><h2>Scope &amp; exclusions</h2></div></div>${field('Scope of work','quote.scope',visit.quote.scope,{multiline:true,rows:7,max:12000,placeholder:'Describe the work included, area by area. Include preparation, materials, finish and removal.'})}<div style="margin-top:18px">${field('Exclusions & assumptions','quote.exclusions',visit.quote.exclusions,{multiline:true,rows:4,max:6000,placeholder:'List work that is excluded and conditions the price relies on.'})}</div><div style="margin-top:18px">${field('Open questions · one per line','quote.questions',(visit.quote.questions || []).join('\n'),{multiline:true,rows:3,max:12000,placeholder:'Record anything still needing confirmation. Remove a question once it is resolved.',hint:'Any remaining questions keep the quote marked Draft.'})}</div><div class="approval-block">${check('I have reviewed the scope, exclusions and assumptions.','quote.scopeConfirmed',visit.quote.scopeConfirmed)}</div></section><div class="step-footer"><button class="button button-quiet" type="button" data-action="next" data-value="capture">← Site visit</button><button class="button button-primary" type="button" data-action="next" data-value="pricing">Continue to pricing →</button></div>`;
}
function renderPricing() {
  const visit = state.visit;
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">BUILD THE PRICE</p><h1>Quantities. Rates. Clear totals.</h1></div></div><div class="callout"><strong>Starting rates are samples in AUD.</strong><p>Review every service rate for your business and this job before approving the quote. Rates below exclude GST; the GST setting applies to the total.</p></div><details id="catalogue-details"><summary style="font-family:'DM Mono',monospace;font-size:12px;padding:8px 0">Edit service catalogue (${visit.catalogue.length})</summary><div class="table-scroll" style="margin-top:20px"><table class="catalogue-table"><thead><tr><th>Service</th><th class="unit-cell">Unit</th><th class="rate-cell">Rate (AUD)</th><th></th></tr></thead><tbody>${visit.catalogue.map(service => `<tr><td><input data-service="${html(service.id)}" data-key="name" value="${html(service.name)}" aria-label="Service name" maxlength="160"></td><td><input data-service="${html(service.id)}" data-key="unit" value="${html(service.unit)}" aria-label="Unit for ${html(service.name)}" maxlength="24"></td><td><input type="number" min="0" max="1000000" step="0.01" inputmode="decimal" data-service="${html(service.id)}" data-key="rateCents" value="${(service.rateCents / 100).toFixed(2)}" aria-label="Rate in dollars for ${html(service.name)}"></td><td class="remove-cell"><button type="button" class="text-button" data-action="remove-service" data-id="${html(service.id)}" aria-label="Remove ${html(service.name)}">×</button></td></tr>`).join('')}</tbody></table></div><button class="button button-small button-quiet" type="button" data-action="add-service" style="margin-top:14px">+ Add service</button></details></section>
  <section class="panel"><div class="panel-heading"><div><p class="eyebrow">QUOTE ITEMS</p><h2>Price the work</h2></div><button class="button button-small" type="button" data-action="add-line">+ Add item</button></div>${visit.quote.items.length ? visit.quote.items.map((line,index) => renderLine(line,index)).join('') : '<div class="empty">Add a line item, or prepare and review a scope draft first.</div>'}<div class="inline-actions"><button type="button" class="button button-quiet button-small" data-action="add-measurements">Add measured area items</button><span class="hint" style="margin:0">Uses your entered measurements; you confirm every quantity.</span></div><hr class="section-divider"><div class="pricing-controls"><div class="gst-setting">${check('Add 10% GST','quote.gst',visit.quote.taxRateBps === 1000)}<p class="hint">Turn on if GST applies.</p></div>${field('Quote validity (days)','quote.validDays',visit.quote.validDays,{type:'number',min:1,step:'1'})}</div><div class="approval-block">${check('I have reviewed the service rates and allowances for this job.','quote.ratesConfirmed',visit.quote.ratesConfirmed)}</div></section><div class="step-footer"><button class="button button-quiet" type="button" data-action="next" data-value="scope">← Scope</button><button class="button button-primary" type="button" data-action="next" data-value="quote">Review quote →</button></div>`;
}
function renderLine(line,index) {
  const service = state.visit.catalogue.find(item => item.id === line.serviceId);
  const cents = lineTotal(line);
  return `<div class="line-card"><div class="line-heading"><span>ITEM ${String(index + 1).padStart(2,'0')}</span><button type="button" class="text-button danger-text" data-action="remove-line" data-id="${html(line.id)}">Remove</button></div><div class="field-grid"><div class="field"><label for="service-${html(line.id)}">Service</label><select id="service-${html(line.id)}" data-line="${html(line.id)}" data-key="serviceId">${state.visit.catalogue.map(item => `<option value="${html(item.id)}" ${item.id === line.serviceId ? 'selected' : ''}>${html(item.name)} · ${html(item.unit)}</option>`).join('')}</select></div><div class="field"><label for="quantity-${html(line.id)}">Qty (${html(service?.unit || '')})</label><input id="quantity-${html(line.id)}" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" data-line="${html(line.id)}" data-key="quantity" value="${html(line.quantity)}"></div><div class="field full"><label for="desc-${html(line.id)}">Description</label><input id="desc-${html(line.id)}" data-line="${html(line.id)}" data-key="description" value="${html(line.description)}" maxlength="800" placeholder="Describe the allowance or work included"></div><div class="field full"><label for="line-area-${html(line.id)}">Area</label><select id="line-area-${html(line.id)}" data-line="${html(line.id)}" data-key="areaId"><option value="">Whole visit / general</option>${state.visit.areas.map(area => `<option value="${html(area.id)}" ${line.areaId === area.id ? 'selected' : ''}>${html(area.name || 'Unnamed area')}</option>`).join('')}</select></div></div><div class="line-meta"><label class="check-label"><input type="checkbox" data-line="${html(line.id)}" data-key="confirmed" ${line.confirmed ? 'checked' : ''}><span>I have checked this quantity.</span></label><span class="line-price" data-line-total="${html(line.id)}">${cents === null ? '—' : formatMoney(cents)}<small>${service ? `${formatMoney(service.rateCents)} / ${html(service.unit)}` : ''}</small></span></div></div>`;
}
function calculated() { try { return {quote:calculateQuote(quoteInput())}; } catch (error) { return {error:error.message}; } }
function renderSummary() {
  if (!state.visit) return;
  const result = calculated(), quote = result.quote;
  $('#live-summary').innerHTML = `<section class="panel summary-card"><p class="eyebrow">LIVE QUOTE · AUD</p><div class="summary-heading"><h3>${html(state.visit.customer.name || 'Your quote')}</h3><span class="badge ${quote && !quote.isDraft ? 'ready' : 'draft'}">${quote && !quote.isDraft ? 'Ready' : 'Draft'}</span></div><div class="summary-row"><span>${state.visit.areas.length} area${state.visit.areas.length === 1 ? '' : 's'}</span><span>${state.visit.quote.items.length} item${state.visit.quote.items.length === 1 ? '' : 's'}</span></div>${quote ? `<div class="summary-row"><span>Subtotal</span><span>${formatMoney(quote.subtotalCents)}</span></div><div class="summary-row"><span>GST ${quote.taxRateBps ? '(10%)' : '(off)'}</span><span>${formatMoney(quote.taxCents)}</span></div><div class="summary-row summary-total"><span>Total</span><strong>${formatMoney(quote.totalCents)}</strong></div>${quote.warnings.length ? `<ul class="summary-notes">${quote.warnings.map(warning => `<li>${html(warning)}</li>`).join('')}</ul>` : '<p class="hint" style="margin-top:18px">Scope, quantities and rates confirmed.</p>'}` : `<p class="quote-skeleton" style="margin-top:16px">${state.visit.quote.items.length ? html(result.error) : 'Add quote items to see your calculated total.'}</p>`}<button class="button ${quote && !quote.isDraft ? 'button-primary' : ''}" type="button" data-action="next" data-value="quote">Review &amp; export PDF →</button></section>`;
  if (state.step === 'quote' && $('#quote-paper')) $('#quote-paper').innerHTML = quotePaper(result);
  syncBusy();
}
function renderActivity() {
  $('#activity-list').innerHTML = state.visit.activity.length ? state.visit.activity.map(entry => `<li><time>${html(new Date(entry.at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</time><strong>${html(entry.event)}</strong>${entry.detail ? `<p>${html(entry.detail)}</p>` : ''}</li>`).join('') : '<li><p>No processing activity yet. Captures stay local until you request processing.</p></li>';
}
function renderQuote() {
  const visit = state.visit;
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">CHECK &amp; EXPORT</p><h1>Ready for the customer.</h1></div></div><div class="field-grid">${field('Quote reference','quote.reference',visit.quote.reference,{max:60})}${field('Issue date','quote.issueDate',visit.quote.issueDate,{type:'date'})}</div><p class="hint">Your business details appear below. <button type="button" class="text-button" data-action="business" style="padding:0;min-height:30px">Edit business details</button></p></section><div class="quote-actions"><p>The PDF service rechecks all prices. Unconfirmed work is exported with a prominent Draft label.</p><button class="button button-primary" type="button" data-action="pdf" data-network-action="pdf">Download PDF ↓</button></div><article class="quote-paper" id="quote-paper" aria-label="Quote preview">${quotePaper(calculated())}</article><div class="step-footer"><button class="button button-quiet" type="button" data-action="next" data-value="pricing">← Edit pricing</button><span class="hint">Nothing is emailed automatically.</span></div>`;
}
function quotePaper(result) {
  const quote = result.quote;
  if (!quote) return `<p class="eyebrow">QUOTE PREVIEW</p><h2>Complete the price first.</h2><p class="unavailable" style="margin-top:20px">${html(result.error)}</p><p class="hint">Add a valid quantity and service for every line to preview or export a draft.</p>`;
  return `<div class="quote-top"><div><h2>${html(quote.business.name || 'Your business')}</h2><p>${html([quote.business.email,quote.business.phone,quote.business.abn ? `ABN ${quote.business.abn}` : ''].filter(Boolean).join('\n'))}</p></div><div class="quote-doc-title"><h3>${quote.isDraft ? 'DRAFT QUOTE' : 'QUOTE'}</h3><p style="margin-top:8px">${html(quote.reference)}</p></div></div>${quote.isDraft ? `<div class="quote-warning"><strong>DRAFT · Review required before issuing</strong><ul>${quote.warnings.map(warning => `<li>${html(warning)}</li>`).join('')}</ul></div>` : ''}<div class="quote-party"><div><p class="eyebrow">PREPARED FOR</p><p><strong>${html(quote.customer.name || 'Customer name required')}</strong><br>${html(quote.customer.address || 'Property address required')}${quote.customer.email ? `<br>${html(quote.customer.email)}` : ''}${quote.customer.phone ? `<br>${html(quote.customer.phone)}` : ''}</p></div><div><p class="eyebrow">QUOTE DETAILS</p><p>Issued ${html(dateLabel(quote.issueDate))}<br>Valid until ${html(dateLabel(quote.validUntil))}<br>All amounts in AUD</p></div></div><h4>Scope of work</h4><div class="quote-copy">${html(quote.scope || 'Scope of work required.')}</div><table class="quote-lines"><thead><tr><th>Item</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${quote.items.map(item => `<tr><td>${html(item.description)}${item.areaId ? `<small>${html(state.visit.areas.find(area => area.id === item.areaId)?.name || '')}</small>` : ''}${!item.confirmed ? '<small>Quantity unconfirmed</small>' : ''}</td><td>${item.quantity} ${html(item.unit)}</td><td>${formatMoney(item.rateCents)}</td><td>${formatMoney(item.lineTotalCents)}</td></tr>`).join('')}</tbody></table><div class="quote-totals"><div class="summary-row"><span>Subtotal</span><span>${formatMoney(quote.subtotalCents)}</span></div><div class="summary-row"><span>GST ${quote.taxRateBps ? '(10%)' : '(not included)'}</span><span>${formatMoney(quote.taxCents)}</span></div><div class="summary-row summary-total"><span>Total AUD</span><strong>${formatMoney(quote.totalCents)}</strong></div></div>${quote.exclusions ? `<h4>Exclusions &amp; assumptions</h4><div class="quote-copy">${html(quote.exclusions)}</div>` : ''}${state.visit.quote.questions?.length ? `<h4>Outstanding questions</h4><div class="quote-copy">${html(state.visit.quote.questions.join('\n'))}</div>` : ''}<hr class="fine-rule"><p class="hint">Valid for ${quote.validDays} days from the issue date. ${quote.taxRateBps ? 'Includes 10% GST.' : 'GST has not been added.'}</p>`;
}

function invalidateScope() {
  state.visit.quote.scopeConfirmed = false;
  const checkbox = $('[data-field="quote.scopeConfirmed"]');
  if (checkbox) checkbox.checked = false;
}
function invalidateRates() {
  state.visit.quote.ratesConfirmed = false;
  const checkbox = $('[data-field="quote.ratesConfirmed"]');
  if (checkbox) checkbox.checked = false;
}
function updateInput(event) {
  if (!state.visit) return;
  const input = event.target;
  if (input.dataset.field) {
    const path = input.dataset.field.split('.'), value = input.type === 'checkbox' ? input.checked : input.value;
    let target = path[0] === 'area' ? currentArea() : state.visit[path[0]];
    if (path[0] === 'quote' && path[1] === 'gst') state.visit.quote.taxRateBps = value ? 1000 : 0;
    else if (path[0] === 'quote' && path[1] === 'questions') state.visit.quote.questions = value.split('\n').map(item => item.trim()).filter(Boolean);
    else {
      for (let index = 1; index < path.length - 1; index += 1) target = target[path[index]];
      target[path.at(-1)] = value;
    }
    if (path[0] === 'area' && path[1] !== 'quantityConfirmed' && path[1] !== 'sketch') invalidateScope();
    if (['length','width','depthMm'].includes(path[1]) && path[0] === 'area') {
      currentArea().quantityConfirmed = false;
      state.visit.quote.items.filter(line => line.areaId === currentArea().id).forEach(line => {line.confirmed = false;});
      const confirmation = $('[data-field="area.quantityConfirmed"]');
      if (confirmation) confirmation.checked = false;
      $('#measurement-result').innerHTML = measurementMarkup(currentArea());
    }
    if (path[0] === 'quote' && ['scope','exclusions','questions'].includes(path[1])) invalidateScope();
    if (path[0] === 'area' && path[1] === 'name') {
      const heading = $('#step-content .area-tabs .area-tab.active strong');
      if (heading) heading.textContent = value || 'Unnamed area';
    }
    markChanged();
  } else if (input.dataset.recording) {
    currentArea().recordings.find(recording => recording.id === input.dataset.recording).transcript = input.value;
    invalidateScope();
    markChanged();
  } else if (input.dataset.photo) {
    currentArea().photos.find(photo => photo.id === input.dataset.photo).includeInScope = input.checked;
    markChanged();
  } else if (input.dataset.line) {
    const line = state.visit.quote.items.find(item => item.id === input.dataset.line), key = input.dataset.key;
    line[key] = input.type === 'checkbox' ? input.checked : input.value;
    if (key === 'quantity' || key === 'serviceId') {
      line.confirmed = false;
      const confirmation = $(`[data-line="${line.id}"][data-key="confirmed"]`);
      if (confirmation) confirmation.checked = false;
    }
    markChanged();
    if (key === 'serviceId') render(); else updateLineTotal(line);
  } else if (input.dataset.service) {
    const service = state.visit.catalogue.find(item => item.id === input.dataset.service), key = input.dataset.key;
    let value = input.value;
    if (key === 'rateCents') {
      if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) > 1000000) { input.setCustomValidity('Enter a rate from $0 to $1,000,000 with at most two decimal places.'); savedStatus('Rate not saved — fix field','error'); input.reportValidity(); return; }
      value = Math.round(Number(value) * 100);
    } else if (!value.trim()) { input.setCustomValidity('A service name and unit are required.'); savedStatus('Service not saved — fix field','error'); return; }
    input.setCustomValidity('');
    service[key] = value;
    invalidateRates();
    markChanged();
    state.visit.quote.items.filter(line => line.serviceId === service.id).forEach(updateLineTotal);
  }
}
function updateLineTotal(line) {
  const output = $(`[data-line-total="${line.id}"]`), service = state.visit.catalogue.find(item => item.id === line.serviceId);
  const cents = lineTotal(line);
  if (output && service) output.innerHTML = `${cents === null ? '—' : formatMoney(cents)}<small>${formatMoney(service.rateCents)} / ${html(service.unit)}</small>`;
}
function lineTotal(line) {
  try { return calculateQuote({...quoteInput(),items:[line]}).items[0].lineTotalCents; }
  catch { return null; }
}

async function api(action, data) {
  const response = await fetch('/api/quote-builder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data}),cache:'no-store'});
  if (!response.ok) {
    let failure;
    try { failure = await response.json(); } catch {}
    throw new Error(typeof failure?.error === 'string' ? failure.error : failure?.error?.message || failure?.message || `The service returned ${response.status}. Please try again when it is available.`);
  }
  if (action === 'pdf') {
    if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('The service did not return a PDF. Your local quote is unchanged.');
    return response.blob();
  }
  return response.json();
}
async function getConfiguration() {
  try {
    const response = await fetch('/api/quote-builder',{cache:'no-store'});
    if (!response.ok) throw new Error(`Service configuration returned ${response.status}.`);
    state.config = await response.json();
  } catch (error) {
    activity('Service configuration unavailable',navigator.onLine === false ? 'Offline. Local capture and manual pricing are available.' : error.message);
    if (state.visit) markChanged();
  }
}
function selectedImageCount() {
  return state.visit.areas.reduce((count,area) => count + area.photos.filter(photo => photo.includeInScope !== false).length + (area.sketch && area.sketch.includeInScope !== false ? 1 : 0),0);
}
async function draftPayload() {
  const count = selectedImageCount(), maximum = Math.min(6,limits().maxImages);
  if (count > maximum) throw new Error(`${count} images are selected. Select no more than ${maximum} photos or sketches across the visit before preparing scope.`);
  const source = state.visit;
  const visit = {version:source.version,id:source.id,customer:{...source.customer},areas:[]};
  for (const area of source.areas) {
    const {photos,recordings,sketch,sketchDraft,...fields} = area;
    const outgoing = {...fields,photos:[],recordings:recordings.filter(recording => recording.transcript.trim()).map(recording => ({id:recording.id,name:recording.name,transcript:recording.transcript})),sketch:null};
    for (const photo of photos.filter(item => item.includeInScope !== false)) outgoing.photos.push({id:photo.id,name:photo.name,type:'image/jpeg',dataUrl:await resizeDataUrl(photo.dataUrl,limits().maxImageBytes)});
    if (sketch && sketch.includeInScope !== false) outgoing.sketch = {dataUrl:await resizeDataUrl(sketch.dataUrl,limits().maxImageBytes)};
    visit.areas.push(outgoing);
  }
  const payload = {visit,catalogue:source.catalogue};
  const textOnly = JSON.stringify({areas:visit.areas.map(({photos,sketch,...metadata}) => metadata)});
  if (textOnly.length > limits().maxInputChars) throw new Error(`Site notes and transcripts exceed the ${limits().maxInputChars.toLocaleString('en-AU')} character scope limit. Shorten the working notes or transcripts before retrying. Original recordings are retained locally.`);
  if (new TextEncoder().encode(JSON.stringify({action:'draft',...payload})).length > 3 * 1024 * 1024) throw new Error('Selected material exceeds the 3 MB request limit. Deselect some photos or shorten transcripts, then prepare scope again. All original local captures are retained.');
  return payload;
}
async function queueAction(action) {
  state.visit.pendingActions ||= [];
  const key = `${action.action}:${action.recordingId || ''}`;
  if (!state.visit.pendingActions.some(item => `${item.action}:${item.recordingId || ''}` === key)) state.visit.pendingActions.push({...action,queuedAt:new Date().toISOString()});
  activity('Request queued locally',action.action === 'draft' ? 'Prepare scope is waiting for your explicit action after reconnecting.' : 'Transcription is waiting for your explicit action after reconnecting. Original audio is retained.');
  markChanged();
  await saveNow();
  networkStatus();
  message('Request queued on this device. After reconnecting, choose Run pending requests. Nothing will be sent automatically.');
}
async function prepareScope(allowQueue = true) {
  if (navigator.onLine === false && allowQueue) { await queueAction({action:'draft'}); return false; }
  busy('draft',true);
  message('');
  try {
    await saveNow();
    const payload = await draftPayload();
    activity('Scope request sent',`${payload.visit.areas.length} areas; ${selectedImageCount()} selected images. Audio data excluded.`);
    markChanged();
    const result = await api('draft',payload);
    if (typeof result.scope !== 'string' || typeof result.exclusions !== 'string' || !Array.isArray(result.items) || !Array.isArray(result.questions)) throw new Error('The scope response was incomplete. Your existing quote has not changed.');
    if (result.scope.length > 12000 || result.exclusions.length > 6000 || result.items.length > 60 || result.items.some(item => !state.visit.catalogue.some(service => service.id === item.serviceId) || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || (item.areaId && !state.visit.areas.some(area => area.id === item.areaId)))) throw new Error('The proposed scope contains an invalid item. Your existing quote has not changed.');
    state.visit.scopeSuggestion = {scope:result.scope,exclusions:result.exclusions,items:result.items,questions:result.questions.filter(item => typeof item === 'string'),model:result.model || ''};
    traceActivity(result.trace);
    activity('Scope proposal received',`${result.items.length} proposed items; ${result.questions.length} questions. Review and apply explicitly.`);
    markChanged();
    await saveNow();
    state.step = 'scope';
    render();
    message('Scope proposal received. Review it below before applying it to your quote.');
    return true;
  } catch (error) {
    activity('Scope request did not complete',error.message);
    markChanged();
    message(`${error.message} Your captured sources and existing quote are retained. You can continue with manual scope and pricing.`,true);
    return false;
  } finally { busy('draft',false); }
}
async function transcribe(recordingId, areaId = currentArea().id, allowQueue = true) {
  const area = state.visit.areas.find(item => item.id === areaId), recording = area?.recordings.find(item => item.id === recordingId);
  if (!recording) throw new Error('The queued recording no longer exists. Clear this queued request.');
  if (navigator.onLine === false && allowQueue) { await queueAction({action:'transcribe',areaId,recordingId}); return false; }
  const key = `transcribe-${recordingId}`;
  busy(key,true);
  message('');
  try {
    if (audioBytes(recording.dataUrl) > limits().maxAudioBytes) throw new Error(`This recording is larger than the ${(limits().maxAudioBytes / 1024 / 1024).toFixed(0)} MB transcription limit. Keep it locally and type notes, or upload a shorter recording.`);
    await saveNow();
    activity('Transcription requested',`${recording.name} · ${sizeLabel(recording.dataUrl)}. Original recording retained locally.`);
    markChanged();
    const result = await api('transcribe',{audio:{dataUrl:recording.dataUrl,type:recording.type,name:recording.name}});
    if (typeof result.transcript !== 'string') throw new Error('The service returned no transcript.');
    if (recording.transcript.trim()) recording.previousTranscripts = [...(recording.previousTranscripts || []),recording.transcript].slice(-20);
    recording.sourceTranscript = result.transcript;
    recording.transcript = result.transcript;
    traceActivity(result.trace);
    activity('Transcription received',result.model || recording.name);
    invalidateScope();
    markChanged();
    await saveNow();
    render();
    message('Transcript received. Review and edit it against the retained recording.');
    return true;
  } catch (error) {
    activity('Transcription did not complete',error.message);
    markChanged();
    message(`${error.message} The original recording and existing transcript are still here. You can type notes or retry explicitly.`,true);
    return false;
  } finally { busy(key,false); }
}
async function runPending() {
  if (navigator.onLine === false) { message('Reconnect before running pending requests. Your captures are saved locally.',true); return; }
  busy('pending',true);
  try {
    if (!state.config) await getConfiguration();
    for (const action of [...(state.visit.pendingActions || [])]) {
      const succeeded = action.action === 'draft' ? await prepareScope(false) : await transcribe(action.recordingId,action.areaId,false);
      if (!succeeded) break;
      state.visit.pendingActions = state.visit.pendingActions.filter(item => item !== action);
      markChanged();
      await saveNow();
    }
  } finally { busy('pending',false); networkStatus(); }
}
async function downloadPDF() {
  if (navigator.onLine === false) { message('PDF generation needs an internet connection. Your local quote and preview are retained.',true); return; }
  const {quote,error} = calculated();
  if (!quote) { message(error,true); return; }
  busy('pdf',true);
  message('');
  try {
    await saveNow();
    const blob = await api('pdf',{quote:quoteInput()});
    download(blob,`${quote.isDraft ? 'DRAFT-' : ''}${quote.reference.replace(/[^a-zA-Z0-9_-]/g,'-')}.pdf`);
    activity('PDF downloaded',`${quote.isDraft ? 'Draft' : 'Confirmed'} quote ${quote.reference} · ${formatMoney(quote.totalCents)}. Prices recalculated by the PDF service.`);
    markChanged();
    await saveNow();
    message(quote.isDraft ? 'Draft PDF downloaded. Resolve the review warnings before issuing a final quote.' : 'PDF downloaded. Ready to share after your final review.');
  } catch (error) { activity('PDF export did not complete',error.message); markChanged(); message(error.message,true); }
  finally { busy('pdf',false); }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}

function fileDataUrl(blob) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('This file could not be read. Please select it again.'));
    reader.readAsDataURL(blob);
  });
}
async function loadImage(source) {
  return new Promise((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image format could not be opened. Use a JPEG, PNG or WebP image supported by this browser.'));
    image.src = source;
  });
}
async function resizeDataUrl(source, maximumBytes = limits().maxImageBytes) {
  const image = await loadImage(source);
  let scale = Math.min(1,1400 / Math.max(image.naturalWidth,image.naturalHeight));
  const canvas = document.createElement('canvas');
  let dataUrl;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    canvas.width = Math.max(1,Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1,Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    dataUrl = canvas.toDataURL('image/jpeg',.78 - attempt * .06);
    if (audioBytes(dataUrl) <= maximumBytes) return dataUrl;
    scale *= .78;
  }
  throw new Error('This image could not be reduced to the service size limit. Choose a smaller image.');
}
async function addPhotos(files) {
  if (!files.length) return;
  busy('photos',true);
  try {
    const area = currentArea();
    if (area.photos.length + files.length > 100) throw new Error('Keep up to 100 photos in one area. Add another area or remove unneeded photos first.');
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);
      const source = URL.createObjectURL(file);
      try {
        const dataUrl = await resizeDataUrl(source);
        area.photos.push({id:uid(),name:file.name.replace(/\.[^.]+$/,'') + '.jpg',originalName:file.name,type:'image/jpeg',dataUrl,includeInScope:true});
        markChanged();
      } finally { URL.revokeObjectURL(source); }
    }
    activity('Photos saved locally',`${files.length} photo${files.length === 1 ? '' : 's'} resized before storage. Nothing sent to AI.`);
    markChanged();
    await saveNow();
    render();
  } catch (error) { message(error.message,true); render(); }
  finally { busy('photos',false); }
}
function normalizeAudioType(file) {
  const known = {webm:'audio/webm',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',aac:'audio/aac',flac:'audio/flac'};
  return file.type && /^(audio\/|video\/webm)/.test(file.type) ? file.type : known[file.name.split('.').at(-1).toLowerCase()];
}
async function uploadAudio(file) {
  if (!file) return;
  busy('audio-upload',true);
  try {
    if (currentArea().recordings.length >= 100) throw new Error('Keep up to 100 recordings in one area. Add another area or remove unneeded recordings first.');
    const type = normalizeAudioType(file);
    if (!type) throw new Error('Choose a supported audio recording such as MP3, M4A, WAV or WebM.');
    const dataUrl = await fileDataUrl(new Blob([file],{type}));
    currentArea().recordings.push({id:uid(),name:file.name,type,dataUrl,transcript:''});
    activity('Audio uploaded locally',`${file.name}. Not sent for transcription.`);
    markChanged();
    await saveNow();
    render();
    if (file.size > limits().maxAudioBytes) message('Recording retained locally. It exceeds the current transcription size limit; type notes or use a shorter recording.');
  } catch (error) { message(error.message,true); }
  finally { busy('audio-upload',false); }
}
async function startRecording() {
  if (currentArea().recordings.length >= 100) {message('Keep up to 100 recordings in one area. Add another area or remove unneeded recordings first.',true);return;}
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { message('Recording is not available in this browser. Upload an audio file or type site notes instead.',true); return; }
  busy('microphone',true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const preferred = ['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream,preferred ? {mimeType:preferred} : undefined);
    const capture = {recorder,stream,chunks:[],area:currentArea(),started:Date.now(),elapsed:'00:00',resolveStop:null,rejectStop:null};
    state.recorder = capture;
    recorder.addEventListener('dataavailable',event => { if (event.data.size) capture.chunks.push(event.data); });
    recorder.addEventListener('error',event => {
      message(`Recording stopped unexpectedly. ${event.error?.message || 'Please check microphone access.'} Any captured audio will be retained.`,true);
      stopRecording().catch(() => {});
    });
    recorder.addEventListener('stop',async () => {
      clearInterval(state.recordTimer);
      capture.stream.getTracks().forEach(track => track.stop());
      try {
        const type = recorder.mimeType || capture.chunks[0]?.type || 'audio/webm', blob = new Blob(capture.chunks,{type});
        if (blob.size) {
          const dataUrl = await fileDataUrl(blob), extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          capture.area.recordings.push({id:uid(),name:`Site notes ${new Date(capture.started).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}).replace(':','-')}.${extension}`,type,dataUrl,transcript:''});
          activity('Recording retained locally',`${capture.area.name || 'Area'} · ${Math.max(1,Math.round((Date.now() - capture.started) / 1000))} seconds. Transcription has not been requested.`);
          markChanged();
          await saveNow();
        } else message('No audio was captured. Try recording again, upload audio or type your notes.',true);
        capture.resolveStop?.();
      } catch (error) { capture.rejectStop?.(error); message(`Recording is still in this page but could not be saved. ${error.message} Export a backup before closing.`,true); }
      finally { state.recorder = null; render(); }
    });
    recorder.start(1000);
    state.recordTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - capture.started) / 1000);
      capture.elapsed = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;
      const timer = $('#recording-time');
      if (timer) timer.textContent = capture.elapsed;
    },500);
    render();
    message('Recording on this device. Stop to retain the audio before leaving this page.');
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    state.recorder = null;
    const reason = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' ? 'Microphone permission was denied. Enable microphone access in your browser if you want to record.' : error.name === 'NotFoundError' ? 'No microphone was found.' : `The microphone could not start. ${error.message}`;
    message(`${reason} Upload an audio file or type your site notes instead.`,true);
  } finally { busy('microphone',false); }
}
async function stopRecording() {
  const capture = state.recorder;
  if (!capture) return;
  if (capture.stopPromise) return capture.stopPromise;
  capture.stopPromise = new Promise((resolve,reject) => {capture.resolveStop = resolve;capture.rejectStop = reject;});
  if (capture.recorder.state !== 'inactive') capture.recorder.stop();
  capture.stream.getTracks().forEach(track => track.stop());
  return capture.stopPromise;
}
function initSketch() {
  const canvas = $('#sketch-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d'), area = currentArea();
  const initial = area.sketchDraft?.dataUrl || area.sketch?.dataUrl;
  if (initial) { const image = new Image(); image.onload = () => context.drawImage(image,0,0,canvas.width,canvas.height); image.src = initial; }
  let drawing = false;
  const point = event => {const rect = canvas.getBoundingClientRect();return {x:(event.clientX - rect.left) * canvas.width / rect.width,y:(event.clientY - rect.top) * canvas.height / rect.height};};
  const move = event => {
    if (!drawing) return;
    const position = point(event);
    context.globalCompositeOperation = state.sketchTool === 'erase' ? 'destination-out' : 'source-over';
    context.lineWidth = state.sketchTool === 'erase' ? 40 : 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0A0A0A';
    context.lineTo(position.x,position.y);
    context.stroke();
  };
  canvas.addEventListener('pointerdown',event => {
    if (state.busy.has('sketch')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    const position = point(event);
    context.beginPath();context.moveTo(position.x,position.y);context.lineTo(position.x + .1,position.y + .1);move(event);
  });
  canvas.addEventListener('pointermove',event => {event.preventDefault();move(event);});
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    context.closePath();
    area.sketchDraft = {dataUrl:canvas.toDataURL('image/png')};
    markChanged();
    $('#sketch-status').textContent = 'Working sketch retained locally. Use Save sketch to attach this version for scope.';
  };
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('lostpointercapture',finish);
}
async function saveSketch() {
  const canvas = $('#sketch-canvas');
  if (!canvas) return;
  busy('sketch',true);
  canvas.style.pointerEvents = 'none';
  try {
    const area = currentArea();
    area.sketch = {dataUrl:await resizeDataUrl(canvas.toDataURL('image/png')),includeInScope:area.sketch?.includeInScope !== false};
    delete area.sketchDraft;
    activity('Sketch saved locally',`${area.name || 'Area'}. Measurements remain entered separately.`);
    markChanged();
    await saveNow();
    render();
  } finally {canvas.style.pointerEvents = '';busy('sketch',false);}
}

function showBusiness() {
  $('#business-fields').innerHTML = `<div class="field-grid">${field('Business name','business.name',state.visit.business.name,{full:true,max:160})}${field('Email','business.email',state.visit.business.email,{type:'email',max:254})}${field('Phone','business.phone',state.visit.business.phone,{type:'tel',max:50})}${field('ABN <span class="optional">optional</span>','business.abn',state.visit.business.abn,{full:true,max:50})}</div>`;
  $('#business-dialog').showModal();
}
async function changeVisit(id) {
  if (state.recorder) await stopRecording();
  if (state.dirty) await saveNow();
  const visit = state.visits.find(item => item.id === id);
  if (!visit) return;
  state.visit = structuredClone(visit);
  state.areaId = visit.areas[0].id;
  state.revision += 1;
  state.dirty = false;
  savedStatus('Saved on this device');
  message('');
  render();
}
async function newVisit() {
  if (state.recorder) await stopRecording();
  if (state.dirty) await saveNow();
  const previous = state.visit;
  state.visit = createVisit();
  if (previous) { state.visit.business = structuredClone(previous.business); state.visit.catalogue = structuredClone(previous.catalogue); }
  state.areaId = state.visit.areas[0].id;
  state.step = 'capture';
  activity('Visit created locally','Customer details, captures and quotes are stored on this device.');
  markChanged();
  await saveNow();
  message('');
  render();
}
async function exportBackup() {
  if (state.recorder) await stopRecording();
  const visits = [...state.visits.filter(visit => visit.id !== state.visit.id),structuredClone(state.visit)];
  download(new Blob([JSON.stringify(makeBackup(visits),null,2)],{type:'application/json'}),`landscaping-visits-${new Date().toISOString().slice(0,10)}.json`);
  message(`Backup exported with ${visits.length} visit${visits.length === 1 ? '' : 's'}, including local audio, photos and sketches. Keep it somewhere safe.`);
}
async function importBackup(file) {
  if (!file) return;
  busy('import',true);
  try {
    const visits = parseBackup(await file.text());
    if (!visits.length) throw new Error('This backup has no visits to import.');
    const collisions = visits.filter(visit => state.visits.some(existing => existing.id === visit.id));
    if (collisions.length && !confirm(`This backup contains ${collisions.length} visit${collisions.length === 1 ? '' : 's'} already on this device. Replace those visits with the backed-up copies? Other visits will be kept.`)) return;
    if (state.dirty) await saveNow();
    await putVisits(visits);
    state.visits = await listVisits();
    await changeVisit(visits[0].id);
    message(`${visits.length} visit${visits.length === 1 ? '' : 's'} restored, including their local media. Other saved visits were kept.`);
  } catch (error) { message(`Backup was not imported. ${error.message}`,true); }
  finally { $('#backup-input').value = ''; busy('import',false); }
}
async function removeVisit() {
  if (!confirm('Delete this visit and all its local photos, sketches and recordings from this device? Export a backup first if you need to keep it.')) return;
  clearTimeout(state.saveTimer);
  await state.saveChain.catch(() => {});
  const id = state.visit.id;
  await deleteVisit(id);
  state.visits = state.visits.filter(visit => visit.id !== id);
  state.dirty = false;
  if (state.visits.length) await changeVisit(state.visits[0].id); else { state.visit = null; await newVisit(); }
  message('Visit deleted from this device.');
}
function newLine(serviceId, quantity = '1', description = '', areaId = '') {
  if (state.visit.quote.items.length >= 60) throw new Error('A quote can contain up to 60 line items.');
  return {id:uid(),serviceId,quantity:String(quantity),description,areaId,confirmed:false};
}
function addMeasuredItems() {
  const proposed = [];
  for (const area of state.visit.areas) {
    const measurements = deriveMeasurements(area), serviceId = area.jobType === 'turf' ? 'turf' : area.jobType === 'mulch' ? 'mulch' : null;
    const value = area.jobType === 'turf' ? measurements.areaM2 : measurements.volumeM3;
    if (serviceId && state.visit.catalogue.some(service => service.id === serviceId) && value && Number(value.toFixed(2)) > 0) proposed.push({area,serviceId,value});
  }
  if (!proposed.length) { message('Enter length and width for turf, or length, width and depth for mulch. Planting and cleanup quantities are entered manually.'); return; }
  if (state.visit.quote.items.length + proposed.length > 60) throw new Error('Adding these measured areas would exceed 60 quote items.');
  for (const {area,serviceId,value} of proposed) state.visit.quote.items.push(newLine(serviceId,value.toFixed(2),`${area.name}: ${state.visit.catalogue.find(service => service.id === serviceId).name}`,area.id));
  markChanged();render();
  message(`${proposed.length} measured item${proposed.length === 1 ? '' : 's'} added. Quantities rounded to two decimal places; review and confirm each one.`);
}

document.addEventListener('input',updateInput);
document.addEventListener('keydown',event => {
  const label = event.target.closest('label.button[for]');
  if (label && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault();document.getElementById(label.htmlFor)?.click();}
});
document.addEventListener('change',async event => {
  const input = event.target;
  try {
    if (input.id === 'visit-select') await changeVisit(input.value);
    else if (input.id === 'photo-input') await addPhotos([...input.files]);
    else if (input.id === 'audio-input') await uploadAudio(input.files[0]);
    else if (input.id === 'backup-input') await importBackup(input.files[0]);
    else if (input.id === 'suggestion-reviewed') $('[data-action="apply-suggestion"]').disabled = !input.checked;
  } catch (error) { message(error.message,true); }
});
document.addEventListener('click',async event => {
  const button = event.target.closest('button[data-action],button[data-step]');
  if (!button || button.disabled || !state.visit) return;
  const action = button.dataset.action, id = button.dataset.id;
  try {
    if (button.dataset.step || action === 'next') {
      if (state.recorder) { message('Stop the current recording before changing steps. It will be retained in this area.',true); return; }
      const invalid = $('#step-content input:invalid, #step-content textarea:invalid, #step-content select:invalid');
      if (invalid) {invalid.reportValidity();return;}
      state.step = button.dataset.step || button.dataset.value;
      message('');render();window.scrollTo({top:0,behavior:'instant'});
    } else if (action === 'select-area') { state.areaId = id; render(); }
    else if (action === 'add-area') {
      if (state.visit.areas.length >= 100) throw new Error('A visit can contain up to 100 areas.');
      const area = {...createVisit().areas[0],name:`Area ${state.visit.areas.length + 1}`};
      state.visit.areas.push(area);state.areaId = area.id;markChanged();render();
    } else if (action === 'delete-area') {
      const area = currentArea();
      if (!confirm(`Remove ${area.name || 'this area'} and its local captures? Associated quote items will remain and be assigned to the whole visit.`)) return;
      state.visit.areas = state.visit.areas.filter(item => item.id !== area.id);
      state.visit.pendingActions = (state.visit.pendingActions || []).filter(item => item.areaId !== area.id);
      delete state.visit.scopeSuggestion;
      state.visit.quote.items.forEach(line => {if(line.areaId === area.id) {line.areaId = '';line.confirmed = false;}});
      state.areaId = state.visit.areas[0].id;invalidateScope();markChanged();render();
    } else if (action === 'job-type') { currentArea().jobType = button.dataset.value;invalidateScope();markChanged();render(); }
    else if (action === 'media-tab') { state.mediaTab = button.dataset.value;render(); }
    else if (action === 'record') await startRecording();
    else if (action === 'stop-recording') await stopRecording();
    else if (action === 'transcribe') await transcribe(id);
    else if (action === 'remove-recording') {
      if (!confirm('Remove this original recording and its transcript from the visit?')) return;
      currentArea().recordings = currentArea().recordings.filter(recording => recording.id !== id);
      state.visit.pendingActions = (state.visit.pendingActions || []).filter(item => item.recordingId !== id);
      invalidateScope();markChanged();render();
    } else if (action === 'remove-photo') {
      currentArea().photos = currentArea().photos.filter(photo => photo.id !== id);markChanged();render();
    } else if (action === 'sketch-tool') {
      state.sketchTool = button.dataset.value;
      document.querySelectorAll('[data-action="sketch-tool"]').forEach(item => {item.classList.toggle('active',item.dataset.value === state.sketchTool);item.setAttribute('aria-pressed',String(item.dataset.value === state.sketchTool));});
    } else if (action === 'sketch-clear') {
      const canvas = $('#sketch-canvas');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
      currentArea().sketchDraft = {dataUrl:canvas.toDataURL('image/png')};markChanged();
      $('#sketch-status').textContent = 'Canvas cleared locally. Save sketch to replace the saved sketch used for scope.';
    } else if (action === 'sketch-save') await saveSketch();
    else if (action === 'sketch-remove') {currentArea().sketch = null;delete currentArea().sketchDraft;markChanged();render();}
    else if (action === 'prepare-scope') await prepareScope();
    else if (action === 'discard-suggestion') {delete state.visit.scopeSuggestion;markChanged();render();}
    else if (action === 'apply-suggestion') {
      if (!$('#suggestion-reviewed').checked) return;
      const suggestion = state.visit.scopeSuggestion;
      if (state.visit.quote.items.length + suggestion.items.length > 60) throw new Error('Applying this proposal would exceed 60 quote items. Remove existing items first.');
      state.visit.quote.scope = suggestion.scope;state.visit.quote.exclusions = suggestion.exclusions;state.visit.quote.questions = [...suggestion.questions];
      suggestion.items.forEach(item => state.visit.quote.items.push(newLine(item.serviceId,item.quantity,item.description || '',item.areaId || '')));
      state.visit.quote.scopeConfirmed = false;state.visit.quote.ratesConfirmed = false;
      activity('Reviewed scope proposal applied',`${suggestion.items.length} unconfirmed items added. Original captures retained.`);
      delete state.visit.scopeSuggestion;markChanged();await saveNow();render();message('Scope applied. Review open questions, quantities and rates before finalising.');
    } else if (action === 'add-line') {state.visit.quote.items.push(newLine(state.visit.catalogue[0].id));markChanged();render();}
    else if (action === 'remove-line') {state.visit.quote.items = state.visit.quote.items.filter(line => line.id !== id);markChanged();render();}
    else if (action === 'add-measurements') addMeasuredItems();
    else if (action === 'add-service') {
      if (state.visit.catalogue.length >= 60) throw new Error('The catalogue can contain up to 60 services.');
      state.visit.catalogue.push({id:`custom-${uid()}`,name:'Custom service',unit:'job',rateCents:0});invalidateRates();markChanged();render();$('#catalogue-details').open = true;
    } else if (action === 'remove-service') {
      if (state.visit.catalogue.length <= 1) throw new Error('Keep at least one service in the catalogue.');
      if (state.visit.quote.items.some(line => line.serviceId === id)) throw new Error('This service is used by a quote item. Change or remove that item first.');
      if (state.visit.scopeSuggestion?.items.some(line => line.serviceId === id)) throw new Error('This service is used by the pending scope proposal. Apply or discard that proposal first.');
      state.visit.catalogue = state.visit.catalogue.filter(service => service.id !== id);invalidateRates();markChanged();render();$('#catalogue-details').open = true;
    } else if (action === 'pdf') await downloadPDF();
    else if (action === 'business') showBusiness();
    else if (action === 'run-pending') await runPending();
    else if (action === 'clear-pending') {state.visit.pendingActions = [];activity('Pending requests cleared','Nothing sent. Captures remain local.');markChanged();networkStatus();}
  } catch (error) { message(error.message,true); }
});
$('#new-visit').addEventListener('click',() => newVisit().catch(error => message(error.message,true)));
$('#business-settings').addEventListener('click',() => {if(state.visit) showBusiness();});
$('#close-business').addEventListener('click',() => $('#business-dialog').close());
$('#business-dialog').addEventListener('close',() => {if(state.visit) renderSummary();});
$('#retry-save').addEventListener('click',() => saveNow().then(() => message('Visit saved on this device.')).catch(() => {}));
$('#delete-visit').addEventListener('click',() => removeVisit().catch(error => message(error.message,true)));
$('#export-backup').addEventListener('click',() => exportBackup().catch(error => message(error.message,true)));
$('#import-backup').addEventListener('click',() => $('#backup-input').click());
window.addEventListener('online',() => networkStatus());
window.addEventListener('offline',() => networkStatus());
window.addEventListener('beforeunload',event => {if (state.recorder || state.dirty) {event.preventDefault();event.returnValue = '';}});
document.addEventListener('visibilitychange',() => {if(document.visibilityState === 'hidden' && state.dirty) saveNow().catch(() => {});});

async function initialize() {
  try {
    state.visits = await listVisits();
    if (state.visits.length) {
      state.visit = structuredClone(state.visits[0]);state.areaId = state.visit.areas[0].id;savedStatus('Saved on this device');
    } else await newVisit();
  } catch (error) {
    if (!state.visit) {state.visit = createVisit();state.areaId = state.visit.areas[0].id;}
    state.dirty = true;savedStatus('Local storage unavailable','error');
    message(`${error.message} You can work in this page, but export a backup before closing it.`,true);
  }
  render();
  await getConfiguration();
  if (state.step === 'scope') render();
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/tools/quote-builder/sw.js',{scope:'/tools/quote-builder/'});
      if (registration.active) state.offlineReady = true;
      else registration.addEventListener('updatefound',() => registration.installing?.addEventListener('statechange',event => {if(event.target.state === 'activated') {state.offlineReady = true;networkStatus();}}));
      navigator.serviceWorker.ready.then(() => {state.offlineReady = true;networkStatus();});
    } catch (error) { activity('Offline shell unavailable',error.message);markChanged(); }
  }
  networkStatus();
}
initialize();
