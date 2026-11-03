export const DEFAULT_CATALOGUE = Object.freeze([
  {id:'turf',name:'Turf supply and installation',unit:'m²',rateCents:3500},
  {id:'soil',name:'Soil supply',unit:'m³',rateCents:9500},
  {id:'mulch',name:'Mulch supply and placement',unit:'m³',rateCents:14000},
  {id:'concrete',name:'Concrete supply only — sample rate',unit:'m³',rateCents:35000},
  {id:'plant',name:'Plant supply and planting',unit:'plant',rateCents:4500},
  {id:'labour',name:'Landscaping labour',unit:'hour',rateCents:8500},
  {id:'equipment',name:'Equipment allowance',unit:'job',rateCents:15000},
  {id:'disposal',name:'Green waste removal',unit:'load',rateCents:18000},
].map(item=>Object.freeze(item)));

function text(value,max=1000){if(value==null)return '';if(typeof value!=='string')throw new Error('Text fields must contain text.');if(value.length>max)throw new Error(`Text is limited to ${max} characters.`);return value.trim();}
function integer(value,min,max,label){if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Invalid ${label}.`);return value;}
function quantityHundredths(value){const s=String(value??'').trim();if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s))throw new Error('Enter a positive quantity with at most two decimal places.');const [whole,fraction='']=s.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(n<=0||n>100000000)throw new Error('Quantity must be greater than zero and no more than 1,000,000.');return n;}
function dateOnly(value){const s=text(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error('Enter a valid quote date.');const d=new Date(`${s}T00:00:00Z`);if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw new Error('Enter a valid quote date.');return d;}
function party(value={}){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid customer or business details.');return {name:text(value.name,160),address:text(value.address,400),email:text(value.email,254),phone:text(value.phone,50),abn:text(value.abn,50)};}
export function validateCatalogue(input){if(!Array.isArray(input)||!input.length||input.length>60)throw new Error('The service catalogue must contain 1–60 services.');const seen=new Set();return input.map(service=>{if(!service||typeof service!=='object')throw new Error('Invalid catalogue service.');const id=text(service.id,60),name=text(service.name,160),unit=text(service.unit,24);if(!/^[a-zA-Z0-9_-]+$/.test(id)||seen.has(id)||!name||!unit)throw new Error('Catalogue service IDs must be unique; names and units are required.');seen.add(id);return {id,name,unit,rateCents:integer(service.rateCents,0,100000000,'service rate in cents')};});}
export function calculateQuote(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('A quote is required.');
  const catalogue=validateCatalogue(input.catalogue??DEFAULT_CATALOGUE),byId=new Map(catalogue.map(s=>[s.id,s]));
  if(!Array.isArray(input.items)||input.items.length===0||input.items.length>60)throw new Error('Add between 1 and 60 quote items.');
  const warnings=[];let subtotal=0n;
  const items=input.items.map((line,index)=>{
    if(!line||typeof line!=='object')throw new Error('Invalid quote item.');
    const service=byId.get(line.serviceId);if(!service)throw new Error('A quote item refers to an unknown service.');
    const hundredths=quantityHundredths(line.quantity),lineTotal=(BigInt(hundredths)*BigInt(service.rateCents)+50n)/100n;
    subtotal+=lineTotal;
    if(subtotal>9000000000000n)throw new Error('Quote total exceeds the supported limit.');
    return {id:text(line.id,80)||`item-${index+1}`,serviceId:service.id,name:service.name,description:text(line.description,800)||service.name,unit:service.unit,quantity:hundredths/100,rateCents:service.rateCents,lineTotalCents:Number(lineTotal),confirmed:line.confirmed===true,areaId:text(line.areaId,80)};
  });
  const customer=party(input.customer),business=party(input.business),scope=text(input.scope,12000),exclusions=text(input.exclusions,6000);
  const issue=dateOnly(input.issueDate),validDays=integer(Number(input.validDays??30),1,180,'quote validity');
  const until=new Date(issue);until.setUTCDate(until.getUTCDate()+validDays);
  const taxRateBps=input.taxRateBps??0;if(![0,1000].includes(taxRateBps))throw new Error('GST must be off or 10%.');
  const tax=(subtotal*BigInt(taxRateBps)+5000n)/10000n;
  if(!customer.name)warnings.push('Customer name is missing.');
  if(!customer.address)warnings.push('Property address is missing.');
  if(!business.name)warnings.push('Business name is missing.');
  if(!scope)warnings.push('Scope of work is missing.');
  if(items.some(line=>!line.confirmed))warnings.push('Confirm the quantities for every quote item.');
  if(input.scopeConfirmed!==true)warnings.push('Review and confirm the scope and exclusions.');
  if(input.ratesConfirmed!==true)warnings.push('Review and confirm the rates; the starting catalogue uses sample prices.');
  if(Array.isArray(input.questions)&&input.questions.some(q=>typeof q==='string'&&q.trim()))warnings.push('Resolve the outstanding scope questions before finalising.');
  return {customer,business,reference:text(input.reference,60)||'DRAFT',issueDate:issue.toISOString().slice(0,10),validUntil:until.toISOString().slice(0,10),validDays,scope,exclusions,items,subtotalCents:Number(subtotal),taxCents:Number(tax),totalCents:Number(subtotal+tax),taxRateBps,warnings,isDraft:warnings.length>0};
}
export function deriveMeasurements(area={}){const positive=v=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=1000000?Number(v):null;const length=positive(area.length),width=positive(area.width),depth=positive(area.depthMm);const a=length!==null&&width!==null?Math.round(length*width*10000)/10000:null;return {areaM2:a,volumeM3:a!==null&&depth!==null?Math.round(a*depth/1000*1000000)/1000000:null};}
const moneyFormatter=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'});
export const formatMoney=cents=>moneyFormatter.format(cents/100);
export function createVisit(){const now=new Date(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));const date=`${parts.year}-${parts.month}-${parts.day}`,id=crypto.randomUUID();return {version:1,id,createdAt:now.toISOString(),updatedAt:now.toISOString(),customer:{name:'',address:'',email:'',phone:''},business:{name:'',email:'',phone:'',abn:''},areas:[{id:crypto.randomUUID(),name:'Front garden',jobType:'turf',notes:'',length:'',width:'',depthMm:'',quantityConfirmed:false,access:'',materials:'',disposal:'',photos:[],recordings:[],sketch:null}],catalogue:DEFAULT_CATALOGUE.map(item=>({...item})),quote:{reference:`LS-${date.replaceAll('-','')}-${id.slice(0,4).toUpperCase()}`,issueDate:date,validDays:30,scope:'',exclusions:'',items:[],taxRateBps:0,scopeConfirmed:false,ratesConfirmed:false,questions:[]},activity:[]};}
