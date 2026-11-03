export const SCOPE_MODELS = Object.freeze([
  {id:'anthropic/claude-haiku-4.5',label:'Claude Haiku 4.5'},
  {id:'anthropic/claude-sonnet-4.6',label:'Claude Sonnet 4.6'},
]);
export const TRANSCRIPTION_MODELS = Object.freeze([{id:'fish-audio/transcribe-1',label:'Fish Audio Transcribe 1'}]);
export const DEFAULT_SETTINGS = Object.freeze({scopeModel:SCOPE_MODELS[0].id,imageModel:SCOPE_MODELS[0].id,transcriptionModel:TRANSCRIPTION_MODELS[0].id,maxSteps:4,maxOutputTokens:2200,timeoutMs:22000,instructions:'Write concise Australian English. Group the work by area and clearly describe the finish. Ask about missing preparation, access and material choices.',includeImages:true,includeTranscripts:true,draftingEnabled:true,transcriptionEnabled:true});
export const SETTINGS_KEY='ls-quote-harness-profiles-v1';
const fields=Object.keys(DEFAULT_SETTINGS);
export function validateSettings(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid harness settings.');
  if(Object.keys(input).some(key=>!fields.includes(key)))throw new Error('Unknown harness setting.');
  const result={...DEFAULT_SETTINGS,...input};
  for(const key of ['scopeModel','imageModel'])if(!SCOPE_MODELS.some(model=>model.id===result[key]))throw new Error('Choose a supported scope/image model.');
  if(!TRANSCRIPTION_MODELS.some(model=>model.id===result.transcriptionModel))throw new Error('Choose a supported transcription model.');
  for(const [key,min,max] of [['maxSteps',1,4],['maxOutputTokens',256,2200],['timeoutMs',5000,22000]])if(!Number.isInteger(result[key])||result[key]<min||result[key]>max)throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  if(typeof result.instructions!=='string'||result.instructions.length>4000)throw new Error('Instructions must be text, up to 4,000 characters.');
  for(const key of ['includeImages','includeTranscripts','draftingEnabled','transcriptionEnabled'])if(typeof result[key]!=='boolean')throw new Error(`Invalid ${key} setting.`);
  return result;
}
export function selectScopeModel(settings,hasImages){const checked=validateSettings(settings);return hasImages&&checked.includeImages?checked.imageModel:checked.scopeModel;}
export function emptyProfiles(){return {version:1,activeId:null,profiles:[]};}
export function validateProfiles(input){
  if(!input||input.version!==1||!Array.isArray(input.profiles)||input.profiles.length>30)throw new Error('Invalid settings profile file.');
  const ids=new Set();
  const profiles=input.profiles.map(profile=>{
    if(!profile||typeof profile.id!=='string'||!profile.id||profile.id.length>100||ids.has(profile.id)||typeof profile.name!=='string'||!profile.name.trim()||profile.name.length>80||typeof profile.createdAt!=='string'||!Number.isFinite(Date.parse(profile.createdAt)))throw new Error('Invalid settings profile.');
    ids.add(profile.id);return {id:profile.id,name:profile.name,createdAt:profile.createdAt,settings:validateSettings(profile.settings)};
  });
  if(input.activeId!==null&&!ids.has(input.activeId))throw new Error('The active settings profile is missing.');
  return {version:1,activeId:input.activeId,profiles};
}
export function loadProfiles(storage=globalThis.localStorage){const raw=storage.getItem(SETTINGS_KEY);return raw?validateProfiles(JSON.parse(raw)):emptyProfiles();}
export function storeProfiles(profiles,storage=globalThis.localStorage){const valid=validateProfiles(profiles);storage.setItem(SETTINGS_KEY,JSON.stringify(valid));return valid;}
export function activeSettings(storage=globalThis.localStorage){const profiles=loadProfiles(storage);return profiles.profiles.find(profile=>profile.id===profiles.activeId)?.settings??{...DEFAULT_SETTINGS};}
