import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { Agent as HTTPAgent, fetch as httpFetch } from "undici";
import { z } from "zod";
import { proposalInput, same } from "./schema.js";
import { parseJSON, type Workspace } from "./state.js";
import { Receipt, sha256, usageOf, errorInfo } from "./evidence.js";

export const REQUEST_LIMIT = 8;
export const OUTPUT_LIMIT = 2048;
const toolArguments = {
  readWorkspace: z.strictObject({}),
  proposeUpdate: proposalInput,
};
export type NativeOptions = {
  model: string;
  apiKey?: string;
  baseURL?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export function config(options: NativeOptions) {
  if (!/^anthropic\/[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(options.model))
    throw new Error("model must use anthropic/<model> format");
  const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key || !/^[\x21-\x7e]{1,4096}$/.test(key))
    throw new Error("ANTHROPIC_API_KEY required; no model fallback");
  const url = new URL(options.baseURL ?? "https://api.anthropic.com/v1");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error(
      "endpoint requires HTTPS or owned loopback HTTP, without credentials/query/fragment",
    );
  return {
    key,
    baseURL: url.href.replace(/\/$/, ""),
    modelId: options.model.slice(10),
  };
}
function object(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function nonblank(v: unknown): v is string {
  return typeof v === "string" && !!v.trim() && v.length <= 240;
}
export class Native {
  readonly dispatcher = new HTTPAgent({
    connect: { timeout: 30_000 },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
    connections: 1,
    pipelining: 1,
  });
  readonly calls = new Set<string>();
  readonly pending = new Set<Promise<unknown>>();
  closed = false;
  closeAttempted = false;
  failure: unknown;
  constructor(
    readonly options: NativeOptions,
    readonly receipt: Receipt,
    readonly workspace: Workspace,
    readonly signal: AbortSignal,
    readonly deadline: number,
  ) {}
  guard() {
    if (this.failure) throw this.failure;
    if (this.receipt.recordingError) throw this.receipt.recordingError;
    this.signal.throwIfAborted();
    if (performance.now() >= this.deadline)
      throw new Error("incident operation deadline exceeded");
    this.workspace.snapshot();
    this.signal.throwIfAborted();
    if (performance.now() >= this.deadline)
      throw new Error("incident operation deadline exceeded");
  }
  model() {
    const c = config(this.options);
    const ownedFetch: typeof globalThis.fetch = async (input, init) => {
      this.guard();
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (url.href !== `${c.baseURL}/messages` || init?.method !== "POST")
        throw new Error("unqualified provider request");
      if (this.receipt.data.calls.length >= REQUEST_LIMIT)
        throw new Error("prepared provider request budget exhausted");
      const requestBody = String(init?.body ?? "");
      if (Buffer.byteLength(requestBody) > 2_097_152)
        throw new Error("provider request exceeds decoded size limit");
      const request: any = parseJSON(requestBody);
      if (
        request.stream ||
        request.model !== c.modelId ||
        request.max_tokens !== OUTPUT_LIMIT
      )
        throw new Error("unqualified native request settings");
      const call: Record<string, any> = {
        number: this.receipt.data.calls.length + 1,
        status: "prepared",
        preparedAt: new Date().toISOString(),
        method: "POST",
        endpointOrigin: url.origin,
        path: url.pathname,
        requestBody: request,
        requestSha256: sha256(requestBody),
        requestBytes: Buffer.byteLength(requestBody),
        requestedModel: c.modelId,
        reportedUsage: usageOf(null),
      };
      this.receipt.data.calls.push(call);
      this.receipt.save();
      this.guard();
      const phase = AbortSignal.timeout(
        Math.min(
          30_000,
          Math.max(1, Math.ceil(this.deadline - performance.now())),
        ),
      );
      const signal = AbortSignal.any([
        this.signal,
        phase,
        ...(init?.signal ? [init.signal] : []),
      ]);
      const chunks: Uint8Array[] = []; let count = 0;
      let responseMetadata: Record<string, unknown> | undefined;
      try {
        call.dispatchedAt = new Date().toISOString();
        call.status = "dispatched";
        this.receipt.save();
        this.guard();
        const response = await httpFetch(url, {
          method: "POST",
          body: requestBody,
          headers: {
            "content-type": "application/json",
            "x-api-key": c.key,
            "anthropic-version": "2023-06-01",
          },
          dispatcher: this.dispatcher,
          signal,
          redirect: "manual",
        });
        responseMetadata = { status: response.status, contentType: response.headers.get("content-type"), requestId: response.headers.get("x-request-id") };
        const reader = response.body?.getReader();
        try {
          if (reader)
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              const remaining = Math.max(0, 1_048_576 - count);
              chunks.push(next.value.slice(0, remaining));
              count += next.value.length;
              if (count > 1_048_576) {
                await reader.cancel();
                throw new Error(
                  "provider decoded response exceeds retained limit",
                );
              }
            }
        } finally {
          reader?.releaseLock();
        }
        const bytes = Buffer.concat(chunks);
        call.response = {
          complete: true,
          status: response.status,
          contentType: response.headers.get("content-type"),
          requestId: response.headers.get("x-request-id"),
          bytes: bytes.length,
          bodyBase64: bytes.toString("base64"),
          bodySha256: sha256(bytes),
          body: null,
        };
        let body: unknown;
        try {
          body = parseJSON(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
        } catch (e) {
          call.parseError = errorInfo(e);
          this.receipt.save();
          throw e;
        }
        call.response.body = body;
        call.reportedUsage = usageOf(body);
        call.status = "received";
        this.receipt.save();
        this.guard();
        if (response.status !== 200)
          throw new Error(`provider HTTP ${response.status}`);
        call.accepted = this.validate(body);
        call.status = "accepted";
        call.finishedAt = new Date().toISOString();
        this.receipt.save();
        this.guard();
        return new Response(bytes, {
          status: response.status,
          headers: {
            "content-type": "application/json",
            ...(response.headers.get("x-request-id")
              ? { "x-request-id": response.headers.get("x-request-id")! }
              : {}),
          },
        });
      } catch (e) {
        this.failure = this.failure ?? e;
        if (!call.response && responseMetadata) {
          const retained = Buffer.concat(chunks);
          call.response = { ...responseMetadata, complete: false, decodedBytesAtLeast: count, retainedBytes: retained.length, bodyBase64: retained.toString("base64"), retainedSha256: sha256(retained), bodySha256: null, body: null };
        }
        call.status = "failed";
        call.error = errorInfo(e);
        call.finishedAt = new Date().toISOString();
        try {
          this.receipt.save();
        } catch {}
        throw e;
      }
    };
    const sdk = createAnthropic({ apiKey: c.key, baseURL: c.baseURL, fetch: ownedFetch })(c.modelId);
    const generate: LanguageModelV3["doGenerate"] = options => {
      const operation = (async () => {
      const result = await sdk.doGenerate(options);
      this.guard();
      const accepted = this.receipt.data.calls.at(-1)?.accepted;
      const tools = result.content.filter(p => p.type === "tool-call");
      const text = result.content.filter(p => p.type === "text").map(p => p.text).join("");
      if (!accepted || (accepted.kind === "answer" ? tools.length !== 0 || text !== accepted.text || result.finishReason.unified !== "stop" :
        tools.length !== 1 || text.trim() || tools[0].toolCallId !== accepted.id || tools[0].toolName !== accepted.name || !same(parseJSON(tools[0].input), accepted.args) || result.finishReason.unified !== "tool-calls")) {
        this.failure = new Error("SDK normalization differs from accepted original Messages response"); throw this.failure;
      }
      this.receipt.data.sdk.push({ source: "actual Anthropic SDK normalized observations", content: result.content, finishReason: result.finishReason, usage: result.usage, providerMetadata: result.providerMetadata ?? null });
      this.receipt.save(); this.guard();
      return result;
      })();
      this.pending.add(operation);
      operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
      return operation;
    };
    // Public LanguageModelV3 adapter: each original JSON turn is completely
    // qualified before the official Mastra stream consumes normalized parts.
    // This does not claim native incremental Anthropic SSE delivery.
    const model: LanguageModelV3 = {
      specificationVersion: "v3", provider: sdk.provider, modelId: sdk.modelId, supportedUrls: sdk.supportedUrls,
      doGenerate: generate,
      doStream: async options => {
        const result = await generate(options);
        return { request: result.request, response: result.response, stream: new ReadableStream({ start: controller => {
          try {
            this.guard(); controller.enqueue({ type: "stream-start", warnings: result.warnings });
            if (result.response) controller.enqueue({ type: "response-metadata", ...result.response });
            for (const [index, part] of result.content.entries()) {
              if (part.type === "text") { const id = `text-${index}`; controller.enqueue({ type: "text-start", id }); controller.enqueue({ type: "text-delta", id, delta: part.text }); controller.enqueue({ type: "text-end", id }); }
              else if (part.type === "tool-call") controller.enqueue(part);
              else throw new Error("unsupported normalized Anthropic content");
            }
            controller.enqueue({ type: "finish", finishReason: result.finishReason, usage: result.usage, providerMetadata: result.providerMetadata }); controller.close();
          } catch (e) { this.failure = this.failure ?? e; controller.error(e); }
        } }) };
      },
    };
    return model;
  }
  validate(body: unknown) {
    if (!object(body) || !nonblank(body.id) || !nonblank(body.model) || body.type !== "message" || body.role !== "assistant" || body.error || body.stop_sequence != null || !["end_turn", "tool_use"].includes(body.stop_reason) || !Array.isArray(body.content) || !body.content.length || body.content.length > 16) throw new Error("provider response is not a coherent completed Messages result");
    const tools: Record<string, any>[] = []; let text = "";
    for (const part of body.content) {
      if (!object(part)) throw new Error("invalid original content");
      if (part.type === "tool_use") {
        if (!nonblank(part.id) || !nonblank(part.name) || !Object.hasOwn(toolArguments, part.name) || !object(part.input)) throw new Error("unsupported original tool");
        tools.push(part);
      } else if (part.type === "text" && typeof part.text === "string") text += part.text;
      else throw new Error("unsupported/refused original Messages content");
    }
    if (tools.length) {
      if (body.stop_reason !== "tool_use" || tools.length !== 1 || text.trim() || this.receipt.data.calls.length >= REQUEST_LIMIT) throw new Error("mixed/parallel/unfinished or budget-exhausted tool response");
      const tool = tools[0]; if (this.calls.has(tool.id)) throw new Error("replayed original tool ID");
      const args = toolArguments[tool.name as keyof typeof toolArguments].parse(tool.input);
      this.calls.add(tool.id); return { kind: "tool", id: tool.id, name: tool.name, args };
    }
    if (body.stop_reason !== "end_turn" || !text.trim()) throw new Error("no completed original final answer");
    return { kind: "answer", text };
  }
  async close() {
    if (this.closeAttempted) throw new Error("native transport close already attempted");
    this.closeAttempted = true;
    let failure: unknown;
    try { await this.dispatcher.destroy(); } catch (e) { failure = e; }
    await Promise.allSettled([...this.pending]);
    if (failure) throw failure;
    this.closed = true;
  }
}
