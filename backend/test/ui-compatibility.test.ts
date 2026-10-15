import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
for (const consumerName of ["@ag-ui/mastra", "@mastra/client-js"]) {
  const consumer = createRequire(require.resolve(consumerName));
  const uiRequire = createRequire(consumer.resolve("@ai-sdk/ui-utils"));
  const directory = dirname(uiRequire.resolve("@ai-sdk/ui-utils/package.json"));
  const provider = uiRequire("@ai-sdk/provider-utils");
  for (const format of ["CommonJS", "ESM"]) {
    test(`${consumerName} ${format} preserves legacy IDs, partial JSON, schema validation and streaming`, async () => {
      const ui = format === "CommonJS" ? uiRequire("@ai-sdk/ui-utils") : await import(pathToFileURL(join(directory, "dist/index.mjs")).href);
      assert.equal(uiRequire("@ai-sdk/provider-utils/package.json").version, "3.0.30");
      const firstId = ui.generateId();
      assert.equal(typeof firstId, "string");
      assert.notEqual(firstId, ui.generateId());
      assert.deepEqual((ui.parsePartialJson('{"evidence":"OBS-1"}')).value, { evidence: "OBS-1" });
      assert.deepEqual((ui.parsePartialJson('{"evidence":"OBS-')).value, { evidence: "OBS-" });
      assert.equal((ui.parsePartialJson("not json")).value, undefined);
      assert.equal(ui.parsePartialJson('{"__proto__":{"synthetic":true}}').state, "failed-parse");
      assert.equal(ui.parsePartialJson('{"constructor":{"prototype":{"synthetic":true}}}').state, "failed-parse");
      const schema = ui.jsonSchema({ type: "object" }, { validate: (value: { evidence?: unknown }) => typeof value?.evidence === "string"
        ? { success: true, value } : { success: false, error: new Error("Evidence must be a string") } });
      assert.equal(provider.isValidator(schema), true);
      assert.equal((await provider.safeParseJSON({ text: '{"evidence":"OBS-1"}', schema })).success, true);
      assert.equal((await provider.safeParseJSON({ text: '{"evidence":7}', schema })).success, false);
      const parts: string[] = [];
      const bytes = new TextEncoder().encode(ui.formatDataStreamPart("text", "Evidence OBS-1"));
      await ui.processDataStream({ stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
        onTextPart: (text: string) => { parts.push(text); } });
      assert.deepEqual(parts, ["Evidence OBS-1"]);
    });
  }
  test(`${consumerName} uses bounded response readers for declared and streamed body sizes`, async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } }));
    await assert.rejects(provider.readResponseWithSizeLimit({ response, url: "https://synthetic.example/response", maxBytes: 16 }), /exceeded maximum size/i);
    assert.equal(cancelled, true);
    const oversized = new Response("{}", { headers: { "content-length": "2147483649" } });
    await assert.rejects(provider.createJsonResponseHandler(provider.validator((value: unknown) => ({ success: true, value })))({
      response: oversized, url: "https://synthetic.example/response", requestBodyValues: {},
    }), /exceeded maximum size/i);
  });
}
