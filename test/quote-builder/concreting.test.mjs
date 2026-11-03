import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisit,deriveMeasurements,calculateQuote} from '../../tools/quote-builder/domain.mjs';
import {makeBackup,parseBackup} from '../../tools/quote-builder/storage.mjs';
test('concreting retains its job type through backup and prices measured concrete volume',()=>{
 const visit=createVisit(),area=visit.areas[0];area.jobType='concreting';area.length='6';area.width='5';area.depthMm='100';
 assert.equal(deriveMeasurements(area).volumeM3,3);
 assert.equal(parseBackup(JSON.stringify(makeBackup([visit])))[0].areas[0].jobType,'concreting');
 const concrete=visit.catalogue.find(s=>s.id==='concrete');assert.ok(concrete);assert.equal(concrete.unit,'m³');
 const quote=calculateQuote({...visit.quote,customer:visit.customer,business:visit.business,catalogue:visit.catalogue,items:[{id:'concrete-line',serviceId:'concrete',quantity:3,description:'Concrete supply only',confirmed:false}],taxRateBps:1000});
 assert.equal(quote.subtotalCents,3*concrete.rateCents);assert.equal(quote.totalCents,Math.round(3*concrete.rateCents*1.1));assert.equal(quote.isDraft,true);
});
