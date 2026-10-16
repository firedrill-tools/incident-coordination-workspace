import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, copyFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Runtime } from "../src/runtime.js";
import { Workspace } from "../src/state.js";
export function request(run = "run-1", thread = "thread-1", text = "Read current incident and propose an escalation citing OBS-1") {
  return { threadId: thread, runId: run, messages: [{ id: "user", role: "user", content: text }], tools: [], context: [], state: {}, forwardedProps: {} };
}
export function response(n: number): any {
  return { id: `msg-${n}`, type: "message", role: "assistant", model: "controlled-anthropic", content: n === 1 ? [{ type: "tool_use", id: "read-current", name: "readWorkspace", input: {} }] : n === 2 ? [{ type: "tool_use", id: "proposal-current", name: "proposeUpdate", input: { status: "escalated", owner: "Nora", summary: "OBS-1 shows elevated checkout errors", evidenceIds: ["OBS-1"] } }] : [{ type: "text", text: "A local proposal awaits separate commander review. No channel post was committed." }], stop_reason: n < 3 ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 }, unknown_original: { retained: true } };
}
export async function setup(t: TestContext, mutate: (body: any, n: number, workspace: Workspace) => any = b => b) {
  const directory = mkdtempSync(join(tmpdir(), "incident-native-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json"); copyFileSync(resolve(import.meta.dirname, "../../../fixtures/starter.json"), file);
  const workspace = new Workspace(file), requests: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const b of req) raw += b;
    requests.push(JSON.parse(raw));
    assert.equal(req.url, "/v1/messages"); assert.equal(req.headers["x-api-key"], "synthetic-native-key");
    assert.equal(requests.at(-1).max_tokens, 2048); assert.ok(!requests.at(-1).stream);
    const body = await mutate(response(requests.length), requests.length, workspace);
    if (res.destroyed) return;
    res.writeHead(200, { "content-type": "application/json", "x-request-id": `req-${requests.length}` }); res.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r));
  const runtime = new Runtime(workspace, { model: "anthropic/controlled", apiKey: "synthetic-native-key", baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, outputRoot: join(directory, "runs") });
  t.after(async () => { await runtime.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  const traces = () => readdirSync(join(directory, "runs")).map(id => JSON.parse(readFileSync(join(directory, "runs", id, "receipt.json"), "utf8")));
  return { directory, file, workspace, runtime, requests, traces };
}
