// Test-only host: scripted SDK responses, real application tools/API, disposable state.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { createApp } from "../src/api.js";
import { createAgentApp } from "../src/agent-server.js";
import { createIncidentAgent } from "../src/mastra/incident-agent.js";
import { Workspace } from "../src/state.js";

if (!process.env.INCIDENT_TEST_STATE) throw new Error("INCIDENT_TEST_STATE must name a disposable browser workspace");
const file = resolve(process.env.INCIDENT_TEST_STATE);
mkdirSync(dirname(file), { recursive: true });
copyFileSync(resolve(import.meta.dirname, "../../../fixtures/starter.json"), file);
const workspace = new Workspace(file);
const model = new MastraLanguageModelV2Mock({ modelId: "scripted-browser-incident", doStream: async options => {
  const userIndex = options.prompt.map(message => message.role).lastIndexOf("user");
  if (JSON.stringify(options.prompt[userIndex]).includes("fail-provider")) throw new Error("Synthetic provider unavailable");
  const results = options.prompt.slice(userIndex + 1).flatMap(message => message.role === "tool" ? message.content : []);
  const hasRead = results.some(part => part.type === "tool-result" && part.toolName === "readWorkspace");
  const hasProposal = results.some(part => part.type === "tool-result" && part.toolName === "proposeUpdate");
  const toolName = !hasRead ? "readWorkspace" : "proposeUpdate";
  const input = !hasRead ? {} : { status: "escalated", owner: "Nora", summary: "OBS-1 shows elevated checkout errors", evidenceIds: ["OBS-1"] };
  return { stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "stream-start", warnings: [] });
    if (!hasProposal) controller.enqueue({ type: "tool-call", toolCallId: `browser-${toolName}`, toolName, input: JSON.stringify(input) });
    else {
      controller.enqueue({ type: "text-start", id: "answer" });
      controller.enqueue({ type: "text-delta", id: "answer", delta: "Draft PROP-1 awaits incident commander approval. Evidence: **OBS-1**.\n\nSynthetic error ratio:\n\n$$\n\\frac{1}{2}\n$$\n\n<script>window.syntheticUnsafe = true</script>\n\n<a href=\"javascript:void(0)\">Unsafe link sample</a>" });
      controller.enqueue({ type: "text-end", id: "answer" });
    }
    controller.enqueue({ type: "finish", finishReason: hasProposal ? "stop" : "tool-calls", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
    controller.close();
  } }) };
} });
const agentApp = await createAgentApp(new Mastra({ agents: { incidentAgent: createIncidentAgent(workspace, model) } }));
const servers = [createApp(file, "http://127.0.0.1:3326").listen(3826, "127.0.0.1"), agentApp.listen(3426, "127.0.0.1")];
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  for (const server of servers) { server.close(); server.closeAllConnections(); }
});
