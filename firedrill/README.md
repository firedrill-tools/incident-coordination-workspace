# Firedrill agent-first integration

The optional execution toolchain pins released CLI/SDK **2.2.2**, Node 22+ (October 19, 2026). The existing Mastra/Anthropic/official AG-UI bridge runtime remains separately locked.

## Prepare and run

From the workspace root:

```sh
npm ci --prefix backend
npm run build --prefix backend
npm ci --prefix firedrill --ignore-scripts --no-audit --no-fund
npm test --prefix firedrill
node firedrill/node_modules/@firedrill-run/cli/bin/firedrill.mjs validate firedrill/scenario.json --json --non-interactive
```

Validation is offline. Human authorization/scope selection uses the same CLI `init`; automation uses protected `FIREDRILL_TOKEN`, `FIREDRILL_PROJECT_ID`, `FIREDRILL_ENVIRONMENT_ID`. The app independently needs `ANTHROPIC_API_KEY` and enabled `INCIDENT_MODEL` or recipe model parameter. With scope/provider budget authorized, use `node firedrill/simulate.mjs --preview` and then `node firedrill/simulate.mjs`.

The bounded sequential recipe initializes a private hash-bound incident workspace and invokes its actual Express `createApp`, normal `/agent` HTTP handler, native Mastra/Anthropic and official local AG-UI bridge. Each driver owns a real ephemeral loopback server and uses real HTTP requests; no factory/model/transport is injected. Conflicting-report and missing-evidence cases use native chat; busy-incident inspection reads the actual `/workspace` without a model runtime. Existing current telemetry/source/revision checks and proposal-only tools remain authoritative. Commander approvals, observation writes, status commits and Slack posts are not target actions. Fictional posts are not real delivery.

Each attempt saves outer run/attempt/scenario IDs in private `.runs/firedrill/attempt-*/invocation.json` before app work. It separately allocates/saves unique application thread/run IDs before chat, retains original AG-UI bytes and reads the exact private receipt matching those IDs. Success requires the exact RUN_FINISHED, no RUN_ERROR, completed original receipt with confirmed native cleanup, and confirmed owned runtime/server closure. HTTP 200 alone is insufficient. Key failure preserves RUN_ERROR/failed receipt with no provider calls and a nonzero exit. Inspection is explicitly model-free. Keep partial proposal effects/unknown outcomes for review; a new attempt creates fresh state rather than recovering or resetting earlier evidence. Local cleanup does not prove remote cancellation, billing completion, effect rollback or real connector delivery. Files are local evidence, not uploaded platform artifacts.

Current ID-only invocation accepts only reviewed case/action/message and optional model. Operator/CI credentials are removed before child dispatch; controller assessments and unsupported Tool bindings are rejected. Native models use the application's `anthropic/<model>` format. No operator approval identity enters model authority.

## MCP and recovery

Configure remote OAuth operator MCP at **https://mcp.firedrill.run/mcp** using [host setup](https://docs.firedrill.run/guides/coding-agents). MCP prepares, queues and inspects; the local SDK/CLI executes the command target. Host OAuth and execution login are separate. Use `--run BATCH_ID` to attach queued work, `--resume OPERATION_ID` after uncertainty, and `--result BATCH_ID` to read retained results. Preserve SDK journals and local evidence. These scripts retain public SDK diagnostics and whole-batch exit status; a new simulation starts new work.

CI and the fresh locked source archive run offline integration tests with actual loopback workspace inspection and native missing-key boundary. They establish wiring and cleanup, not live model quality, platform persistence, or uploaded captures. The observation recipe defines no grader/gate. Authenticated persisted happy/negative runs, paid model quality/cost, publication and licensing remain separate gates.

References: [SDK](https://docs.firedrill.run/sdk/typescript), [command targets](https://docs.firedrill.run/guides/callbacks), [operator MCP](https://docs.firedrill.run/guides/control-mcp), [CI](https://docs.firedrill.run/guides/ci).
