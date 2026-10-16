import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {populations,initialize,inspect,reset,validatePopulation} from '../src/datasets.js';
import {Workspace} from '../src/state.js';
import {policy} from '../src/schema.js';
import {Runtime} from '../src/runtime.js';
import {setup,request,response} from './native-fixture.js';
const cases=populations();
for(const population of cases){
 test(`private ${population.id} initialization/readback/reset preserves original authority and state`,t=>{
  const directory=mkdtempSync(join(tmpdir(),'incident-population-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,'state.json'),created=initialize(file,population.id),workspace=new Workspace(file);
  assert.ok(created.original_seed_match);assert.equal(statSync(file).mode&0o777,0o600);assert.equal(statSync(file+'.source.json').mode&0o777,0o600);
  const before=readFileSync(file),metadata=readFileSync(file+'.source.json');assert.throws(()=>initialize(file,population.id),/already exists/);
  const fresh=reset(file,join(directory,'fresh.json'));assert.notEqual(fresh.instance_id,created.instance_id);assert.ok(fresh.original_seed_match);
  assert.deepEqual(readFileSync(file),before);assert.deepEqual(readFileSync(file+'.source.json'),metadata);assert.ok(inspect(file,workspace.read()).original_seed_match);
 });
 test(`actual native ${population.id} remains proposal-only and commander decision is separate`,{timeout:15000},async t=>{
  const desired=population.id==='healthy-monitoring'?'monitoring':['missing-evidence','customer-only-recovery'].includes(population.id)?'resolved':'escalated';
  const evidence=population.id==='busy-incident'?'OBS-10':['healthy-monitoring','stale-proposal'].includes(population.id)?'OBS-3':population.id==='missing-evidence'?'OBS-404':population.id==='customer-only-recovery'?'OBS-2':'OBS-1';
  const person=population.id==='unicode-owner'?'Renée Park':population.id==='ownership-handoff'?'Omar':'Nora';
  const fixture=await setup(t,(body,n)=>{
   if(n===2&&population.id==='already-resolved')return response(3);
   if(n===2)body.content[0].input={status:desired,owner:person,summary:`Current evidence ${evidence} reviewed for commander decision`,evidenceIds:[evidence]};
   return body;
  });
  const file=join(fixture.directory,'managed.json');initialize(file,population.id);const workspace=new Workspace(file),before=workspace.read();
  const runtime=new Runtime(workspace,{...fixture.runtime.options,outputRoot:join(fixture.directory,'case-runs')});t.after(()=>runtime.close());
  const result=await runtime.run(request('case-run','case-thread',population.task));assert.equal(result.events.at(-1).type,'RUN_FINISHED');
  const allowed=!['already-resolved','conflicting-metrics','missing-evidence','customer-only-recovery'].includes(population.id),after=workspace.read();
  assert.equal(after.proposals.length,before.proposals.length+(allowed?1:0));assert.deepEqual(after.updates,before.updates);assert.deepEqual(after.slack_posts,before.slack_posts);
  const prompts=JSON.stringify(fixture.requests);assert.ok(!prompts.includes('incident-populations')&&!prompts.includes('fictional_imported_incident_snapshot')&&!prompts.includes('content_sha256')&&!prompts.includes('decision_record'));
  if(allowed){const proposal=after.proposals.at(-1)!;assert.equal(proposal.decision,'pending');assert.equal(proposal.decision_record,null);
   if(population.id==='maximum-revision')assert.throws(()=>workspace.decide(proposal.id,1,'approve',policy(after).commander),/revision_exhausted/);
   else{workspace.decide(proposal.id,1,'approve',policy(after).commander);assert.equal(workspace.read().updates.length,before.updates.length+1);assert.equal(workspace.read().slack_posts.length,before.slack_posts.length+1);assert.equal(workspace.read().incident.owner,person);}
  }
 });
}
test('busy imported population/history and original provenance are coherent',()=>{
 const busy=cases.find(p=>p.profile==='busy')!;assert.equal(busy.state.proposals.length,100);assert.equal(busy.state.updates.length,64);assert.equal(busy.state.slack_posts.length,64);assert.equal(busy.state.observations.length,10);
 assert.equal(busy.state.proposals.filter(p=>p.decision==='pending').length,24);assert.equal(busy.state.proposals.filter(p=>p.decision==='rejected').length,12);
 assert.ok(busy.history.length>180);assert.equal(busy.provenance.prior_model_evidence,null);assert.equal(busy.provenance.prior_human_authentication,null);assert.equal(busy.provenance.prior_slack_delivery,null);
 const changed=structuredClone(busy);changed.history[0].target='other';assert.throws(()=>validatePopulation(changed),/differs from original audit/);
});
test('current owner edits stay separate from imported seed history and foreign/corrupt/missing authority never repairs',t=>{
 const directory=mkdtempSync(join(tmpdir(),'incident-authority-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const file=join(directory,'state.json');initialize(file);const workspace=new Workspace(file);workspace.observe('degraded','Later genuine current telemetry');
 assert.equal(inspect(file,workspace.read()).original_seed_match,false);assert.equal(inspect(file,workspace.read()).history_scope,'original_imported_seed_snapshot');
 const bytes=readFileSync(file),original=readFileSync(file+'.source.json','utf8');
 for(const change of [(m:any)=>m.schema_version=true,(m:any)=>m.case_id='healthy-monitoring',(m:any)=>m.seed_state_sha256='0'.repeat(64)]){const metadata=JSON.parse(original);change(metadata);writeFileSync(file+'.source.json',JSON.stringify(metadata));assert.throws(()=>workspace.read());assert.deepEqual(readFileSync(file),bytes);}
 writeFileSync(file+'.source.json',original);unlinkSync(file+'.source.json');assert.throws(()=>workspace.read());assert.deepEqual(readFileSync(file),bytes);
});
