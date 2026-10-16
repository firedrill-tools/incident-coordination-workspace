import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const cli=resolve(import.meta.dirname,'../src/cli.js');
function command(args:string[],cwd:string){const env={...process.env};for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','INCIDENT_MODEL','INCIDENT_WORKSPACE_FILE'])delete env[key];return spawnSync(process.execPath,[cli,...args],{cwd,env,encoding:'utf8',timeout:15000});}
test('normal model-free CLI initializes reads and resets all twelve cases outside checkout',t=>{
 const directory=mkdtempSync(join(tmpdir(),'incident-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const listed=command(['datasets'],directory);assert.equal(listed.status,0,listed.stderr);const cases=JSON.parse(listed.stdout);assert.equal(cases.length,12);
 for(const c of cases){const file=join(directory,c.id+'.json'),created=command(['init','--workspace',file,'--case',c.id],directory);assert.equal(created.status,0,created.stdout+created.stderr);
  const before=readFileSync(file),info=command(['workspace','--workspace',file],directory);assert.equal(info.status,0,info.stdout);assert.ok(JSON.parse(info.stdout).original_seed_match);
  const fresh=command(['reset','--workspace',file,'--destination',file+'.fresh.json'],directory);assert.equal(fresh.status,0,fresh.stdout);assert.notEqual(JSON.parse(fresh.stdout).instance_id,JSON.parse(created.stdout).instance_id);assert.deepEqual(readFileSync(file),before);
 }
});
test('CLI unknown arguments, collisions and missing authority fail without overwrite',t=>{
 const directory=mkdtempSync(join(tmpdir(),'incident-cli-errors-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=join(directory,'state.json');
 assert.equal(command(['init','--workspace',file],directory).status,0);const before=readFileSync(file);
 assert.equal(command(['init','--workspace',file],directory).status,1);assert.equal(command(['workspace','--workspace',file,'--undeclared'],directory).status,1);
 unlinkSync(file+'.source.json');assert.equal(command(['workspace','--workspace',file],directory).status,1);assert.deepEqual(readFileSync(file),before);
});


test('normal CLI and API entry aliases resolve the actual module instead of exiting silently',t=>{
 const directory=mkdtempSync(join(tmpdir(),'incident-cli-alias-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const alias=join(directory,'incident-workspace.mjs'),api=join(directory,'incident-api.mjs');symlinkSync(cli,alias);symlinkSync(resolve(import.meta.dirname,'../src/api.js'),api);
 const listed=spawnSync(process.execPath,[alias,'datasets'],{cwd:directory,encoding:'utf8',timeout:15000});assert.equal(listed.status,0,listed.stderr);assert.equal(JSON.parse(listed.stdout).length,12);
 const help=spawnSync(process.execPath,[api,'--help'],{cwd:directory,encoding:'utf8',timeout:15000});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/incident-workspace datasets/);
});
