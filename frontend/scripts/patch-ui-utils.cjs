// Retain the legacy schema marker and synchronous partial JSON contract.
// Installed upstream files retain their original Apache-2.0 attribution/license.
const { readFileSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");

const roots = new Set();
for (const consumerName of ["@ag-ui/mastra", "@mastra/client-js"]) {
  let entry;
  try { entry = require.resolve(consumerName); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") continue; throw error; }
  const consumer = createRequire(entry);
  const ui = createRequire(consumer.resolve("@ai-sdk/ui-utils"));
  const metadataPath = ui.resolve("@ai-sdk/ui-utils/package.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const provider = ui("@ai-sdk/provider-utils/package.json");
  if (metadata.version !== "1.2.11" || provider.version !== "3.0.30") {
    throw new Error("Requalify the legacy UI marker repair for these dependency versions");
  }
  roots.add(dirname(metadataPath));
}
if (roots.size) {
  const parser = JSON.parse(readFileSync(join(dirname(require.resolve("secure-json-parse")), "package.json"), "utf8"));
  if (parser.version !== "4.1.1") throw new Error("Requalify the synchronous secure JSON parser for this version");
}

function repair(path, before, after) {
  const source = readFileSync(path, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Unexpected UI utilities source: ${path}`);
  writeFileSync(path, source.replace(before, after));
}
for (const root of roots) {
  repair(join(root, "dist/index.mjs"),
    'import { validatorSymbol } from "@ai-sdk/provider-utils";',
    'const validatorSymbol = Symbol.for("vercel.ai.validator"); // Legacy schema compatibility.');
  repair(join(root, "dist/index.js"),
    '[import_provider_utils4.validatorSymbol]: true,',
    '[Symbol.for("vercel.ai.validator")]: true, // Legacy schema compatibility.');
  repair(join(root, "dist/index.mjs"),
    'import { safeParseJSON } from "@ai-sdk/provider-utils";',
    'import secureJsonParse from "secure-json-parse";\n' +
    'function safeParseJSON({ text }) { // Preserve synchronous partial JSON parsing.\n' +
    '  try { return { success: true, value: secureJsonParse.parse(text) }; }\n' +
    '  catch (error) { return { success: false, error }; }\n' +
    '}');
  repair(join(root, "dist/index.js"),
    'var import_provider_utils = require("@ai-sdk/provider-utils");',
    'var import_provider_utils = { safeParseJSON({ text }) { // Preserve synchronous partial JSON parsing.\n' +
    '  try { return { success: true, value: require("secure-json-parse").parse(text) }; }\n' +
    '  catch (error) { return { success: false, error }; }\n' +
    '} };');
}
