import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: { "incident-agent": new HttpAgent({ url: process.env.INCIDENT_AGENT_URL || "http://127.0.0.1:8126/agent" }) },
  runner: new InMemoryAgentRunner(),
});
const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", mode: "single-route" });
export const POST = handler;
