import {DEFAULT_SETTINGS,SCOPE_MODELS,TRANSCRIPTION_MODELS,validateSettings,selectScopeModel,emptyProfiles,loadProfiles,storeProfiles,validateProfiles,activeSettings} from './settings.mjs';
import {createVisit,DEFAULT_CATALOGUE} from './domain.mjs';
import {buildSystemInstructions,CORE_RULES,EVIDENCE_PREFIX,TOOL_DEFINITIONS} from './instructions.mjs';
import {loadRuns,saveRun} from './runs.mjs';

const $ = selector => document.querySelector(selector);
const form = $('#settings-form');
let profiles = emptyProfiles(), testing = false, runs = [], displayedRun = null;

function notice(text, error = false) {
  $('#notice').hidden = !text;$('#notice').textContent = text;$('#notice').classList.toggle('error',error);
}
function action(fn) {return async () => {try {await fn();} catch (error) {notice(error.message,true);}};}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function read() {
  const settings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'timeoutMs') {settings[key] = Number($('#timeoutSeconds').value) * 1000;continue;}
    const input = form.elements.namedItem(key);
    settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
  }
  return validateSettings(settings);
}
function fill(settings) {
  for (const [key,value] of Object.entries(settings)) {
    const input = form.elements.namedItem(key);if (!input) continue;
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
  }
  $('#timeoutSeconds').value = settings.timeoutMs / 1000;updateInstructionPreview();
}
function updateInstructionPreview() {
  $('#fixed-rules').textContent = typeof CORE_RULES === 'string' ? CORE_RULES : JSON.stringify(CORE_RULES,null,2);
  $('#evidence-prefix').textContent = EVIDENCE_PREFIX;
  $('#tool-definitions').textContent = JSON.stringify(TOOL_DEFINITIONS,null,2);
  try {
    $('#system-instructions').textContent = buildSystemInstructions(read());
    $('#instruction-preview-status').textContent = 'Exact system instructions for the current form. Your quote builder keeps using its active settings until you activate this version.';
  } catch (error) {
    $('#system-instructions').textContent = '';
    $('#instruction-preview-status').textContent = `Complete valid settings to preview the exact instructions. ${error.message}`;
  }
}
function render() {
  const active = profiles.profiles.find(profile => profile.id === profiles.activeId),settings = active?.settings ?? DEFAULT_SETTINGS;
  $('#active-name').textContent = active?.name ?? 'Default settings';
  $('#active-summary').textContent = `Scope: ${settings.scopeModel}\nImages: ${settings.includeImages ? settings.imageModel : 'Excluded'}\nTranscripts: ${settings.includeTranscripts ? 'Included' : 'Excluded'}\nUp to ${settings.maxSteps} steps · ${settings.maxOutputTokens} tokens/step\nDrafting ${settings.draftingEnabled ? 'on' : 'off'} · transcription ${settings.transcriptionEnabled ? 'on' : 'off'}`;
  const previous = $('#versions').value;$('#versions').replaceChildren();
  for (const profile of [...profiles.profiles].reverse()) {
    const option = node('option',`${profile.name}${profile.id === profiles.activeId ? ' · active' : ''} · ${new Date(profile.createdAt).toLocaleString('en-AU')}`);
    option.value = profile.id;$('#versions').append(option);
  }
  if (profiles.profiles.some(profile => profile.id === previous)) $('#versions').value = previous;
  for (const id of ['load-version','restore-version','delete-version']) $('#' + id).disabled = !profiles.profiles.length;
}
function selected() {
  const profile = profiles.profiles.find(profile => profile.id === $('#versions').value);
  if (!profile) throw new Error('Choose a saved version first.');return profile;
}
function persist(next) {profiles = storeProfiles(next);render();}
function save(activate) {
  const settings = read(), name = $('#profile-name').value.trim();if (!name) throw new Error('Give this version a name.');
  const id = crypto.randomUUID(),profile = {id,name,createdAt:new Date().toISOString(),settings};
  persist({...profiles,profiles:[...profiles.profiles,profile],activeId:activate ? id : profiles.activeId});$('#versions').value = id;
  notice(activate ? 'Settings activated for your next request in this browser.' : 'Version saved. Active settings have not changed.');
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text],{type:'application/json'})),anchor = node('a');
  anchor.href = url;anchor.download = name;anchor.click();setTimeout(() => URL.revokeObjectURL(url),1000);
}
function detail(parent, label, text, open = false) {
  const details = node('details',undefined,'instruction-details');details.open = open;
  details.append(node('summary',label),node('pre',text,'instruction-code'));parent.append(details);
}
function showRun(run) {
  displayedRun = run ?? null;const panel = $('#run-details');panel.replaceChildren();$('#export-run').disabled = !run;
  if (!run) {panel.append(node('p','No run records saved in this browser yet. Local checks do not create AI run records.','hint'));return;}
  const summary = node('div',undefined,'run-summary');
  for (const [label,value] of [['Status',run.status],['Requested model',run.modelRequested],['Reported model',run.modelReported ?? 'Not reported'],['Started',run.startedAt],['Finished',run.finishedAt],['Elapsed',`${run.elapsedMs} ms`],['Run ID',run.id]]) {
    const row = node('div');row.append(node('span',label),node('strong',String(value ?? 'Not recorded')));summary.append(row);
  }
  panel.append(summary);if (run.error) panel.append(node('p',`${run.error.code}: ${run.error.message}`,'run-error'));
  detail(panel,'Purpose and working brief used',run.settings?.workingBrief ?? 'Not recorded');
  panel.append(node('p','A connection failure may stop before these instructions and evidence reach a provider.','hint'));
  detail(panel,'Exact system instructions prepared',run.systemInstructions ?? 'Not recorded');
  detail(panel,'Request text prepared',run.requestText ?? 'Not recorded');
  detail(panel,'Image attachments (metadata)',JSON.stringify(run.imageSummary ?? [],null,2));
  detail(panel,'Tool definitions for this attempt',JSON.stringify(run.tools ?? [],null,2));
  detail(panel,'Settings snapshot',JSON.stringify(run.settings ?? null,null,2));
  detail(panel,'Actual processing trace',JSON.stringify(run.trace ?? [],null,2));
  detail(panel,'Model steps · tool calls and results',JSON.stringify(run.steps ?? [],null,2));
  detail(panel,'Returned output',JSON.stringify(run.output ?? null,null,2),true);
  detail(panel,'Reported usage',JSON.stringify(run.usage ?? null,null,2));
  detail(panel,'Full run record (JSON)',JSON.stringify(run,null,2));
}
function refreshRuns(preferredId) {
  try {
    const previous = preferredId ?? $('#run-select').value;runs = loadRuns();$('#run-select').replaceChildren();
    for (const run of runs) {const option = node('option',`${new Date(run.startedAt).toLocaleString('en-AU')} · ${run.status} · ${run.modelRequested}`);option.value = run.id;$('#run-select').append(option);}
    const selectedRun = runs.find(run => run.id === previous) ?? runs[0];if (selectedRun) $('#run-select').value = selectedRun.id;
    $('#run-select').disabled = !runs.length;showRun(selectedRun);return true;
  } catch (error) {
    $('#run-storage-error').hidden = false;$('#run-storage-error').textContent = `Run history could not be read. ${error.message} The current AI result remains available.`;return false;
  }
}
function rememberRun(run) {
  if (!run) return;
  try {saveRun(run);$('#run-storage-error').hidden = true;if (!refreshRuns(run.id)) showRun(run);}
  catch (error) {$('#run-storage-error').hidden = false;$('#run-storage-error').textContent = `The AI response was received, but this run could not be saved in this browser. ${error.message} Export the displayed run to keep it. The AI result remains available.`;showRun(run);}
}
function sampleCapture(includeImage) {
  const visit = createVisit();
  Object.assign(visit.areas[0],{name:'Sample front lawn',notes:'Fictional sample job only: supply and install turf over prepared soil. Ask about turf variety and access. No allowance for unmeasured work.',length:'6',width:'5',quantityConfirmed:true});
  if (includeImage) visit.areas[0].photos = [{id:'sample-image',name:'Sample image — routing test only',type:'image/png',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII='}];
  return {visit,catalogue:structuredClone(DEFAULT_CATALOGUE)};
}
function testSnapshot(compare = false) {
  return {edited:structuredClone(read()),baseline:compare ? structuredClone(validateSettings(activeSettings())) : null,sample:structuredClone(sampleCapture($('#test-image').checked))};
}
function modelFor(settings, sample) {return selectScopeModel(settings,sample.visit.areas.some(area => area.photos.length > 0));}
function setTesting(on) {testing = on;for (const id of ['check-settings','test-ai','compare-local','compare-ai']) $('#' + id).disabled = on;$('#test-image').disabled = on;}
function testAction(fn) {
  return action(async () => {if (testing) return;const snapshot = testSnapshot(fn.compare === true);setTesting(true);try {await fn(snapshot);} finally {setTesting(false);}});
}
async function requestSample(settings, sample) {
  try {
    const response = await fetch('/api/quote-builder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'draft',visit:sample.visit,catalogue:sample.catalogue,settings}),signal:AbortSignal.timeout(100000)});
    const result = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result)) return {ok:false,result:null,error:'The AI service returned an incomplete response. No successful scope was available.'};
    rememberRun(result.run);
    const error = typeof result.error === 'string' ? result.error : result.error?.message ?? result.run?.error?.message;
    const ok = response.ok && result.run?.status === 'success' && typeof result.scope === 'string';
    return {ok,result,error:error ?? (response.ok ? 'The AI service returned an incomplete response. No successful scope was available.' : `AI request returned ${response.status}.`)};
  } catch (error) {return {ok:false,result:null,error:['TimeoutError','AbortError'].includes(error.name) ? 'The AI request timed out. Check the connection and try again.' : error.message};}
}
function renderOutcome(parent, title, outcome, settings, sample) {
  const card = node('article',undefined,'comparison-card');card.append(node('h3',title),node('p',`${outcome ? 'Requested model' : 'Configured model'}: ${modelFor(settings,sample)}`,'hint'));
  if (!outcome) {card.append(node('p','Not run. The baseline request failed, so the edited request was not sent.','run-error'));parent.append(card);return;}
  const result = outcome.result,run = result?.run;
  card.append(node('p',outcome.ok ? 'AI request succeeded.' : `AI request failed: ${outcome.error}`,outcome.ok ? 'run-success' : 'run-error'));
  card.append(node('p',`Reported model: ${run?.modelReported ?? 'Not reported'}`,'hint'));
  if (outcome.ok) {
    card.append(node('h4','Scope'),node('p',result.scope ?? run?.output?.scope ?? 'No scope returned.','result-copy'));
    detail(card,'Exclusions',result.exclusions ?? run?.output?.exclusions ?? '');detail(card,'Items',JSON.stringify(result.items ?? run?.output?.items ?? [],null,2));detail(card,'Questions',JSON.stringify(result.questions ?? run?.output?.questions ?? [],null,2),true);
  }
  detail(card,'Exact settings submitted',JSON.stringify(settings,null,2));if (run) detail(card,'Actual run record',JSON.stringify(run,null,2));else card.append(node('p','No server run record was returned.','hint'));parent.append(card);
}
function localSide(parent, title, settings, sample) {
  const card = node('article',undefined,'comparison-card');card.append(node('h3',title),node('p',`Model routing: ${modelFor(settings,sample)}`,'hint'));
  detail(card,'Purpose and working brief',settings.workingBrief,true);detail(card,'Exact system instructions',buildSystemInstructions(settings),true);detail(card,'Full settings',JSON.stringify(settings,null,2));parent.append(card);
}

for (const [id,models] of [['scopeModel',SCOPE_MODELS],['imageModel',SCOPE_MODELS],['transcriptionModel',TRANSCRIPTION_MODELS]]) for (const model of models) {const option = node('option',model.label);option.value = model.id;$('#' + id).append(option);}
try {profiles = loadProfiles();const active = profiles.profiles.find(profile => profile.id === profiles.activeId);fill(active?.settings ?? DEFAULT_SETTINGS);if (active) $('#profile-name').value = active.name;}
catch (error) {notice(`Saved settings could not be read. ${error.message} Import a valid backup or save a new version.`,true);fill(DEFAULT_SETTINGS);}
render();refreshRuns();
form.addEventListener('submit',event => {event.preventDefault();action(() => save(true))();});form.addEventListener('input',updateInstructionPreview);form.addEventListener('change',updateInstructionPreview);$('#workingBrief').addEventListener('input',updateInstructionPreview);
$('#save-version').addEventListener('click',action(() => save(false)));
$('#defaults').addEventListener('click',() => {fill(DEFAULT_SETTINGS);$('#profile-name').value = 'Default settings';notice('Defaults loaded for editing. Activate to use them.');});
$('#load-version').addEventListener('click',action(() => {const profile = selected();fill(profile.settings);$('#profile-name').value = profile.name;notice('Version loaded for editing. Active settings have not changed.');}));
$('#restore-version').addEventListener('click',action(() => {const profile = selected();persist({...profiles,activeId:profile.id});fill(profile.settings);$('#profile-name').value = profile.name;notice('Saved version restored as active in this browser.');}));
$('#delete-version').addEventListener('click',action(() => {const profile = selected();if (profile.id === profiles.activeId) throw new Error('Activate another version before deleting this one.');if (!confirm('Delete this saved settings version? Export settings first if you need to retain it.')) return;persist({...profiles,profiles:profiles.profiles.filter(item => item.id !== profile.id)});notice('Saved version deleted.');}));
$('#check-settings').addEventListener('click',testAction(({edited,sample}) => {$('#test-result').replaceChildren(node('p',`Local settings check passed. No AI request was made. Model routing: ${modelFor(edited,sample)}. Maximum ${edited.maxSteps} steps, ${edited.maxOutputTokens} tokens per step and ${edited.timeoutMs / 1000} seconds per step.`),node('p','This checks settings and instruction assembly. It does not prove that the provider, billing or model is available.','hint'));}));
$('#test-ai').addEventListener('click',testAction(async ({edited,sample}) => {
  if (!edited.draftingEnabled) throw new Error('Enable drafting in the form before running the AI connection test.');
  const panel = $('#test-result');panel.replaceChildren(node('p','Running one real AI request with the captured form settings…','processing'));const outcome = await requestSample(edited,sample);panel.replaceChildren();renderOutcome(panel,'Current form settings',outcome,edited,sample);
}));
const compareLocal = ({baseline,edited,sample}) => {
  const panel = $('#test-result');panel.replaceChildren();const changed = Object.keys(DEFAULT_SETTINGS).filter(key => JSON.stringify(baseline[key]) !== JSON.stringify(edited[key]));
  panel.append(node('p',changed.length ? `Local comparison only. Changed settings: ${changed.join(', ')}.` : 'Local comparison only. The active and edited settings are identical.'),node('p','No AI requests were made. Both sides use the same fictional capture and catalogue. Model responses can vary even with identical instructions and settings.','hint'));
  const columns = node('div',undefined,'comparison-grid');localSide(columns,'Before · active settings',baseline,sample);localSide(columns,'After · current form',edited,sample);panel.append(columns);
};
compareLocal.compare = true;$('#compare-local').addEventListener('click',testAction(compareLocal));
const compareAI = async ({baseline,edited,sample}) => {
  if (!baseline.draftingEnabled || !edited.draftingEnabled) throw new Error('Drafting must be enabled in both active settings and the current form to compare AI responses.');
  const panel = $('#test-result');panel.replaceChildren(node('p','Running the baseline first. The edited request will run only if the baseline succeeds.','processing'));
  const before = await requestSample(baseline,sample),after = before.ok ? await requestSample(edited,sample) : null;
  panel.replaceChildren(node('p','Both requests use the same captured fictional visit and catalogue. Model variation can affect the comparison, even with identical instructions. No visit or active settings were changed.','hint'));
  const columns = node('div',undefined,'comparison-grid');renderOutcome(columns,'Before · active settings',before,baseline,sample);renderOutcome(columns,'After · current form',after,edited,sample);panel.append(columns);
};
compareAI.compare = true;$('#compare-ai').addEventListener('click',testAction(compareAI));
$('#run-select').addEventListener('change',() => showRun(runs.find(run => run.id === $('#run-select').value)));
$('#refresh-runs').addEventListener('click',() => {if (refreshRuns()) $('#run-storage-error').hidden = true;});
$('#export-run').addEventListener('click',action(() => {if (!displayedRun) throw new Error('Choose a run first.');download(JSON.stringify(displayedRun,null,2),`harness-run-${displayedRun.id}.json`);}));
$('#export-settings').addEventListener('click',action(() => {download(JSON.stringify({format:'ls-harness-settings',...profiles},null,2),'harness-settings.json');notice('Saved versions exported. Unsaved form edits are not included.');}));
$('#import-settings').addEventListener('click',() => $('#settings-file').click());
$('#settings-file').addEventListener('change',action(async () => {
  const file = $('#settings-file').files[0];if (!file) return;
  try {if (file.size > 2000000) throw new Error('Settings files must be smaller than 2 MB.');const source = JSON.parse(await file.text());if (source.format !== 'ls-harness-settings') throw new Error('Choose a harness settings export.');const imported = validateProfiles(source);if (profiles.profiles.length && !confirm('Replace saved settings versions in this browser with this file? Export your current settings first to retain them.')) return;persist(imported);fill(profiles.profiles.find(profile => profile.id === profiles.activeId)?.settings ?? DEFAULT_SETTINGS);notice('Settings versions imported.');}
  finally {$('#settings-file').value = '';}
}));
fetch('/api/quote-builder',{cache:'no-store',signal:AbortSignal.timeout(8000)}).then(async response => {if (!response.ok) throw new Error('Connection status unavailable.');const config = await response.json();$('#connection-status').textContent = config.ai?.configured ? 'AI credentials detected. Run a connection test to verify access and billing.' : 'AI connection is not configured yet. You can save profiles; live tests need the server connection and billing setup.';}).catch(() => {$('#connection-status').textContent = 'Connection status unavailable. Local settings remain available.';});
window.addEventListener('storage',event => {if (event.key !== 'ls-quote-harness-profiles-v1') return;try {profiles = loadProfiles();render();notice('Saved versions changed in another tab. Your form edits are retained; load a version before changing it.');} catch (error) {notice(error.message,true);}});
