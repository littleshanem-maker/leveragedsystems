export const RUNS_KEY='ls-quote-harness-runs-v1';
export function validateRun(run){
  if(!run||typeof run!=='object'||!['success','error'].includes(run.status)||typeof run.id!=='string'||run.id.length>100)throw new Error('Invalid harness run record.');
  for(const key of ['startedAt','finishedAt'])if(typeof run[key]!=='string'||!Number.isFinite(Date.parse(run[key])))throw new Error('Invalid run date.');
  for(const [key,max] of [['systemInstructions',16000],['requestText',30000],['modelRequested',200]])if(typeof run[key]!=='string'||run[key].length>max)throw new Error('Invalid run instructions or model.');
  if(!Array.isArray(run.trace)||run.trace.length>100||!Array.isArray(run.tools)||run.tools.length>4||!Array.isArray(run.imageSummary)||run.imageSummary.length>6||!Number.isFinite(run.elapsedMs)||run.elapsedMs<0)throw new Error('Invalid run activity.');
  if(JSON.stringify(run).length>500000)throw new Error('Run record is too large to retain.');
  return run;
}
export function loadRuns(storage=globalThis.localStorage){const raw=storage.getItem(RUNS_KEY);if(!raw)return [];const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.runs)||data.runs.length>20)throw new Error('Invalid saved run history.');return data.runs.map(validateRun);}
export function saveRun(run,storage=globalThis.localStorage){
  validateRun(run);const runs=[structuredClone(run),...loadRuns(storage).filter(item=>item.id!==run.id)].slice(0,20);
  while(runs.length>1&&JSON.stringify(runs).length>1500000)runs.pop();
  storage.setItem(RUNS_KEY,JSON.stringify({version:1,runs}));return runs;
}
