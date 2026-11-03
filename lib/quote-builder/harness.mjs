import {buildSystemInstructions,buildEvidenceRequest,TOOL_DEFINITIONS} from '../../tools/quote-builder/instructions.mjs';
import {validateSettings,selectScopeModel} from '../../tools/quote-builder/settings.mjs';
import { validateCatalogue, deriveMeasurements } from '../../tools/quote-builder/domain.mjs';

export const LIMITS=Object.freeze({maxAudioBytes:2500000,maxImageBytes:300000,maxImages:6,maxInputChars:24000,maxSteps:4,maxBodyBytes:4000000});
export const DEFAULT_MODEL='anthropic/claude-haiku-4.5';
export const DEFAULT_TRANSCRIPTION_MODEL='fish-audio/transcribe-1';
export class HarnessError extends Error {constructor(message,code='AI_UNAVAILABLE',status=502){super(message);this.code=code;this.status=status;}}
const short=(value,max=4000)=>{if(value==null)return '';if(typeof value!=='string'||value.length>max)throw new Error('A visit field is too long or is not text.');return value.trim();};
export function readDataUrl(dataUrl,maxBytes,kind){
  if(typeof dataUrl!=='string'||dataUrl.length>Math.ceil(maxBytes*4/3)+200)throw new Error(`${kind} exceeds the file size limit.`);
  const comma=dataUrl.indexOf(','),head=dataUrl.slice(0,comma),data=dataUrl.slice(comma+1),type=head.slice(5).split(';')[0].toLowerCase();
  const allowed=kind==='Image'?['image/jpeg','image/png','image/webp']:['audio/webm','audio/mp4','audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/aac','audio/flac'];
  if(comma<0||!head.startsWith('data:')||!head.endsWith(';base64')||!allowed.includes(type)||!data||data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new Error(`Unsupported or invalid ${kind.toLowerCase()} file.`);
  const bytes=Buffer.from(data,'base64');if(!bytes.length||bytes.length>maxBytes)throw new Error(`${kind} exceeds the file size limit.`);
  return {data,type,bytes};
}
export function buildVisitContext(visit,settingsInput={}){
  const settings=validateSettings(settingsInput);
  if(!visit||typeof visit!=='object'||!Array.isArray(visit.areas)||!visit.areas.length||visit.areas.length>20)throw new Error('A visit must contain 1–20 work areas.');
  const images=[];
  const areas=visit.areas.map(area=>{
    if(!area||typeof area!=='object')throw new Error('Invalid work area.');
    const transcripts=(settings.includeTranscripts&&Array.isArray(area.recordings)?area.recordings:[]).map(r=>short(r?.transcript,8000)).filter(Boolean);
    const pictures=[...(Array.isArray(area.photos)?area.photos:[]),...(area.sketch?.dataUrl?[{dataUrl:area.sketch.dataUrl,name:'Site sketch'}]:[])];
    for(const picture of settings.includeImages?pictures:[]){if(images.length>=LIMITS.maxImages)throw new Error(`Use at most ${LIMITS.maxImages} photos/sketches per scope request.`);const parsed=readDataUrl(picture.dataUrl,LIMITS.maxImageBytes,'Image');images.push({areaId:short(area.id,80),name:short(picture.name,160),type:parsed.type,data:parsed.data});}
    const cleanDimension=value=>value==null||value===''?'':short(String(value),30);
    return {id:short(area.id,80),name:short(area.name,120),jobType:short(area.jobType,40),notes:short(area.notes,8000),transcripts,access:short(area.access,2000),materials:short(area.materials,2000),disposal:short(area.disposal,2000),measurements:{length:cleanDimension(area.length),width:cleanDimension(area.width),depthMm:cleanDimension(area.depthMm),...deriveMeasurements(area),confirmed:area.quantityConfirmed===true}};
  });
  if(areas.some(a=>!a.id)||new Set(areas.map(a=>a.id)).size!==areas.length)throw new Error('Work areas need unique IDs.');
  const text=JSON.stringify({areas});if(text.length>LIMITS.maxInputChars)throw new Error('Visit input exceeds the text limit. Split the work into smaller visits.');
  return {text,images,areaIds:new Set(areas.map(a=>a.id))};
}

function validateProposal(input,catalogue,areaIds){
  if(!input||typeof input!=='object')throw new Error('The scope proposal is invalid.');
  const scope=short(input.scope,12000),exclusions=short(input.exclusions,6000);
  if(!scope)throw new Error('A scope description is required.');
  if(!Array.isArray(input.items)||input.items.length>60||!Array.isArray(input.questions)||input.questions.length>20)throw new Error('The scope proposal has too many items or missing fields.');
  const services=new Set(catalogue.map(s=>s.id));
  const items=input.items.map(item=>{if(!item||!services.has(item.serviceId))throw new Error('Use a valid service from the catalogue.');if(!areaIds.has(item.areaId))throw new Error('Use a valid work area ID.');const q=String(item.quantity??'').trim();if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(q)||Number(q)<=0||Number(q)>1000000)throw new Error('Each proposed quantity must be positive with at most two decimals.');return {serviceId:item.serviceId,quantity:Number(q),description:short(item.description,800),areaId:item.areaId};});
  return {scope,exclusions,items,questions:input.questions.map(q=>short(q,1000)).filter(Boolean)};
}
export async function runQuoteHarness(visit,catalogueInput,{callModel,settings:settingsInput={},modelOverride}={}){
  const settings=validateSettings(settingsInput);
  if(!settings.draftingEnabled)throw new HarnessError('AI scope drafting is disabled in this settings profile.','AI_DISABLED',400);
  if(typeof callModel!=='function')throw new HarnessError('The AI connection is not configured. Use the manual scope and pricing fields.','AI_NOT_CONFIGURED',503);
  const catalogue=validateCatalogue(catalogueInput),context=buildVisitContext(visit,settings);
  const selectedModel=modelOverride||selectScopeModel(settings,context.images.length>0);
  const system=buildSystemInstructions(settings),requestText=buildEvidenceRequest(context.text);
  const trace=[{event:'context',detail:`Prepared ${visit.areas.length} work area(s) and ${context.images.length} image(s).`}];
  const content=[{type:'text',text:requestText}];
  for(const image of context.images)content.push({type:'text',text:`Image evidence for area ${image.areaId}: ${image.name}`},{type:'image',source:{type:'base64',media_type:image.type,data:image.data}});
  const messages=[{role:'user',content}],usage={input_tokens:0,output_tokens:0};
  const started=Date.now();
  const run={id:crypto.randomUUID(),startedAt:new Date(started).toISOString(),finishedAt:'',elapsedMs:0,status:'error',modelRequested:selectedModel,modelReported:null,systemInstructions:system,requestText,imageSummary:context.images.map(({areaId,name,type})=>({areaId,name,type})),tools:structuredClone(TOOL_DEFINITIONS),settings:structuredClone(settings),steps:[],trace,usage,output:null,error:null};
  const finish=()=>{run.finishedAt=new Date().toISOString();run.elapsedMs=Math.max(0,Date.now()-started);return structuredClone(run);};
  let loaded=false;
  try{
    for(let step=0;step<settings.maxSteps;step++){
      trace.push({event:'model',detail:`Requested ${selectedModel}, step ${step+1} of ${settings.maxSteps}.`});
      const stepRecord={index:step+1,modelRequested:selectedModel,maxOutputTokens:settings.maxOutputTokens,timeoutMs:settings.timeoutMs,toolCalls:[],toolResults:[]};run.steps.push(stepRecord);
      const response=await callModel({system,messages,tools:TOOL_DEFINITIONS,max_tokens:settings.maxOutputTokens,model:selectedModel,requestTimeoutMs:settings.timeoutMs});
      run.modelReported=typeof response.reportedModel==='string'?response.reportedModel:null;
      usage.input_tokens+=Number(response.usage?.input_tokens)||0;usage.output_tokens+=Number(response.usage?.output_tokens)||0;
      if(!Array.isArray(response.content)||!response.content.length)throw new HarnessError('The model returned an empty response. Your visit has not been changed.');
      const calls=response.content.filter(c=>c.type==='tool_use');
      stepRecord.toolCalls=calls.map(call=>({id:String(call.id).slice(0,100),name:String(call.name).slice(0,100),input:JSON.stringify(call.input??{}).slice(0,12000),inputTruncated:JSON.stringify(call.input??{}).length>12000}));
      if(calls.length>4)throw new HarnessError('The model requested too many tool actions. Your visit has not been changed.','AI_LIMIT',502);
      if(!calls.length){messages.push({role:'assistant',content:response.content},{role:'user',content:'Submit a scope using prepare_scope; put any missing information in questions. Read get_services first.'});continue;}
      messages.push({role:'assistant',content:response.content});const results=[];let proposal=null;
      for(const call of calls){
        try{
          if(call.name==='get_services'){loaded=true;results.push({type:'tool_result',tool_use_id:call.id,content:JSON.stringify(catalogue)});trace.push({event:'tool',detail:'Read the approved service catalogue.'});}
          else if(call.name==='prepare_scope'){if(!loaded)throw new Error('Read get_services before proposing items.');proposal=validateProposal(call.input,catalogue,context.areaIds);trace.push({event:'tool',detail:`Validated a proposed scope with ${proposal.items.length} item(s) and ${proposal.questions.length} question(s).`});results.push({type:'tool_result',tool_use_id:call.id,content:'Scope proposal validated for human review.'});}
          else throw new Error('That tool is not permitted.');
        }catch(error){trace.push({event:'check',detail:`Rejected tool ${String(call.name).slice(0,80)}: ${error.message}`});results.push({type:'tool_result',tool_use_id:call.id,is_error:true,content:error.message});}
      }
      stepRecord.toolResults=results.map(result=>({toolUseId:result.tool_use_id,isError:result.is_error===true,content:result.content.slice(0,8000),truncated:result.content.length>8000}));
      if(proposal){run.status='success';run.output=proposal;return {...proposal,trace,usage,run:finish()};}
      messages.push({role:'user',content:results});
    }
    throw new HarnessError('The agent reached its step limit without a valid scope. Your original visit is saved; edit the scope manually or try a smaller request.','AI_LIMIT',502);
  }catch(error){
    const failure=error instanceof HarnessError?error:new HarnessError('The scope request could not complete. Your visit has not been changed.');
    run.error={code:failure.code,message:failure.message};trace.push({event:'error',detail:failure.message});failure.run=finish();throw failure;
  }
}

export function providerError(status,data){const message=typeof data?.error?.message==='string'?data.error.message:typeof data?.error==='string'?data.error:'';if(status===402||/credit card|billing|insufficient.*credit|payment method/i.test(message))return new HarnessError('AI Gateway needs billing verification in the Vercel account before drafting or transcription can run. Your visit remains available for manual quoting.','AI_BILLING_REQUIRED',503);if([401,403].includes(status))return new HarnessError('The AI connection is not authorised. Check the model service configuration in Vercel.','AI_AUTH_REQUIRED',503);if(status===429)return new HarnessError('The AI service is busy or its usage limit has been reached. Try again later; your visit remains saved.','AI_RATE_LIMIT',429);return new HarnessError('The AI service could not complete this request. Your visit has not been changed. Try again later or continue manually.');}
export async function callGatewayModel(payload,env=process.env){const token=env.AI_GATEWAY_API_KEY||env.VERCEL_OIDC_TOKEN;const direct=env.ANTHROPIC_API_KEY;if(!token&&!direct)throw new HarnessError('AI drafting is not connected yet. Use the manual scope and pricing fields.','AI_NOT_CONFIGURED',503);const url=direct?'https://api.anthropic.com/v1/messages':'https://ai-gateway.vercel.sh/v1/messages';const selected=payload.model||env.QUOTE_AI_MODEL||DEFAULT_MODEL;const model=direct?({'anthropic/claude-haiku-4.5':'claude-haiku-4-5','anthropic/claude-sonnet-4.6':'claude-sonnet-4-6'}[selected]||selected):selected;const {requestTimeoutMs=22000,...request}=payload;let response;try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01',...(direct?{'x-api-key':direct}:{Authorization:`Bearer ${token}`})},body:JSON.stringify({...request,model}),signal:AbortSignal.timeout(requestTimeoutMs)});}catch{throw new HarnessError('The AI request timed out or lost connection. Your visit has not been changed.','AI_TIMEOUT',504);}const data=await response.json().catch(()=>({}));if(!response.ok)throw providerError(response.status,data);return {...data,model,reportedModel:typeof data.model==='string'?data.model:null};}
