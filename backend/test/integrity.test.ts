import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { Workspace, source, type State } from "../src/state.js";
import { createApp } from "../src/api.js";

function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "incident-integrity-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  copyFileSync(resolve(import.meta.dirname, "../../../fixtures/starter.json"), file);
  return { file, workspace: new Workspace(file) };
}
function edit(file: string, fn: (state: State) => void) { const s = JSON.parse(readFileSync(file, "utf8")) as State; fn(s); writeFileSync(file, JSON.stringify(s)); }
function proposed(workspace: Workspace) { return workspace.propose("escalated", "Nora", "OBS-1 shows elevated checkout errors", ["OBS-1"]); }
for (const field of ["owner", "summary", "evidence", "source"] as const) {
  test(`saved proposal ${field} tampering cannot change incident or channel`, t => {
    const { file, workspace } = setup(t), p = proposed(workspace);
    edit(file, s => {
      if (field === "owner") s.proposals[0].owner = "Unreviewed owner";
      if (field === "summary") s.proposals[0].summary = "Unreviewed text";
      if (field === "evidence") s.proposals[0].evidence_ids = ["OBS-2"];
      if (field === "source") s.proposals[0].source.observations[0].text = "Rewritten evidence";
    });
    const before = readFileSync(file);
    assert.throws(() => workspace.decide(p.id, 1, "approve", "Morgan"), /source\/hash/);
    assert.deepEqual(readFileSync(file), before);
  });
}
test("same-revision telemetry/owner edits stop approval while stale rejection remains possible", t => {
  const { file, workspace } = setup(t), p = proposed(workspace);
  edit(file, s => { s.observations[0].text = "Corrected telemetry"; s.incident.owner = "Avery"; });
  assert.throws(() => workspace.decide(p.id, 1, "approve", "Morgan"), /workspace_changed/);
  const result = workspace.decide(p.id, 1, "reject", "Morgan");
  assert.equal(result.proposal.decision, "rejected");
  assert.equal(result.proposal.decision_record?.source.incident.owner, "Avery");
  assert.equal(result.slack_posts.length, 0);
});
test("genuine read source must remain exact before a later proposal", t => {
  const { workspace } = setup(t), read = source(workspace.read());
  workspace.observe("degraded", "Fresh metrics remain degraded");
  assert.throws(() => workspace.propose("escalated", "Nora", "Old view", ["OBS-1"], read), /changed_since_read/);
  assert.throws(() => workspace.propose("escalated", "Nora", "Old metric", ["OBS-1"]), /degradation_evidence_required/);
  assert.equal(workspace.read().proposals.length, 0);
});
test("new healthy telemetry cannot support a degraded escalation from old metrics", t => {
  const { workspace } = setup(t);
  workspace.observe("healthy", "Checkout latency returned to normal");
  assert.throws(() => proposed(workspace), /degradation_evidence_required/);
});
test("strict source refuses duplicate IDs, nonboolean header, extra fields and ambiguous JSON without repair", t => {
  const { file } = setup(t), original = readFileSync(file, "utf8");
  for (const mutate of [
    (s: any) => { s.observations.push(s.observations[0]); },
    (s: any) => { s.version = true; },
    (s: any) => { s.service.status = "unknown"; },
    (s: any) => { s.incident.revision = Number.MAX_SAFE_INTEGER + 1; },
    (s: any) => { s.incident.extra = "undeclared"; },
  ]) {
    const s = JSON.parse(original); mutate(s); writeFileSync(file, JSON.stringify(s)); const before = readFileSync(file);
    assert.throws(() => new Workspace(file)); assert.deepEqual(readFileSync(file), before);
  }
  writeFileSync(file, original.replace('"version": 1', '"version": 1, "version": 1'));
  assert.throws(() => new Workspace(file), /duplicate JSON key/);
});
test("commander decision, committed update and exact channel post cannot drift apart", t => {
  const { file, workspace } = setup(t), p = proposed(workspace);
  workspace.decide(p.id, 1, "approve", "Morgan");
  const original = readFileSync(file, "utf8");
  for (const mutate of [
    (s: State) => { s.proposals[0].decision_record!.actor = "Agent"; },
    (s: State) => { s.updates[0].owner = "Agent"; },
    (s: State) => { s.slack_posts[0].text = "Other text"; },
    (s: State) => { s.slack_posts[0].channel = "#other"; },
  ]) { writeFileSync(file, original); edit(file, mutate); assert.throws(() => workspace.read()); }
});
test("fresh instance replacement fences an old workspace and exhausted revision cannot overflow", t => {
  const { file } = setup(t);
  edit(file, s => { s.instance_id = "00000000-0000-4000-8000-000000000001"; s.incident.revision = Number.MAX_SAFE_INTEGER; });
  const workspace = new Workspace(file), p = proposed(workspace);
  assert.throws(() => workspace.decide(p.id, 1, "approve", "Morgan"), /revision_exhausted/);
  assert.equal(workspace.read().updates.length, 0);
  edit(file, s => { s.instance_id = "00000000-0000-4000-8000-000000000002"; });
  assert.throws(() => workspace.read(), /instance changed/);
});
test("actual independent processes serialize approval into one update and channel post", async t => {
  const { file, workspace } = setup(t), p = proposed(workspace);
  const module = new URL("../src/state.js", import.meta.url).href;
  const program = `import { Workspace } from ${JSON.stringify(module)}; try {new Workspace(process.argv[1]).decide(process.argv[2],1,'approve','Morgan');process.stdout.write('approved')}catch(e){process.stdout.write(e.message)}`;
  const outputs = await Promise.all(Array.from({ length: 6 }, () => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program, file, p.id], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; }); child.on("error", reject); child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  })));
  assert.equal(outputs.filter(x => x === "approved").length, 1);
  assert.equal(workspace.read().updates.length, 1); assert.equal(workspace.read().slack_posts.length, 1);
});
test("original HTTP JSON and exact API arguments reject ambiguity, booleans and unknown fields", async t => {
  const { file, workspace } = setup(t), p = proposed(workspace);
  const server = createApp(file).listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const before = readFileSync(file);
  for (const [body, status] of [
    ['{"revision":true,"decision":"approve","actor":"Morgan"}', 422],
    ['{"revision":1,"decision":"approve","actor":"Morgan","extra":true}', 422],
    ['{"revision":1,"revision":1,"decision":"approve","actor":"Morgan"}', 400],
    ['{"revision":1e999,"decision":"approve","actor":"Morgan"}', 400],
  ] as const) {
    const response = await fetch(`${url}/proposals/${p.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(response.status, status); assert.deepEqual(readFileSync(file), before);
  }
  const bad = await fetch(`${url}/observations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "healthy", text: "forged", actor: "Agent" }) });
  assert.equal(bad.status, 409); assert.deepEqual(readFileSync(file), before);
});
