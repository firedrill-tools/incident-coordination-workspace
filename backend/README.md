# Incident workspace backend

Node22.13+/npm. This backend owns Mastra/Anthropic/official local AG-UI and a synthetic incident API. It never calls Slack or a service-status provider. Commander and monitor names are fixture identities without production authentication.

```sh
npm ci
npm run build
node dist/src/cli.js datasets
node dist/src/cli.js init --workspace run-output/workspace.json --case conflicting-report
node dist/src/cli.js workspace --workspace run-output/workspace.json
node dist/src/cli.js reset --workspace run-output/workspace.json --destination run-output/fresh.json
node dist/src/cli.js serve --workspace run-output/workspace.json --offline
```

Omit --offline and explicitly supply an enabled anthropic/<model> with --model or INCIDENT_MODEL plus ANTHROPIC_API_KEY to allow chat. --base-url accepts an explicit HTTPS or owned loopback Messages endpoint for controlled qualification; ambient ANTHROPIC_BASE_URL is not borrowed. The default URL is Anthropic's official /v1 API. No model/key fallback exists. Port8126 is default; --port0 requests an owned ephemeral port. Missing keys produce private failed run evidence. Root frontend uses HttpAgent at /agent and that exact committed workspace API.

Twelve hash-bound populations/four profiles include100proposals/64updates/64localposts busy history, alternate commander/channel, conflicting metrics/reports, stale/missing evidence, already resolved state, hostile/Unicode source and maximum revision. CLI initialization is exclusive and0600 with required source metadata. Reset preserves old source/mutex/evidence and creates a fresh UUID at a distinct destination. Interrupted two-file initialization leaves partial files untouched; choose a fresh destination. Valid current edits stay separate from original imported seed history, which has no prior model/authentication/Slack proof.

Native Messages JSON is fully validated before the actual SDK/public V3 stream adapter and official Mastra bridge consume it. Tools read/propose only; separate commander decisions recheck exact source and write matching local update/post records. Budgets:8prepared calls/2048requested output/zero retry/30-second HTTP/120-second operation,4active/32threads/eight completed turns/512attempts. Original counters/IDs/raw responses and SDK normalization are distinct; cost is unknown. Events are retained until exact final answer, source after cleanup, private evidence and awaited owned SDK/transport/Mastra shutdown. Partial proposals remain pending after later failure. Cancellation/recording/source/close faults cannot release success. These are bounded retained decoded data and cooperative deadlines, without hard wire/heap/wall/OS isolation.

Production dependencies include bridge/client/secure parser required by the existing version-guarded compatibility repairs in scripts/. Root README/PLAN/COMPATIBILITY, data authoring, complete source packaging and production Chromium qualification accompany the full workspace. No paid provider, real connector action, qualified new Firedrill result or license is claimed.
