/** Owned Mastra + official local AG-UI bridge, one operation per private agent. */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { z } from "zod";
import { Mastra } from "@mastra/core/mastra";
import { noopLogger } from "@mastra/core/logger";
import { MastraAgent } from "@ag-ui/mastra";
import { Native, type NativeOptions } from "./native.js";
import { Receipt, summarize, errorInfo } from "./evidence.js";
import { Workspace, type Source } from "./state.js";
import { same } from "./schema.js";
import { createIncidentAgent, business, type ToolOwner } from "./mastra/incident-agent.js";

const id = z.string().min(1).max(160).refine(v => !/[\x00-\x1f\x7f]/.test(v));
const inputSchema = z.strictObject({ threadId: id, runId: id, protocolVersion: z.literal("1.0").optional(), messages: z.array(z.unknown()).min(1).max(128), tools: z.array(z.unknown()).max(0), context: z.array(z.unknown()).max(0), state: z.record(z.string(), z.unknown()), forwardedProps: z.record(z.string(), z.unknown()).optional() });
type Turn = { user: string; assistant: string };
export type RuntimeOptions = Partial<NativeOptions> & { outputRoot?: string; writer?: (receipt: Receipt) => void };
export class Runtime {
  readonly histories = new Map<string, Turn[]>();
  readonly attempted = new Set<string>();
  readonly active = new Map<string, { controller: AbortController; drained: Promise<void> }>();
  closed = false;
  constructor(readonly workspace: Workspace, readonly options: RuntimeOptions = {}) {}
  async run(value: unknown, signal?: AbortSignal) {
    const input = inputSchema.parse(value);
    if (Buffer.byteLength(JSON.stringify(value)) > 262144) throw new Error("retained AG-UI request exceeds limit");
    const last: any = input.messages.at(-1);
    if (!last || last.role !== "user" || typeof last.content !== "string" || !last.content.trim() || last.content.length > 8000) throw new Error("latest genuine request must be nonblank user text within 8000 characters");
    if (this.closed || this.active.size >= 4 || this.active.has(input.threadId) || this.attempted.has(input.runId) || this.attempted.size >= 512 || !this.histories.has(input.threadId) && this.histories.size >= 32) throw new Error("runtime is closed, busy or run/thread budget exhausted");
    const timeoutMs = this.options.timeoutMs ?? 120000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) throw new Error("operation budget must be 10..300000 ms");
    this.attempted.add(input.runId);
    const history = this.histories.get(input.threadId) ?? [];
    this.histories.set(input.threadId, history);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason ?? new Error("incident request cancelled"));
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    let settle!: () => void;
    const drained = new Promise<void>(resolve => { settle = resolve; });
    this.active.set(input.threadId, { controller, drained });
    const deadline = performance.now() + timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error("incident operation deadline exceeded")), timeoutMs);
    let receipt: Receipt | undefined, native: Native | undefined, mastra: Mastra | undefined, result: any, failure: unknown;
    let mastraCloseAttempted = false;
    try {
      receipt = new Receipt(this.options.outputRoot ?? join(dirname(this.workspace.file), "runs"), { threadId: input.threadId, clientRunId: input.runId, task: last.content, sdk: [], initialState: null, finalState: null, lifecycle: { mastraClosed: false, httpClosed: false }, delivery: "events prepared; client delivery is not acknowledged", dependencies: { mastra: "1.77.0", anthropic: "3.0.103", undici: "7.30.1", agui: "2.0.1", node: process.version }, limits: { preparedRequests: 8, requestedOutput: 2048, retries: 0, operationMs: timeoutMs, httpMs: 30000 } });
      if (this.options.writer) { const original = receipt.save.bind(receipt); const writer = this.options.writer; receipt.save = () => { try { writer(receipt!); original(); } catch (e) { receipt!.recordingError = e; throw e; } }; }
      const initial = this.workspace.snapshot(); receipt.data.initialState = { sha256: initial.digest, bodyBase64: initial.bytes.toString("base64"), instanceId: initial.state.instance_id ?? null }; receipt.save();
      native = new Native({ ...this.options, model: this.options.model ?? process.env.INCIDENT_MODEL ?? "" }, receipt, this.workspace, controller.signal, deadline);
      const owner = native, evidence = receipt;
      const model = owner.model();
      const consumed = new Set<string>(); let active: Record<string, any> | undefined;
      const toolOwner: ToolOwner = {
        before(name, args) {
          try {
            owner.guard(); const accepted = evidence.data.calls.at(-1)?.accepted;
            if (active || !accepted || accepted.kind !== "tool" || accepted.name !== name || !same(accepted.args, args) || consumed.has(accepted.id)) throw new Error("tool lacks original accepted provider authority");
            if (name !== "readWorkspace" && !toolOwner.readSource) throw new Error("incident workspace must be read before proposing");
            consumed.add(accepted.id); active = { name, args: structuredClone(args), originalCallId: accepted.id, status: "prepared", sourceSha256: owner.workspace.snapshot().digest }; evidence.data.actions.push(active); evidence.save(); owner.guard();
          } catch (e) { owner.failure = owner.failure ?? e; throw e; }
        },
        after(name, args, outcome, readSource?: Source) {
          try {
            owner.guard(); if (!active || active.name !== name || !same(active.args, args)) throw new Error("unmatched tool completion");
            const current = owner.workspace.snapshot(); Object.assign(active, { status: "finished", result: structuredClone(outcome), stateSha256After: current.digest, stateBodyBase64After: current.bytes.toString("base64") });
            if (readSource) toolOwner.readSource = structuredClone(readSource);
            evidence.save(); active = undefined; owner.guard();
          } catch (e) { owner.failure = owner.failure ?? e; throw e; }
        },
      };
      const agent = createIncidentAgent(this.workspace, model as never, toolOwner, controller.signal);
      mastra = new Mastra({ agents: { incidentAgent: agent }, logger: noopLogger });
      const bridge = MastraAgent.getLocalAgent({ mastra, agentId: "incidentAgent", resourceId: randomUUID() });
      bridge.threadId = randomUUID();
      for (const turn of history) { bridge.addMessage({ id: randomUUID(), role: "user", content: turn.user }); bridge.addMessage({ id: randomUUID(), role: "assistant", content: turn.assistant }); }
      bridge.addMessage({ id: randomUUID(), role: "user", content: last.content });
      const cancelBridge = () => bridge.abortRun(); controller.signal.addEventListener("abort", cancelBridge, { once: true });
      const events: any[] = []; let eventBytes = 0;
      receipt.data.status = "running"; receipt.save(); owner.guard();
      try { await bridge.runAgent({ runId: randomUUID() }, { onEvent: ({ event }) => {
        try {
          eventBytes += Buffer.byteLength(JSON.stringify(event)); if (eventBytes > 2097152 || events.length >= 512) throw new Error("retained AG-UI event budget exhausted");
          events.push(structuredClone(event)); evidence.data.protocolPrepared = events; evidence.save(); owner.guard();
        } catch (e) { owner.failure = owner.failure ?? e; controller.abort(e); }
      } }); } finally { controller.signal.removeEventListener("abort", cancelBridge); }
      owner.guard();
      const final = receipt.data.calls.at(-1)?.accepted;
      const contents = events.filter(e => e.type === "TEXT_MESSAGE_CONTENT");
      const starts = events.filter(e => e.type === "TEXT_MESSAGE_START"), ends = events.filter(e => e.type === "TEXT_MESSAGE_END");
      if (starts.length !== 1 || ends.length !== 1 || starts[0].messageId !== ends[0].messageId || contents.some(e => e.messageId !== starts[0].messageId)) throw new Error("official final text translation is incomplete");
      if (events.filter(e => e.type === "RUN_STARTED").length !== 1 || events.filter(e => e.type === "RUN_FINISHED").length !== 1 || events.some(e => e.type === "RUN_ERROR") || events.at(-1)?.type !== "RUN_FINISHED" || final?.kind !== "answer" || contents.map(e => e.delta).join("") !== final.text || active) throw new Error("official AG-UI bridge did not finish the exact accepted final answer");
      result = { answer: final.text, events: events.map(e => e.type === "RUN_STARTED" || e.type === "RUN_FINISHED" ? { ...e, threadId: input.threadId, runId: input.runId } : e), receiptPath: receipt.path };
    } catch (e) { failure = controller.signal.aborted ? controller.signal.reason : native?.failure ?? e; }
    finally {
      if (native && !native.closeAttempted) {
        try { await native.close(); if (receipt) receipt.data.lifecycle.httpClosed = true; } catch (e) { failure = failure ?? e; }
      } else if (!native && receipt) receipt.data.lifecycle.httpClosed = true;
      if (mastra) {
        mastraCloseAttempted = true;
        try { await mastra.shutdown({ drainTimeout: 0 }); if (receipt) receipt.data.lifecycle.mastraClosed = true; } catch (e) { failure = failure ?? e; }
      } else if (receipt) receipt.data.lifecycle.mastraClosed = true;
      if (receipt) {
        try {
          if (!failure) native!.guard();
          const final = this.workspace.snapshot(); receipt.data.finalState = { sha256: final.digest, bodyBase64: final.bytes.toString("base64") };
          if (!failure) {
            result.state = business(final.state);
            result.events = [...result.events.slice(0, -1), { type: "STATE_SNAPSHOT", snapshot: result.state }, result.events.at(-1)];
            receipt.data.clientProtocolPrepared = structuredClone(result.events);
            receipt.data.result = { answer: result.answer, state: result.state };
          }
        } catch (e) { receipt.data.finalSourceError = errorInfo(e); failure = failure ?? e; }
        receipt.data.status = failure ? "failed" : "completed"; receipt.data.error = failure ? errorInfo(failure) : null;
        receipt.data.cleanupConfirmed = receipt.data.lifecycle.mastraClosed && receipt.data.lifecycle.httpClosed;
        receipt.data.mastraCloseAttempted = mastraCloseAttempted; receipt.data.reportedUsage = summarize(receipt.data.calls); receipt.data.finishedAt = new Date().toISOString();
        if (failure) receipt.data.result = null;
        try { receipt.save(); } catch (e) { failure = failure ?? e; receipt.data.status = "failed"; receipt.data.result = null; receipt.data.durableStatus = "unknown"; }
      }
      clearTimeout(timer); signal?.removeEventListener("abort", abort); this.active.delete(input.threadId); settle();
    }
    if (failure) { const error = failure instanceof Error ? failure : new Error(String(failure)); Object.assign(error, { receiptPath: receipt?.path, evidence: receipt?.data }); throw error; }
    this.histories.set(input.threadId, [...history, { user: last.content, assistant: result.answer }].slice(-8));
    return result;
  }
  async close() { this.closed = true; const running = [...this.active.values()]; for (const run of running) run.controller.abort(new Error("incident runtime shutdown")); await Promise.all(running.map(run => run.drained)); this.histories.clear(); }
}
