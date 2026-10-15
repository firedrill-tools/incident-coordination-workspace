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

Open `http://localhost:3000`. The Next.js CopilotKit runtime connects to Mastra's local agent service at `http://127.0.0.1:4111`; the workspace UI reads the separate local API at `http://localhost:8126`. Without a provider key, the workspace and approval flow still work, but chat cannot complete a live model call. There is no fake model fallback.

## Evidence and decisions

The starter includes degraded checkout metrics (`OBS-1`) and a single customer's recovery report (`OBS-2`). A customer report cannot justify `monitoring` or `resolved`. The latest observation must be healthy **metrics** and cited by the proposal. The UI's “Simulate healthy metrics” button appends a local telemetry record and changes the service revision. Every proposal records incident and service revisions. If either changes before decision, approval stops as stale. Only the synthetic commander `Morgan` can decide; this name is a local fixture identity, not production authentication.

Approved updates appear in the timeline and one local `#inc-checkout` mirror post with exact evidence IDs and owner. No external Slack or service is contacted. State is a one-process JSON demo, not a concurrent operations system. Reset from `fixtures/starter.json`.

Backend tests cover conflicting status, evidence, escalation, ownership, stale service state, rejection and committed API state. Frontend typecheck/build and a local browser flow cover presentation and approval. These tests do not prove live Anthropic judgment. Live model proof and the new Firedrill integration remain pending. This private repository has no license pending publication decisions.

`npm audit` still reports transitive advisories in Mastra/CopilotKit dependencies, including a high-severity `braces` issue in the local Mastra CLI dependency tree. Review updated upstream packages before public deployment. The application has no production-facing server configuration.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.
