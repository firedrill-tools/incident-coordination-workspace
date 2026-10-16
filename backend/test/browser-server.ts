// Owned test-only provider: actual Anthropic SDK, Mastra and official AG-UI bridge.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../src/api.js";
if (!process.env.INCIDENT_TEST_STATE) throw new Error("INCIDENT_TEST_STATE must name a disposable browser workspace");
const file = resolve(process.env.INCIDENT_TEST_STATE);
mkdirSync(dirname(file), { recursive: true });
copyFileSync(resolve(import.meta.dirname, "../../../fixtures/starter.json"), file);
const provider = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (req.url !== "/v1/messages" || req.headers["x-api-key"] !== "synthetic-browser-key" || body.max_tokens !== 2048 || body.stream) { res.writeHead(400); res.end(); return; }
  const messages = body.messages as any[];
  const userIndex = messages.map(m => m.role === "user" && (typeof m.content === "string" || m.content.some((p: any) => p.type === "text"))).lastIndexOf(true);
  const text = JSON.stringify(messages[userIndex]);
  if (text.includes("fail-provider")) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { type: "overloaded_error", message: "Synthetic provider unavailable" } })); return; }
  const toolResults = messages.slice(userIndex + 1).flatMap(m => Array.isArray(m.content) ? m.content.filter((p: any) => p.type === "tool_result") : []);
  const content = toolResults.length === 0 ? [{ type: "tool_use", id: "browser-read", name: "readWorkspace", input: {} }] : toolResults.length === 1 ? [{ type: "tool_use", id: "browser-propose", name: "proposeUpdate", input: { status: "escalated", owner: "Nora", summary: "OBS-1 shows elevated checkout errors", evidenceIds: ["OBS-1"] } }] : [{ type: "text", text: "Draft PROP-1 awaits incident commander approval. Evidence: **OBS-1**.\n\nSynthetic error ratio:\n\n$$\n\\frac{1}{2}\n$$\n\n<script>window.syntheticUnsafe = true</script>\n\n<a href=\"javascript:void(0)\">Unsafe link sample</a>" }];
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: `msg-${toolResults.length}`, type: "message", role: "assistant", model: "controlled-browser", content, stop_reason: toolResults.length < 2 ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }));
});
provider.listen(0, "127.0.0.1"); await new Promise<void>(r => provider.once("listening", r));
const app = createApp(file, "http://127.0.0.1:3326", { model: "anthropic/controlled", apiKey: "synthetic-browser-key", baseURL: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1` });
const server = app.listen(3826, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => {
  await app.locals.runtime.close(); server.close(); server.closeAllConnections(); provider.close(); provider.closeAllConnections();
});
