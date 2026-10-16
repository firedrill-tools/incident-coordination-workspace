/** Pinned imported source and exclusive private model-free workspace authority. */
import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,lstatSync,existsSync,mkdirSync} from 'node:fs';
import {dirname,resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {validateState,canonical,hash,identifier,revision,type State} from './schema.js';
import {parseJSON} from './json.js';
import {DATASET_SHA256} from './_dataset-manifest.js';
const historySchema=z.strictObject({sequence:revision,at:z.string(),kind:z.literal('fictional_imported_incident_audit'),target:identifier,outcome:z.enum(['pending','approved','rejected','healthy','degraded']),source_audit_sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const provenanceSchema=z.strictObject({kind:z.literal('fictional_imported_incident_snapshot'),prior_model_evidence:z.null(),prior_human_authentication:z.null(),prior_slack_delivery:z.null()});
const populationSchema=z.strictObject({id:identifier,profile:z.enum(['starter','busy','ambiguous','boundary']),task:z.string().min(1).max(8000),state:z.unknown(),history:z.array(historySchema).max(5000),provenance:provenanceSchema});
const metadataSchema=z.strictObject({schema_version:z.literal(1),instance_id:z.string().uuid(),case_id:identifier,dataset_sha256:z.literal(DATASET_SHA256),seed_state_sha256:z.string().regex(/^[a-f0-9]{64}$/),created_at:z.string(),scope:z.literal('original_imported_seed_snapshot')});
export function readRegular(file:string,limit=8*1024*1024){
 const before=lstatSync(file);if(!before.isFile()||before.isSymbolicLink()||before.size>limit)throw new Error('bounded regular source required');
 const bytes=readFileSync(file),after=lstatSync(file);
 if(bytes.length>limit||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size)throw new Error('source changed while reading');
 return bytes;
}
function json(file:string,limit?:number){return parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(readRegular(file,limit)));}
export function validatePopulation(value:unknown){
 const p=populationSchema.parse(value),state=validateState(p.state);
 if(state.instance_id||state.dataset)throw new Error('imported seed must not claim a private runtime instance');
 if(p.history.length!==state.audit.length)throw new Error('imported history population differs from source audit');
 let previous='';
 for(const [n,item]of p.history.entries()){
  const time=new Date(item.at);if(!Number.isFinite(time.valueOf())||time.toISOString()!==item.at||item.at<previous||item.sequence!==n+1)throw new Error('imported chronology is not ordered and exact');
  previous=item.at;const audit=state.audit[n];
  if(item.target!==audit.target||item.outcome!==audit.outcome||item.source_audit_sha256!==hash(canonical(audit)))throw new Error('imported history differs from original audit');
 }
 return {...p,state};
}
type Population=ReturnType<typeof validatePopulation>;
let cached:Population[]|undefined;
function registry(){
 const file=fileURLToPath(new URL('../../data/index.json',import.meta.url)),raw=readRegular(file);
 if(hash(raw)!==DATASET_SHA256)throw new Error('population index differs from pinned original bytes');
 if(!cached){
  const index=z.strictObject({id:z.literal('incident-populations'),version:z.literal('1.0.0'),cases:z.array(z.unknown()).min(1).max(32)}).parse(parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
  const rows=index.cases.map(validatePopulation);
  if(new Set(rows.map(p=>p.id)).size!==rows.length||new Set(rows.map(p=>p.profile)).size!==4)throw new Error('duplicate case or missing profile');
  cached=rows;
 }
 return cached;
}
export function populations(){return structuredClone(registry());}
function population(id:string){const p=registry().find(p=>p.id===id);if(!p)throw new Error('unknown incident case');return p;}
export function listCases(){return registry().map(p=>({id:p.id,profile:p.profile,task:p.task,proposals:p.state.proposals.length,updates:p.state.updates.length,observations:p.state.observations.length}));}
export function authority(file:string,state:State){
 const metadataFile=`${file}.source.json`;
 if(!state.dataset){if(existsSync(metadataFile))throw new Error('managed source is missing its dataset reference');return null;}
 const metadata=metadataSchema.parse(json(metadataFile,8192)),p=population(state.dataset.case_id);
 if(metadata.instance_id!==state.instance_id||metadata.case_id!==state.dataset.case_id||metadata.seed_state_sha256!==hash(canonical(p.state))||new Date(metadata.created_at).toISOString()!==metadata.created_at)throw new Error('private source authority differs from original case/instance');
 return metadata;
}
export function inspect(file:string,state:State){
 const metadata=authority(file,state),current={...state};delete current.instance_id;delete current.dataset;
 return {ok:true,path:resolve(file),instance_id:state.instance_id??null,case_id:state.dataset?.case_id??null,dataset_sha256:state.dataset?.source_sha256??null,current_source_sha256:hash(readRegular(file)),original_seed_match:metadata?hash(canonical(current))===metadata.seed_state_sha256:null,history_scope:metadata?.scope??'legacy_source_without_imported_authority',provenance:metadata?structuredClone(population(metadata.case_id).provenance):null,state};
}
function exclusive(file:string,value:unknown){
 const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
 const parent=openSync(dirname(file),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
export function initialize(file:string,caseId='conflicting-report'){
 file=resolve(file);const p=population(caseId),meta=`${file}.source.json`,mutex=join(dirname(file),`.${basename(file)}.incident-lock.sqlite`);
 for(const candidate of [file,meta,mutex]){try{lstatSync(candidate);throw new Error('private destination already exists; choose a fresh path');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 mkdirSync(dirname(file),{recursive:true,mode:0o700});
 const instance=randomUUID(),state:State={...structuredClone(p.state),instance_id:instance,dataset:{id:'incident-populations',version:'1.0.0',case_id:caseId,source_sha256:DATASET_SHA256}};
 const metadata={schema_version:1,instance_id:instance,case_id:caseId,dataset_sha256:DATASET_SHA256,seed_state_sha256:hash(canonical(p.state)),created_at:new Date().toISOString(),scope:'original_imported_seed_snapshot'};
 validateState(state);metadataSchema.parse(metadata);
 // Two exclusive files are not a multi-file atomic transaction. A partial
 // initialization is preserved; a subsequent invocation needs a fresh path.
 exclusive(file,state);exclusive(meta,metadata);return inspect(file,state);
}
export function reset(file:string,destination:string){
 if(resolve(file)===resolve(destination))throw new Error('reset needs a distinct fresh destination');
 const state=validateState(json(file));authority(file,state);return initialize(destination,state.dataset?.case_id??'conflicting-report');
}
