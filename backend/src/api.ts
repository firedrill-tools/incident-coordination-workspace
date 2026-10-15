import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Conflict, Workspace } from "./state.js";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const file = process.env.INCIDENT_WORKSPACE_FILE || path.join(root, "..", "workspace.json");
export function createApp(stateFile = file) {
  const workspace = new Workspace(stateFile);
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000"); res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type"); next(); });
  app.options("/{*path}", (_req, res) => res.sendStatus(204));
  app.get("/workspace", (_req, res) => res.json(workspace.read()));
  app.post("/proposals/:id/decision", (req, res) => {
    try { res.json(workspace.decide(req.params.id, req.body.revision, req.body.decision, req.body.actor)); }
    catch (error) { res.status(error instanceof Conflict ? 409 : 500).json({ error: String(error instanceof Error ? error.message : error) }); }
  });
  app.post("/observations", (req, res) => {
    try {
      if (req.body.actor !== "monitor") throw new Conflict("monitor_required");
      res.json(workspace.observe(req.body.status, req.body.text));
    } catch (error) { res.status(error instanceof Conflict ? 409 : 500).json({ error: String(error instanceof Error ? error.message : error) }); }
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(8126, "127.0.0.1", () => console.log("Incident API on http://127.0.0.1:8126"));
}
