# Incident coordination workspace with CopilotKit, Mastra and Next.js

A Next.js/CopilotKit workspace and Mastra/Anthropic agent coordinate fictional incidents using current telemetry, customer reports and a synthetic Slack mirror. Chat can read and propose a status/owner/summary backed by exact evidence. A separate commander decision changes the incident and records one matching local channel post. No external Slack or service-status provider is connected; commander/monitor names are fixture identities without real authentication.

This example repository is publicly viewable. A project license has not been selected.

## Simulate with Firedrill

[Firedrill](https://firedrill.run/) is a simulation platform for AI agents.
Start from this repository’s root:

```sh
npx firedrill-run init
```

Sign in and choose your project, then follow the [simulation run guide](firedrill/README.md)
for application dependencies, a preview and the reviewed scenarios. Your agent runs
locally or in your CI; model credentials stay separate from Firedrill sign-in.
The included recipes record outcomes without an automatic quality score or CI gate.

## Run locally

Node22.13+ and npm are required. Model-free initialization, workspace review and commander decisions need no key.

```sh
cd backend
npm ci
npm run build
node dist/src/cli.js datasets
node dist/src/cli.js init --workspace run-output/workspace.json --case conflicting-report
node dist/src/cli.js serve --workspace run-output/workspace.json --offline
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. For actual chat, set ANTHROPIC_API_KEY and an enabled INCIDENT_MODEL using anthropic/<model>, then omit --offline. Explicit --model overrides that variable; --base-url accepts an explicit HTTPS or owned loopback Messages URL for controlled qualification. Ambient ANTHROPIC_BASE_URL is not borrowed. No key/model fallback exists; missing configuration produces private failed evidence. `.env.example` lists variables; export backend variables yourself. No paid provider was used in qualification.

The one backend API serves committed workspace data and owned `/agent` chat. CopilotKit's actual HttpAgent points at INCIDENT_AGENT_URL, default http://127.0.0.1:8126/agent. NEXT_PUBLIC_INCIDENT_API_URL is baked at frontend build time; normal default is http://localhost:8126 and CORS defaults to http://localhost:3000. `npm run api` serves default run-output/workspace.json; npm run agent is an alias. Run one process. --port0 requests an ephemeral loopback port. The old generic Mastra remote HTTP host remains a scripted compatibility fixture without a native production entry point.

## Data and separate decisions

`backend/data/index.json` pins incident-populations1.0.0 with twelve starter/busy/ambiguous/boundary cases. Busy has10observations/100proposals/64updates/64matchinglocalposts/24pending/12rejected. Other cases cover conflicting reports/metrics, healthy monitoring, alternate commander/channel, stale or missing evidence, already resolved state, hostile/Unicode text and maximum safe revision. Ordered imported audit describes the original seed; subsequent valid changes are current state. Prior model/authentication/real Slack evidence stays unknown. Dataset/task/provenance labels and proposal authority hashes are excluded from model business context.

```sh
node backend/dist/src/cli.js workspace --workspace backend/run-output/workspace.json
node backend/dist/src/cli.js reset --workspace backend/run-output/workspace.json --destination backend/run-output/fresh.json
```

Initialization creates exclusive0600 source/metadata with a fresh UUID. Reset preserves the old source, metadata, mutex and evidence at a distinct destination. Collisions and corrupt/missing/foreign authority reject without repair. Two-file initialization is not atomic; an interrupted partial destination remains untouched and needs a fresh path. Legacy original fixtures without UUID lack cross-reset guarantees.

Strict bounded schemas and original ambiguous JSON rejection protect incident/service/observation/proposal/decision/update/post/audit. Each proposal hashes its exact payload and complete incident/service/evidence/policy source. Separate commander decisions capture that hash/revision and current source; approval rechecks full equality and current telemetry before one exact update/post. Customer anecdotes cannot establish recovery; latest healthy metrics must be cited. Escalation cites current degraded metrics. Stale rejection remains possible. Persistent SQLite mutexes serialize cooperating local processes, with exact source/inode/instance checks and atomic replacement. Uncooperative writers are outside an OS boundary; do not unlink an active mutex. Previously saved unbound proposals are not migrated.

The UI follows committed API state, derives commander/channel from source, surfaces readable errors, blocks writes while reads are unavailable and prevents late reads replacing confirmed actions. Search and bounded evidence/review/timeline/channel lists handle imported history. Native Send/Stop uses public accessible slots. Markdown is sanitized before trusted KaTeX0.18.2 rendering, with URL hardening retained.

## Owned native runtime and evidence

Each operation owns a fresh actual Mastra1.77 agent/official local MastraAgent2.0.1 bridge and explicit Anthropic3.0.103 SDK/Undici7.30.1 transport. Original Messages JSON must finish with end_turn text or one strict tool_use call before SDK dispatch. Unfinished/refused/parallel/mixed/replayed/unknown results cannot save proposals. A genuine current read precedes a proposal. Model tools cannot approve or post. Caller assistant/state/tools/context cannot create server history or authority.

The public LanguageModelV3 adapter feeds each completely qualified native JSON turn into Mastra's official stream; native incremental Anthropic SSE is not claimed. The API retains events until exact final text, current state after cleanup, evidence and awaited owned SDK calls/HTTP/Mastra shutdown are verified. It then emits actual AG-UI with EventEncoder. Prepared delivery is not client acknowledgement. Partial proposals remain pending after later failure.

Budgets:8prepared calls/2048requested output/zero retry/30-second HTTP/120-second default operation;4active runs/32threads/eight genuine completed turns/512attempt IDs. Failed or duplicate runs need a new explicit run ID. Private0700 UUID directories/0600 receipts keep original source bytes/hash, requests/responses/unknown fields/provider IDs/counters, separate normalized SDK observations, actual tool effects, protocol preparation and cleanup. Unknown/invalid/zero values remain distinct; cost is unknown. Partial HTTP retains a bounded decoded prefix without claiming a complete body/usage. Recording/source/close failures cannot release success; failed close and unknown durability remain unconfirmed. These are cooperative deadlines/retained decoded caps, without hard wire/heap/wall/OS containment.

## Verify and distribute

```sh
npm ci --prefix backend
npm test --prefix backend
node scripts/build-datasets.mjs --check
npm ci --prefix frontend
npm run test:dependencies --prefix frontend
npm run typecheck --prefix frontend
NEXT_PUBLIC_INCIDENT_API_URL=http://127.0.0.1:3826 npm run build --prefix frontend
cd frontend
npx playwright install chromium
npm run test:e2e
cd ..
node scripts/package.mjs
node scripts/check-package.mjs
```

80 backend/11 frontend dependency checks and12 production Chromium flows qualify actual pinned SDK/AG-UI/CopilotKit behavior over owned HTTP, current source decisions, independent process serialization, native cancellation/deadline/evidence/cleanup, all12 populations/private CLI/reset and UI outage/stale/stop/busy/alternate behavior. Controlled provider responses establish protocol and application behavior, not semantic model quality or billing. The test-only reset host creates fresh private case directories and preserves older state/evidence; it exposes no controls in the product API. Screenshots were visually inspected.

`check-package.mjs` verifies repeated portable deterministic source bytes and the exact manifest, then installs/builds/tests both projects outside checkout. It separately installs production-only backend dependencies and exercises all12 private CLI populations/reset, normal CLI-hosted native Anthropic/Mastra/AG-UI API with separate commander approval, missing-key receipts and SIGTERM cleanup. Original delivered files must remain unchanged. CI retains source, qualification and synthetic browser screenshots. Both install roots retain the qualified version-guarded compatibility repairs documented in backend/frontend scripts/README.md; no vendor/global-cache ownership patch was added.

See [PLAN.md](PLAN.md), [COMPATIBILITY.md](COMPATIBILITY.md) and [scenarios](scenarios/README.md). Actual enabled model/key/budget plus semantic/billing review, authenticated persisted Firedrill scenarios/results, real connectors and license remain parked. No paid provider, real Slack action or license is claimed. [Firedrill examples](https://docs.firedrill.run/guides/examples), [Firedrill](https://firedrill.run/) and [documentation](https://docs.firedrill.run/) provide portfolio context; matching release qualification is required. Primary APIs: [Anthropic tool use](https://platform.claude.com/docs/claude/docs/tool-use), [Mastra generate](https://mastra.ai/reference/agents/generate), and pinned installed public declarations.

## Current Firedrill integration

Released CLI/SDK 2.2.2, current command invocation, remote operator MCP and recovery are documented in the root firedrill/README.md. Offline checks preserve actual loopback AG-UI state/native key behavior and separate commander decisions. Authenticated persisted runs and live quality/cost remain parked separately.
