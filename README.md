# Incident coordination workspace

A CopilotKit interface for a fictional checkout incident. A Mastra agent reads the current incident, service telemetry, customer reports, and synthetic Slack history, then proposes an evidence-backed status or owner update. A commander reviews the proposal. Approval changes the incident and writes a matching local channel post; rejection leaves both unchanged.

## Run locally

Requires Node 22.13+ and npm.

```sh
cp fixtures/starter.json workspace.json
cd backend
npm ci
npm test
npm run api
```

Start `npm run agent` in another backend terminal. For live chat, set `ANTHROPIC_API_KEY` and an enabled `INCIDENT_MODEL` such as `anthropic/<model>`. Then start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. The Next.js CopilotKit runtime connects to Mastra's local agent service at `http://127.0.0.1:4111`; the workspace UI reads the separate local API at `http://localhost:8126`. `npm run agent` hosts the official Mastra HTTP API with [`@mastra/express`](https://mastra.ai/reference/server/express-adapter), bound to loopback. It does not require Mastra Studio or the development CLI. Rebuild the backend after editing its source. Without a provider key, the workspace and approval flow still work, but chat cannot complete a live model call. There is no fake model fallback.

## Evidence and decisions

The starter includes degraded checkout metrics (`OBS-1`) and a single customer's recovery report (`OBS-2`). A customer report cannot justify `monitoring` or `resolved`. The latest observation must be healthy **metrics** and cited by the proposal. The UI's “Simulate healthy metrics” button appends a local telemetry record and changes the service revision. Every proposal records incident and service revisions. If either changes before decision, approval stops as stale. Only the synthetic commander `Morgan` can decide; this name is a local fixture identity, not production authentication.

Approved updates appear in the timeline and one local `#inc-checkout` mirror post with exact evidence IDs and owner. No external Slack or service is contacted. State is a one-process JSON demo, not a concurrent operations system. Reset from `fixtures/starter.json`.

All 11 backend checks cover conflicting status, evidence, escalation, ownership, stale service state, rejection and committed API state, plus parser compatibility and the actual HTTP/AG-UI bridge used by CopilotKit. A scripted Mastra model reads the workspace, proposes an update and streams a terminal answer; its proposal cannot change incident status, owner or local channel posts. A scripted provider failure reaches the bridge as an error without successful completion or state changes. These models are injected only by tests. Frontend typecheck/build, three dependency-contract checks (`npm run test:dependencies`) and the previously recorded local browser flow cover presentation, installation and approval. These tests do not prove live Anthropic judgment. Live model proof and the new Firedrill integration remain pending. This private repository has no license pending publication decisions.

Both backend and frontend use a scoped argparse override with a guarded install-time repair to remove `sprintf-js` while retaining js-yaml's legacy CLI contract. See [backend/scripts/README.md](backend/scripts/README.md) and [frontend/scripts/README.md](frontend/scripts/README.md). The Express adapter removes the unused developer CLI/workspace-globber chain, including `braces`. At the 2026-10-15 snapshot, the backend runtime audit has zero findings. The full backend audit reports four low findings through test-only AG-UI/client dependencies; the frontend reports eleven low findings through older AI SDK utilities and KaTeX consumers. There are no remaining moderate/high findings in either install. These low findings remain technical follow-up, and the application has no production-facing server configuration.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
