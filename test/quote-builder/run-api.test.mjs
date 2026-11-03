import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/quote-builder.js';
import {createVisit,DEFAULT_CATALOGUE} from '../../tools/quote-builder/domain.mjs';
import {DEFAULT_SETTINGS} from '../../tools/quote-builder/settings.mjs';
import {buildSystemInstructions} from '../../tools/quote-builder/instructions.mjs';
function response(){return {code:200,setHeader(){},status(code){this.code=code;return this;},json(value){this.data=value;return this;}};}
test('API returns an inspectable run for provider rejection, without credential contents',async()=>{
 const originalFetch=globalThis.fetch,oldKey=process.env.AI_GATEWAY_API_KEY,oldDirect=process.env.ANTHROPIC_API_KEY;process.env.AI_GATEWAY_API_KEY='TEST-KEY-DO-NOT-RETURN';delete process.env.ANTHROPIC_API_KEY;
 globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({error:{message:'A credit card is required.'}})});
 try{const res=response();await handler({method:'POST',headers:{host:'localhost','x-real-ip':'run-api-error'},body:{action:'draft',visit:createVisit(),catalogue:DEFAULT_CATALOGUE,settings:DEFAULT_SETTINGS}},res);
 assert.equal(res.code,503);assert.equal(res.data.run.status,'error');assert.equal(res.data.run.modelReported,null);assert.equal(res.data.run.output,null);assert.equal(res.data.run.systemInstructions,buildSystemInstructions(DEFAULT_SETTINGS));assert.equal(res.data.run.steps.length,1);assert.doesNotMatch(JSON.stringify(res.data),/TEST-KEY-DO-NOT-RETURN/);
 }finally{globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=oldKey;if(oldDirect===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldDirect;}
});
