import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/quote-builder.js';
async function request(body,ip='boundary-test'){const response={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',headers:{host:'localhost','x-real-ip':ip},body},response);return response;}
test('rejects an aggregate request body over 4 MB',async()=>{const response=await request({action:'draft',padding:'x'.repeat(4000000)});assert.equal(response.code,413);});
test('thirteenth AI request is throttled even when validation fails before the provider',async()=>{const ip='throttle-'+crypto.randomUUID();for(let i=0;i<12;i++)assert.equal((await request({action:'draft',visit:null},ip)).code,400);assert.equal((await request({action:'draft',visit:null},ip)).code,429);});
test('settings validation and disabled transcription stop before provider processing',async()=>{assert.equal((await request({action:'draft',settings:{maxSteps:5}})).code,400);const disabled=await request({action:'transcribe',settings:{transcriptionEnabled:false}});assert.equal(disabled.code,400);assert.equal(disabled.data.code,'AI_DISABLED');});
