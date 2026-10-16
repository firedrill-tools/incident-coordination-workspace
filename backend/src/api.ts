import express from "express";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Conflict, Workspace, parseJSON } from "./state.js";
import { EventEncoder } from "@ag-ui/encoder";
import { Runtime, type RuntimeOptions } from "./runtime.js";
import { decisionInput, observationInput } from "./schema.js";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const file = process.env.INCIDENT_WORKSPACE_FILE || path.join(root, "..", "workspace.json");
export function createApp(stateFile = file, webOrigin = process.env.INCIDENT_WEB_ORIGIN || "http://localhost:3000", runtimeOptions: RuntimeOptions = {}, includeAgent = true) {
  const workspace = new Workspace(stateFile);
  const app = express();
  const runtime = includeAgent ? new Runtime(workspace, runtimeOptions) : null;
  app.locals.runtime = runtime;
  app.use((_req, res, next) => { res.setHeader("Access-Control-Allow-Origin", webOrigin); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); next(); });
  app.options("/{*path}", (_req, res) => res.sendStatus(204));
  app.use(express.raw({ type: "application/json", limit: "1mb" }));
  app.use((req, res, next) => {
    if (Buffer.isBuffer(req.body)) {
      try { req.body = parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(req.body)); }
      catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid JSON" }); return; }
    }
    next();
  });
  if (runtime) app.post("/agent", async (req, res) => {
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(new Error("incident client disconnected")); };
    res.once("close", disconnected);
    const encoder = new EventEncoder({ accept: req.headers.accept });
    try {
      const result = await runtime.run(req.body, controller.signal);
      if (res.destroyed) return;
      const events = result.events;
      res.setHeader("Content-Type", encoder.getContentType()); res.setHeader("Cache-Control", "no-cache");
      for (const event of events) res.write(encoder.encode(event));
      res.end();
    } catch (error) {
      if (res.destroyed) return;
      const message = error instanceof Error ? error.message : String(error);
      if (!(error as any)?.evidence) { res.status(409).json({ error: message }); return; }
      res.setHeader("Content-Type", encoder.getContentType()); res.setHeader("Cache-Control", "no-cache");
      res.end(encoder.encode({ type: "RUN_ERROR", message, code: "INCIDENT_FAILED" } as never));
    } finally { res.removeListener("close", disconnected); }
  });
  app.get("/workspace", (_req, res) => res.json(workspace.read()));
  app.post("/proposals/:id/decision", (req, res) => {
    const input = decisionInput.safeParse(req.body);
    if (!input.success) { res.status(422).json({ error: "Expected exact revision, decision and actor with no extra fields" }); return; }
    try { res.json(workspace.decide(req.params.id, input.data.revision, input.data.decision, input.data.actor)); }
    catch (error) { res.status(error instanceof Conflict ? 409 : 422).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post("/observations", (req, res) => {
    const input = observationInput.safeParse(req.body);
    if (!input.success) { res.status(422).json({ error: "Expected exact status, text and actor with no extra fields" }); return; }
    try { res.json(workspace.observe(input.data.status, input.data.text, "metrics", input.data.actor)); }
    catch (error) { res.status(error instanceof Conflict ? 409 : 422).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 413 ? 413 : 422).json({ error: error.message });
  });
  return app;
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Let this module finish before the CLI imports createApp back from it.
  import("./cli.js").then(({ main }) => main()).catch(error => { console.error(error); process.exitCode = 1; });
}
