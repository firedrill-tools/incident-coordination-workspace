import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { MastraAgent } from "@ag-ui/mastra";
import { MastraClient } from "@mastra/client-js";

const mastraClient = new MastraClient({ baseUrl: process.env.MASTRA_BASE_URL || "http://127.0.0.1:4111" });
const runtime = new CopilotRuntime({
  agents: () => MastraAgent.getRemoteAgents({ mastraClient, resourceId: "local-incident-operator" }),
  runner: new InMemoryAgentRunner(),
});
const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", mode: "single-route" });
export const POST = handler;
