import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { MastraClient } from "@mastra/client-js";
import { MastraAgent } from "@ag-ui/mastra";
import { createAgentApp } from "../src/agent-server.js";
import { createIncidentAgent } from "../src/mastra/incident-agent.js";
import { Workspace } from "../src/state.js";

async function served(t: TestContext, model: MastraLanguageModelV2Mock) {
  const directory = mkdtempSync(join(tmpdir(), "incident-agent-http-"));
  const file = join(directory, "workspace.json");
  copyFileSync(resolve(import.meta.dirname, "../../../fixtures/starter.json"), file);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = new Workspace(file);
  const mastra = new Mastra({ agents: { incidentAgent: createIncidentAgent(workspace, model) } });
  const app = await createAgentApp(mastra);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const client = new MastraClient({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
  return { client, workspace };
}

test("CopilotKit's remote AG-UI bridge discovers the agent and streams a proposal without committing it", { timeout: 15000 }, async t => {
  let step = 0;
  const model = new MastraLanguageModelV2Mock({ modelId: "scripted-incident-http", doStream: async () => {
    const index = step++;
    const toolName = index === 0 ? "readWorkspace" : "proposeUpdate";
    const input = index === 0 ? {} : { status: "escalated", owner: "Nora", summary: "OBS-1 shows elevated checkout errors", evidenceIds: ["OBS-1"] };
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      if (index < 2) controller.enqueue({ type: "tool-call", toolCallId: `call-${index}`, toolName, input: JSON.stringify(input) });
      else {
        controller.enqueue({ type: "text-start", id: "answer" });
        controller.enqueue({ type: "text-delta", id: "answer", delta: "Draft PROP-1 awaits incident commander approval." });
        controller.enqueue({ type: "text-end", id: "answer" });
      }
      controller.enqueue({ type: "finish", finishReason: index < 2 ? "tool-calls" : "stop", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
      controller.close();
    } }) };
  } });
  const { client, workspace } = await served(t, model);
  const remoteAgents = await MastraAgent.getRemoteAgents({ mastraClient: client, resourceId: "local-incident-operator" });
  assert.deepEqual(Object.keys(remoteAgents), ["incident-agent"]);
  const bridge = remoteAgents["incident-agent"];
  bridge.addMessage({ id: "request", role: "user", content: "Read the current incident and propose an evidence-backed escalation." });
  const types: string[] = [];
  const results: string[] = [];
  const outcomes: string[] = [];
  await bridge.runAgent({}, {
    onEvent: ({ event }) => { types.push(event.type); },
    onToolCallResultEvent: ({ event }) => { results.push(typeof event.content === "string" ? event.content : JSON.stringify(event.content)); },
    onRunFinishedEvent: ({ outcome }) => { outcomes.push(outcome); },
  });
  assert.ok(types.includes("RUN_STARTED"));
  assert.ok(types.includes("TEXT_MESSAGE_CONTENT"));
  assert.ok(!types.includes("RUN_ERROR"));
  assert.deepEqual(outcomes, ["success"]);
  assert.equal(model.doStreamCalls.length, 3);
  assert.ok(results.some(result => result.includes("INC-101")));
  assert.ok(results.some(result => result.includes("PROP-1")));
  assert.match(JSON.stringify(bridge.messages), /awaits incident commander approval/);
  const state = workspace.read();
  assert.equal(state.proposals.length, 1);
  assert.equal(state.proposals[0].status, "escalated");
  assert.equal(state.incident.status, "investigating");
  assert.equal(state.incident.owner, "Leah");
  assert.equal(state.slack_posts.length, 0);
});

test("a model failure reaches the remote bridge as an error without a successful completion or workspace changes", { timeout: 15000 }, async t => {
  const model = new MastraLanguageModelV2Mock({ modelId: "scripted-provider-failure", doStream: async () => { throw new Error("Synthetic provider unavailable"); } });
  const { client, workspace } = await served(t, model);
  const before = workspace.read();
  const remoteAgents = await MastraAgent.getRemoteAgents({ mastraClient: client, resourceId: "local-incident-operator" });
  const bridge = remoteAgents["incident-agent"];
  bridge.addMessage({ id: "request", role: "user", content: "Inspect the incident" });
  const types: string[] = [];
  try { await bridge.runAgent({}, { onEvent: ({ event }) => { types.push(event.type); } }); } catch { /* AG-UI also rejects provider failures. */ }
  assert.ok(types.includes("RUN_ERROR"));
  assert.ok(!types.includes("RUN_FINISHED"));
  assert.deepEqual(workspace.read(), before);
});
