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

Approved updates appear in the timeline and one local `#inc-checkout` mirror post with exact evidence IDs and owner. No external Slack or service is contacted. Current writes use a persistent SQLite mutex to serialize cooperating local processes, exact source/instance rechecks and atomic replacement. Uncooperative filesystem writers remain outside an OS boundary; legacy state without an instance UUID has no cross-reset guarantee. Do not unlink the mutex while processes may still use it. Rich exclusive reset/initialization remains planned.

All 17 backend checks cover incident evidence/authorization, the actual HTTP/AG-UI bridge, parser compatibility, synchronous partial JSON, legacy schema validation and bounded response reads. The 11 frontend dependency checks also verify accessible math output and inherited trust settings. Both full npm audits report zero findings at the 2026-10-15 snapshot. A production-only backend install/import was also verified without the test clients.

Two automated Chromium cases run the production-built Next.js application through CopilotKit, the real remote AG-UI bridge, Mastra's SDK loop and application tools/API. They verify proposal-only behavior, exact approval effects, styled math, unsafe-HTML removal, visible provider failure and a subsequent recovery request. Chat waits for agent discovery before accepting input; errors remain visible until a new run starts. Scripted models live only in the test host. These checks prove transport and application behavior, not live Anthropic judgment. Live model proof, the new Firedrill integration and publication/license decisions remain pending.

### Reproduce browser verification

Install both backend and frontend dependencies first, then from the frontend directory:

```sh
npm run build --prefix ../backend
npx playwright install chromium
NEXT_PUBLIC_INCIDENT_API_URL=http://127.0.0.1:3826 COPILOTKIT_TELEMETRY_DISABLED=true npm run build
npm run test:e2e
```

The test runner owns local ports 3326/3426/3826 and resets `frontend/.e2e/workspace.json` before each case. It never resets a regular workspace. Screenshots/traces are written under `frontend/test-results/`; CI uploads synthetic browser evidence. Run an ordinary `npm run build` afterward to restore the normal API address. Custom UI origins can be configured with `INCIDENT_WEB_ORIGIN` on the workspace API.

Both install roots retain qualified, version-guarded postinstall repairs: argparse 2 for the legacy YAML CLI, and scoped provider-utils 3 for the old UI bridge's synchronous JSON/schema contracts. KaTeX 0.18.2 uses matching bundled styles; HTML is sanitized before math rendering while URL hardening remains enabled. See [backend/scripts/README.md](backend/scripts/README.md) and [frontend/scripts/README.md](frontend/scripts/README.md) for exact versions, attribution, contract checks and removal criteria. This remains a local synthetic application with no production server configuration.

Explore related applications in the [Firedrill example catalog](https://github.com/firedrill-tools/firedrill-example-catalog). Product and setup references: [Firedrill](https://firedrill.run/) and the [official developer documentation](https://docs.firedrill.run/). Use documentation matching the qualified release; this repository records its current integration limits above.


## Source/API development checkpoint

29 backend checks now include strict bounded incident/service/observation/proposal/decision/update/post/audit contracts and original duplicate/nonfinite/UTF-8 JSON rejection. Saved proposal recipient/summary/evidence/source edits cannot change the immutable proposal hash. Approval requires exact current incident/service/evidence/policy equality and a separately captured commander decision. Current degraded or healthy metrics must support the proposed status; customer anecdotes cannot justify recovery. Stale rejection remains possible. Exact update/post/hash/channel/actor coherence and actual independent-process approval create one committed update and one local post. Boolean revisions, unknown API fields, unsupported source shapes, duplicate IDs, invalid authority, exhausted revisions and replaced UUID instances are rejected without repair. Previously saved unbound proposals are not migrated implicitly. Fixture commander/monitor names are not real authentication.

This is an intermediate source checkpoint. Owned Anthropic native original completion/usage/lifecycle, normal remote AG-UI/CopilotKit production paths, broader UI error/outage behavior, rich source populations/private CLI and fresh complete distributions remain active in PLAN.md. Existing scripted SDK/browser checks do not prove live Anthropic behavior, billing or Firedrill integration. All external-input gates remain parked.
