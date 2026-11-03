import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/quote-builder.js';
import {DEFAULT_CATALOGUE} from '../../tools/quote-builder/domain.mjs';
function response(){const out={headers:{}};const res={setHeader(k,v){out.headers[k]=v},status(n){out.status=n;return res},json(body){out.body=body;return res},send(body){out.body=body;return res},end(body){out.body=body;return res}};return {out,res};}
function request(body,extra={}){return {method:'POST',headers:{host:'localhost:4173',origin:'http://localhost:4173'},body,...extra};}
test('configuration exposes sample services but never credentials',async()=>{const {out,res}=response();await handler(request(null,{method:'GET'}),res);assert.equal(out.status,200);assert.ok(out.body.catalogue.length>=4);assert.equal(out.headers['Cache-Control'],'no-store');assert.doesNotMatch(JSON.stringify(out.body),/VERCEL_OIDC_TOKEN|ANTHROPIC_API_KEY/)});
test('calculator returns exact server-derived totals',async()=>{const {out,res}=response();await handler(request({action:'calculate',quote:{catalogue:DEFAULT_CATALOGUE,items:[{serviceId:'turf',quantity:30}],issueDate:'2026-11-03',taxRateBps:1000,totalCents:1}}),res);assert.equal(out.status,200);assert.equal(out.body.totalCents,115500)});
test('rejects unexpected origins and invalid actions',async()=>{let r=response();await handler(request({action:'calculate'},{headers:{host:'localhost:4173',origin:'https://unrelated.example'}}),r.res);assert.equal(r.out.status,403);r=response();await handler(request({action:'delete-all'}),r.res);assert.equal(r.out.status,400)});
test('rejects oversized and malformed audio before model processing',async()=>{const {out,res}=response();await handler(request({action:'transcribe',audio:{dataUrl:'data:text/html;base64,AAAA'}}),res);assert.equal(out.status,400);assert.match(out.body.error,/audio/i)});
