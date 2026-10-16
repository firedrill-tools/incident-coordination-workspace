#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {existsSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialize,listCases,inspect,reset} from './datasets.js';
import {Workspace} from './state.js';
import {createApp} from './api.js';
export async function main(args=process.argv.slice(2)){
 try{
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{workspace:{type:'string'},case:{type:'string'},destination:{type:'string'},port:{type:'string'},offline:{type:'boolean'},model:{type:'string'},'base-url':{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log('incident-workspace datasets|init|workspace|reset|serve [--workspace FILE] [--case ID] [--destination NEW_FILE] [--port PORT] [--offline] [--model anthropic/MODEL] [--base-url URL]');return;}
  if(positionals.length>1)throw new Error('expected one command');
  const file=resolve(values.workspace??process.env.INCIDENT_WORKSPACE_FILE??'run-output/workspace.json'),command=positionals[0]??'serve';
  let result;
  if(command==='datasets')result=listCases();
  else if(command==='init')result=initialize(file,values.case);
  else if(command==='workspace')result=inspect(file,new Workspace(file).read());
  else if(command==='reset'){if(!values.destination)throw new Error('reset needs --destination');result=reset(file,values.destination);}
  else if(command==='serve'){
   const port=values.port??'8126';if(!/^\d+$/.test(port)||Number(port)>65535)throw new Error('port must be 0..65535');
   const app=createApp(file,undefined,{model:values.model,baseURL:values['base-url']},!values.offline),server=app.listen(Number(port),'127.0.0.1',()=>console.log(`Incident workspace on http://127.0.0.1:${(server.address() as {port:number}).port}`));
   let stopping=false;
   for(const signal of ['SIGINT','SIGTERM','SIGHUP'] as const)process.once(signal,async()=>{if(stopping)return;stopping=true;try{await app.locals.runtime?.close();}finally{server.close();server.closeAllConnections();}});
   return;
  }else throw new Error('unknown incident command');
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.log(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));process.exitCode=1;}
}
if(process.argv[1]&&existsSync(process.argv[1])&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)await main();
