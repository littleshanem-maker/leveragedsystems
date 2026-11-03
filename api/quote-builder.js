import {validateSettings,DEFAULT_SETTINGS,SCOPE_MODELS,TRANSCRIPTION_MODELS} from '../tools/quote-builder/settings.mjs';
import {createGateway} from '@ai-sdk/gateway';
import {experimental_transcribe as transcribe} from 'ai';
import {DEFAULT_CATALOGUE,calculateQuote} from '../tools/quote-builder/domain.mjs';
import {LIMITS,DEFAULT_MODEL,DEFAULT_TRANSCRIPTION_MODEL,HarnessError,readDataUrl,runQuoteHarness,callGatewayModel,providerError} from '../lib/quote-builder/harness.mjs';

const requestWindows=new Map();
function checkRate(req){const now=Date.now(),key=String(req.headers?.['x-real-ip']||req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,80);let window=requestWindows.get(key);if(!window||now-window.start>60000){window={start:now,count:0};requestWindows.set(key,window);}if(++window.count>12)throw new HarnessError('Please wait a minute before processing more AI requests. Your visit remains saved.','REQUEST_LIMIT',429);if(requestWindows.size>1000)requestWindows.delete(requestWindows.keys().next().value);}
async function bodyOf(req){const supplied=req.body;if(supplied!==undefined){if(Buffer.byteLength(typeof supplied==='string'?supplied:JSON.stringify(supplied))>LIMITS.maxBodyBytes)throw new HarnessError('The request is too large. Use smaller images or shorter recordings.','FILE_TOO_LARGE',413);return typeof supplied==='string'?JSON.parse(supplied):supplied;}const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>LIMITS.maxBodyBytes)throw new HarnessError('The request is too large. Use smaller images or shorter recordings.','FILE_TOO_LARGE',413);chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function checkOrigin(req){const origin=req.headers?.origin;if(!origin)return;let allowed=false;try{const url=new URL(origin);allowed=['http:','https:'].includes(url.protocol)&&url.host===req.headers.host;}catch{}if(!allowed)throw new HarnessError('This request must come from the quote builder on this website.','ORIGIN_REJECTED',403);}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Robots-Tag','noindex, nofollow');
  try{
    if(req.method==='GET'){
      const token=process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN;
      return res.status(200).json({version:1,catalogue:DEFAULT_CATALOGUE,ai:{configured:!!(token||process.env.ANTHROPIC_API_KEY),model:process.env.QUOTE_AI_MODEL||DEFAULT_MODEL,transcriptionConfigured:!!token,transcriptionModel:process.env.QUOTE_TRANSCRIPTION_MODEL||DEFAULT_TRANSCRIPTION_MODEL},limits:LIMITS,settings:{defaults:DEFAULT_SETTINGS,scopeModels:SCOPE_MODELS,transcriptionModels:TRANSCRIPTION_MODELS}});
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed.'});}
    checkOrigin(req);const body=await bodyOf(req);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid request.');
    if(body.action==='calculate')return res.status(200).json(calculateQuote(body.quote));
    if(body.action==='pdf'){
      const quote=calculateQuote(body.quote),{renderQuotePdf}=await import('../lib/quote-builder/pdf.mjs'),bytes=await renderQuotePdf(quote);
      const name=quote.reference.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,60)||'quote';
      res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${name}${quote.isDraft?'-draft':''}.pdf"`);
      return res.status(200).send(Buffer.from(bytes));
    }
    if(body.action==='draft'){
      checkRate(req);let model=process.env.QUOTE_AI_MODEL||DEFAULT_MODEL;
      const result=await runQuoteHarness(body.visit,body.catalogue??body.visit?.catalogue??DEFAULT_CATALOGUE,{settings:validateSettings(body.settings??{}),callModel:async payload=>{if(body.settings===undefined)delete payload.model;const response=await callGatewayModel(payload);model=response.model||model;return response;}});
      return res.status(200).json({...result,model});
    }
    if(body.action==='transcribe'){
      const settings=validateSettings(body.settings??{});if(!settings.transcriptionEnabled)throw new HarnessError('Transcription is disabled in this settings profile.','AI_DISABLED',400);
      const audio=readDataUrl(body.audio?.dataUrl,LIMITS.maxAudioBytes,'Audio');checkRate(req);
      const token=process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN;if(!token)throw new HarnessError('Voice transcription is not connected yet. The original recording is saved; add or edit its transcript manually.','AI_NOT_CONFIGURED',503);
      const model=body.settings?settings.transcriptionModel:(process.env.QUOTE_TRANSCRIPTION_MODEL||DEFAULT_TRANSCRIPTION_MODEL);
      try{
        const gateway=createGateway({apiKey:token});
        const result=await transcribe({model:gateway.transcriptionModel(model),audio:audio.bytes,maxRetries:0,abortSignal:AbortSignal.timeout(45000)});
        if(!result.text?.trim())throw new HarnessError('No speech was recognised. The original recording is retained; try a clearer clip or type a note.','EMPTY_TRANSCRIPT',422);
        return res.status(200).json({transcript:result.text.trim().slice(0,16000),model,trace:[{event:'transcription',detail:'Transcribed the selected recording; original audio retained on this device.'}]});
      }catch(error){if(error instanceof HarnessError)throw error;let data={};try{data=JSON.parse(error.responseBody||error.cause?.responseBody||'{}');}catch{}if(!data.error)data={error:{message:error.message||''}};throw providerError(error.statusCode||error.cause?.statusCode||502,data);}
    }
    throw new Error('Unknown quote-builder action.');
  }catch(error){const status=error instanceof HarnessError?error.status:400;return res.status(status).json({error:error.message||'Unable to process the quote.',code:error.code||'INVALID_INPUT'});}
}
