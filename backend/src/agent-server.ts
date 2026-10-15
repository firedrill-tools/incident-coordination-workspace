import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import express from "express";
import type { Mastra } from "@mastra/core/mastra";
import { MastraServer } from "@mastra/express";

// Keep the official Mastra HTTP API consumed by @mastra/client-js / AG-UI.
// This host does not need the development CLI or its workspace globber.
export async function createAgentApp(mastra: Mastra) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const server = new MastraServer({ app, mastra });
  await server.init();
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { mastra } = await import("./mastra/index.js");
  const app = await createAgentApp(mastra);
  app.listen(4111, "127.0.0.1", () => console.log("Mastra agent API: http://127.0.0.1:4111"));
}
