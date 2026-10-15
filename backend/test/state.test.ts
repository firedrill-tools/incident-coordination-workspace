import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Workspace, Conflict, type State } from "../src/state.js";
import { createApp } from "../src/api.js";

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), "incident-")), "state.json");
  copyFileSync(resolve(import.meta.dirname, "../../../fixtures/starter.json"), file);
  return { file, workspace: new Workspace(file) };
}
test("customer anecdote cannot resolve degraded service", () => {
  const { workspace } = setup();
  assert.throws(() => workspace.propose("resolved", "Leah", "Recovered", ["OBS-2"]), /healthy_metrics_required/);
  assert.equal(workspace.read().proposals.length, 0);
});
test("escalation is evidence backed and approval posts exact synthetic update", () => {
  const { workspace } = setup();
  const proposal = workspace.propose("escalated", "Nora", "Metrics show elevated checkout errors", ["OBS-1"]);
  assert.equal(workspace.read().incident.owner, "Leah");
  assert.throws(() => workspace.decide(proposal.id, 1, "approve", "Agent"), /incident_commander_required/);
  const decided = workspace.decide(proposal.id, 1, "approve", "Morgan");
  assert.equal(decided.incident.owner, "Nora");
  assert.equal(decided.incident.status, "escalated");
  assert.match(decided.slack_posts[0].text, /OBS-1/);
  assert.throws(() => workspace.decide(proposal.id, 1, "approve", "Morgan"), /proposal_not_current/);
});
test("service changes invalidate stale proposals and new healthy metrics permit monitoring", () => {
  const { workspace } = setup();
  const stale = workspace.propose("escalated", "Leah", "Still degraded", ["OBS-1"]);
  const healthy = workspace.observe("healthy", "Checkout p95 210 ms and errors normal");
  assert.throws(() => workspace.decide(stale.id, 1, "approve", "Morgan"), /workspace_changed/);
  const proposed = workspace.propose("monitoring", "Leah", "Healthy metrics suggest recovery", [healthy.id]);
  const result = workspace.decide(proposed.id, 1, "approve", "Morgan");
  assert.equal(result.incident.status, "monitoring");
});
test("rejection and missing evidence leave committed status untouched", () => {
  const { workspace } = setup();
  assert.throws(() => workspace.propose("escalated", "Leah", "No source", ["MISSING"]), /unknown_evidence/);
  const proposal = workspace.propose("escalated", "Leah", "Errors elevated", ["OBS-1"]);
  workspace.decide(proposal.id, 1, "reject", "Morgan");
  assert.equal(workspace.read().incident.status, "investigating");
  assert.equal(workspace.read().slack_posts.length, 0);
});
test("HTTP API returns the same committed state", async () => {
  const { file, workspace } = setup();
  const server = createApp(file).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const proposal = workspace.propose("escalated", "Nora", "Errors elevated", ["OBS-1"]);
    const response = await fetch(`${base}/proposals/${proposal.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: 1, decision: "approve", actor: "Morgan" }) });
    assert.equal(response.status, 200);
    const state = await (await fetch(`${base}/workspace`)).json();
    assert.equal(state.incident.owner, "Nora");
    assert.equal(state.slack_posts.length, 1);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("Mastra tools can read and propose without committing", async () => {
  const { file, workspace } = setup();
  const { createIncidentTools } = await import("../src/mastra/incident-agent.js");
  const { readWorkspace, proposeUpdate } = createIncidentTools(new Workspace(file));
  const observed = await readWorkspace.execute!({}, {} as never) as State;
  assert.equal(observed.incident.status, "investigating");
  const result = await proposeUpdate.execute!({ status: "escalated", owner: "Nora", summary: "Errors elevated", evidenceIds: ["OBS-1"] }, {} as never) as { proposal?: { id: string } };
  assert.equal(result.proposal?.id, "PROP-1");
  assert.equal(workspace.read().incident.status, "investigating");
  assert.equal(workspace.read().slack_posts.length, 0);
});
