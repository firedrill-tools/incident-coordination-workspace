/** Complete fresh locked source and production-only native/API/CLI qualification. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'incident-distribution-'));
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',COPILOTKIT_TELEMETRY_DISABLED:'true',OTEL_SDK_DISABLED:'true',NEXT_PUBLIC_INCIDENT_API_URL:'http://127.0.0.1:3826'};
for(const k of Object.keys(env))if(['ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','INCIDENT_MODEL','INCIDENT_WORKSPACE_FILE','INCIDENT_AGENT_URL','NODE_PATH','NODE_OPTIONS','NODE_TEST_CONTEXT'].includes(k)||k.toLowerCase()==='npm_config_allow_scripts')delete env[k];
const hash=b=>createHash('sha256').update(b).digest('hex');
const run=(cmd,args,cwd=temporary)=>execFileSync(cmd,args,{cwd,env,encoding:'utf8',timeout:240000,maxBuffer:12*1024*1024,stdio:['ignore','pipe','pipe']});
const children=new Set();let provider;
function timeout(ms,message){let timer;return {promise:new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);}),clear:()=>clearTimeout(timer)};}
async function startCLI(cli,file,base,key){
 const child=spawn(process.execPath,[cli,'serve','--workspace',file,'--model','anthropic/controlled','--base-url',base,'--port','0'],{cwd:temporary,env:{...env,...key?{ANTHROPIC_API_KEY:key}:{}},stdio:['ignore','pipe','pipe']});
 const entry={child,exit:once(child,'exit')};children.add(entry);
 let output='',errors='';child.stderr.on('data',b=>{errors=(errors+b).slice(-12000);});
 const clock=timeout(15000,'installed CLI startup timed out');
 try{
  const address=await Promise.race([new Promise((resolve,reject)=>{child.stdout.on('data',b=>{output+=b;const m=/http:\/\/127\.0\.0\.1:(\d+)/.exec(output);if(m)resolve(`http://127.0.0.1:${m[1]}`);if(output.length>16384)reject(new Error('CLI startup output exceeds bound'));});child.once('error',reject);}),entry.exit.then(()=>{throw new Error(`CLI exited before readiness: ${output} ${errors}`);}),clock.promise]);
  return {...entry,address};
 }finally{clock.clear();}
}
async function stopCLI(entry){
 entry.child.kill('SIGTERM');const clock=timeout(5000,'installed CLI did not drain on SIGTERM');
 try{const [code]=await Promise.race([entry.exit,clock.promise]);if(code!==0)throw new Error(`installed CLI exit ${code}`);children.forEach(item=>{if(item.child===entry.child)children.delete(item);});}
 catch(e){entry.child.kill('SIGKILL');throw e;}finally{clock.clear();}
}
try{
 const source=JSON.parse(run(process.execPath,['scripts/package.mjs'],root));
 const repeat=path.join(temporary,'repeat.tar.gz');run(process.execPath,['scripts/package.mjs',repeat],root);if(!fs.readFileSync(source.path).equals(fs.readFileSync(repeat)))throw new Error('source bytes are not repeatable');
 run('tar',['-xzf',source.path,'-C',temporary]);const directory=path.join(temporary,'package'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'MANIFEST.json')));
 const verify=()=>{for(const row of manifest.files){const file=path.join(directory,row.path),bytes=fs.readFileSync(file);if(hash(bytes)!==row.sha256||bytes.length!==row.size||(fs.statSync(file).mode&0o777)!==row.mode)throw new Error(`delivered source changed: ${row.path}`);}};
 const enumerated=[];function walk(file){const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw new Error('archive alias refused');if(stat.isDirectory())for(const n of fs.readdirSync(file))walk(path.join(file,n));else enumerated.push(path.relative(directory,file));}walk(directory);
 const expected=[...manifest.files.map(r=>r.path),'MANIFEST.json'].sort();if(JSON.stringify(enumerated.sort())!==JSON.stringify(expected))throw new Error('archive file population differs from manifest');verify();
 const backend=path.join(directory,'backend'),frontend=path.join(directory,'frontend');
 run('npm',['ci','--no-audit','--no-fund'],backend);
 const suite=run('npm',['test'],backend);if(!/tests\s+80\b/.test(suite))throw new Error(`complete backend suite differs: ${suite.slice(-2000)}`);
 run(process.execPath,['scripts/build-datasets.mjs','--check'],directory);
 run('npm',['ci','--no-audit','--no-fund'],frontend);run('npm',['run','test:dependencies'],frontend);run('npm',['run','typecheck'],frontend);run('npm',['run','build'],frontend);
 const browser=run('npm',['run','test:e2e'],frontend);if(!browser.includes('12 passed'))throw new Error(`production browser suite differs: ${browser.slice(-2000)}`);
 const results=path.join(root,'dist/browser-results');fs.rmSync(results,{recursive:true,force:true});fs.cpSync(path.join(frontend,'test-results'),results,{recursive:true});
 const production=path.join(temporary,'production');fs.mkdirSync(production);
 for(const name of ['package.json','package-lock.json','scripts','data','fixtures','README.md','AGENTS.md'])fs.cpSync(path.join(backend,name),path.join(production,name),{recursive:true});
 fs.mkdirSync(path.join(production,'dist'),{recursive:true});fs.cpSync(path.join(backend,'dist/src'),path.join(production,'dist/src'),{recursive:true});
 run('npm',['ci','--omit=dev','--no-audit','--no-fund'],production);
 const cli=path.join(production,'dist/src/cli.js');run(process.execPath,[cli,'--help']);run(process.execPath,[path.join(production,'dist/src/api.js'),'--help']);
 const cases=JSON.parse(run(process.execPath,[cli,'datasets']));if(cases.length!==12)throw new Error('installed population count differs');
 for(const c of cases){
  const file=path.join(temporary,`${c.id}.json`),created=JSON.parse(run(process.execPath,[cli,'init','--workspace',file,'--case',c.id])),before=fs.readFileSync(file);
  const info=JSON.parse(run(process.execPath,[cli,'workspace','--workspace',file]));if(!info.original_seed_match||(fs.statSync(file).mode&0o777)!==0o600)throw new Error('installed private source differs');
  const fresh=JSON.parse(run(process.execPath,[cli,'reset','--workspace',file,'--destination',`${file}.fresh.json`]));if(fresh.instance_id===created.instance_id||!fs.readFileSync(file).equals(before))throw new Error('installed reset changed original');
 }
 const requests=[];provider=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);const n=requests.length;
  if(req.url!=='/v1/messages'||req.headers['x-api-key']!=='synthetic-installed-key'||body.max_tokens!==2048||body.stream||body.model!=='controlled')throw new Error('installed native request differs');
  const content=n===1?[{type:'tool_use',id:'read-current',name:'readWorkspace',input:{}}]:n===2?[{type:'tool_use',id:'proposal-current',name:'proposeUpdate',input:{status:'escalated',owner:'Nora',summary:'OBS-1 shows current checkout errors',evidenceIds:['OBS-1']}}]:[{type:'text',text:'A pending local proposal awaits separate commander approval. No Slack delivery occurred.'}];
  res.writeHead(200,{'content-type':'application/json','x-request-id':`request-${n}`});res.end(JSON.stringify({id:`msg-${n}`,type:'message',role:'assistant',model:'controlled-installed',content,stop_reason:n<3?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:2},unknown_original:true}));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');const base=`http://127.0.0.1:${provider.address().port}/v1`,file=path.join(temporary,'conflicting-report.json');
 const input=()=>({threadId:randomUUID(),runId:randomUUID(),protocolVersion:'1.0',messages:[{id:randomUUID(),role:'user',content:'Read the incident and propose escalation based on OBS-1'}],tools:[],context:[],state:{},forwardedProps:{}});
 const native=await startCLI(cli,file,base,'synthetic-installed-key');
 try{
  const response=await fetch(native.address+'/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input()),signal:AbortSignal.timeout(30000)}),text=await response.text();if(response.status!==200||!text.includes('RUN_FINISHED')||text.includes('RUN_ERROR')||requests.length!==3)throw new Error(`installed native API failed: ${text}`);
  const state=await(await fetch(native.address+'/workspace')).json();if(state.proposals.length!==1||state.updates.length||state.slack_posts.length)throw new Error('installed native result committed before commander approval');
  const proposal=state.proposals[0];const decided=await fetch(native.address+`/proposals/${proposal.id}/decision`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:1,decision:'approve',actor:'Morgan'})});if(decided.status!==200)throw new Error('installed separate commander decision failed');
  const after=await(await fetch(native.address+'/workspace')).json();if(after.updates.length!==1||after.slack_posts.length!==1||after.incident.owner!=='Nora')throw new Error('installed commander effects differ');
 }finally{await stopCLI(native);}
 const count=requests.length,missing=await startCLI(cli,file,base);
 try{const response=await fetch(missing.address+'/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input()),signal:AbortSignal.timeout(15000)}),text=await response.text();if(!text.includes('RUN_ERROR')||text.includes('RUN_FINISHED')||requests.length!==count)throw new Error('installed missing-key path differs');}finally{await stopCLI(missing);}
 const traces=fs.readdirSync(path.join(temporary,'runs')).map(n=>JSON.parse(fs.readFileSync(path.join(temporary,'runs',n,'receipt.json'))));const complete=traces.find(t=>t.status==='completed'),failed=traces.find(t=>t.status==='failed');
 if(traces.length!==2||!complete?.cleanupConfirmed||!failed?.cleanupConfirmed||failed.calls.length||complete.calls.length!==3||!complete.calls.every(c=>c.response.body.unknown_original&&c.reportedUsage.input.value===10)||complete.reportedUsage.costUsd!==null||failed.reportedUsage.input.value!==null)throw new Error('installed original evidence/cleanup differs');
 verify();const rebuilt=path.join(temporary,'rebuilt.tar.gz');run(process.execPath,['scripts/package.mjs',rebuilt],directory);if(!fs.readFileSync(source.path).equals(fs.readFileSync(rebuilt)))throw new Error('fresh source bytes differ after install/build/test');
 const report={...source,checks:'fresh locked complete source/production-only dependencies outside checkout;80 backend/11 frontend dependency/12 production Chromium flows;all12 private populations/readback/reset;installed normal CLI/native Anthropic HTTP/Mastra official AG-UI API and separate commander decision;missing-key receipts;SIGTERM drain;unchanged delivered files/repeated portable bytes'};
 fs.writeFileSync(path.join(root,'dist/qualification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
 for(const entry of children){entry.child.kill('SIGKILL');await entry.exit.catch(()=>{});}
 if(provider){provider.closeAllConnections();await new Promise(r=>provider.close(r));}
 fs.rmSync(temporary,{recursive:true,force:true});
}
