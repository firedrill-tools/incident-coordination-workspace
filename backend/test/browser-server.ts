// Owned test-only provider/reset host. Production exposes no __test routes.
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import express from 'express';
import {createApp} from '../src/api.js';
import {initialize} from '../src/datasets.js';
import {Workspace} from '../src/state.js';
if(!process.env.INCIDENT_TEST_STATE)throw new Error('INCIDENT_TEST_STATE must name a disposable browser workspace');
const directory=dirname(resolve(process.env.INCIDENT_TEST_STATE));mkdirSync(directory,{recursive:true});
let file='',pending=false,drained=false;
const provider=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 if(req.url!=='/v1/messages'||req.headers['x-api-key']!=='synthetic-browser-key'||body.max_tokens!==2048||body.stream){res.writeHead(400);res.end();return;}
 const messages=body.messages as any[],userIndex=messages.map(m=>m.role==='user'&&(typeof m.content==='string'||m.content.some((p:any)=>p.type==='text'))).lastIndexOf(true),text=JSON.stringify(messages[userIndex]);
 if(text.includes('hold-provider')){pending=true;drained=false;await new Promise<void>(r=>res.once('close',()=>{pending=false;drained=true;r();}));return;}
 if(text.includes('fail-provider')){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'overloaded_error',message:'Synthetic provider unavailable'}}));return;}
 const results=messages.slice(userIndex+1).flatMap(m=>Array.isArray(m.content)?m.content.filter((p:any)=>p.type==='tool_result'):[]),state=new Workspace(file).read(),metric=state.observations.filter(o=>o.source==='metrics').at(-1)!;
 const person=state.incident.id==='INC-202'?'Omar':'Nora';
 const content=results.length===0?[{type:'tool_use',id:'browser-read',name:'readWorkspace',input:{}}]:results.length===1?[{type:'tool_use',id:'browser-propose',name:'proposeUpdate',input:{status:'escalated',owner:person,summary:`${metric.id} shows elevated ${state.service.name} errors`,evidenceIds:[metric.id]}}]:[{type:'text',text:'Draft '+state.proposals.at(-1)?.id+' awaits incident commander approval. Evidence: **'+metric.id+'**.\n\nSynthetic error ratio:\n\n$$\n\\frac{1}{2}\n$$\n\n<script>window.syntheticUnsafe = true</script>\n\n<a href="javascript:void(0)">Unsafe link sample</a>'}];
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:`msg-${results.length}`,type:'message',role:'assistant',model:'controlled-browser',content,stop_reason:text.includes('truncated-provider')?'max_tokens':results.length<2?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:2}}));
});
provider.listen(0,'127.0.0.1');await new Promise<void>(r=>provider.once('listening',r));
const options={model:'anthropic/controlled',apiKey:'synthetic-browser-key',baseURL:`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`};
function fresh(caseId='conflicting-report'){
 file=join(directory,randomUUID(),'state.json');initialize(file,caseId);writeFileSync(join(directory,'workspace-path.txt'),file,{mode:0o600});
 return createApp(file,'http://127.0.0.1:3326',options);
}
let active=fresh();const app=express();
app.post('/__test/reset',async(req,res)=>{await active.locals.runtime.close();active=fresh(String(req.query.case??'conflicting-report'));pending=false;drained=false;res.json({ok:true});});
app.get('/__test/pending',(_req,res)=>res.json({pending,drained}));
app.use((req,res,next)=>active(req,res,next));
const server=app.listen(3826,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await active.locals.runtime.close();server.close();server.closeAllConnections();provider.close();provider.closeAllConnections();});
