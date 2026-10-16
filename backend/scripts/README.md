# Installed dependency compatibility

Mastra 1.77.0 uses gray-matter 4, which uses js-yaml 3 and argparse 1. The latter depends on sprintf-js, whose published versions are affected by [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

The package override selects argparse **2.0.1 only under gray-matter 4 / js-yaml 3**. Argparse 2 removes sprintf-js and retains the older argument-parser API. The YAML library keeps its existing `safeLoad`/`safeDump` contract. Argparse 3 removed that legacy API, so changing to its newest major would require a separate migration.

Argparse 2's legacy `version` constructor option registers a version action without assigning `parser.version`. `patch-argparse.cjs` restores that one assignment so the existing js-yaml `--version` behavior still works. It runs after ordinary `npm install` / `npm ci`, modifies only the installed dependency, checks the exact version and unique source marker, and is idempotent. Its original license remains in `node_modules/argparse/LICENSE`; no upstream source is republished here. Running with `--ignore-scripts` requires `npm run postinstall` before verification.

`test/dependency.test.ts` exercises YAML front-matter parsing/serialization, CLI help/version, both stdin conversion modes and invalid-input errors. The application suite also exercises the local tool/state boundaries. Run `npm audit --omit=dev` to inspect the resolved runtime tree. Remove this override/repair together when a future dependency chain has been qualified against these contracts.

Upstream reference: [Argparse changelog and legacy API removal](https://github.com/nodeca/argparse/blob/master/CHANGELOG.md).

## Legacy UI utilities and bounded response readers

`@ai-sdk/ui-utils@1.2.11`, used by AG-UI and the Mastra client, pins provider-utils 2.2.8. This is affected by [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8). The override selects provider-utils **3.0.30 only beneath that UI package**, retaining the patched response readers. Other SDK majors keep their existing dependency paths.

A plain major override breaks two contracts: provider-utils 3 no longer exports `validatorSymbol`, and its JSON parser is asynchronous. `patch-ui-utils.cjs` preserves the shared `Symbol.for("vercel.ai.validator")` marker and supplies the legacy partial-parser call with synchronous `secure-json-parse@4.1.1`. That upstream parser rejects prototype/constructor poisoning by default. The installed CommonJS and ESM files both receive the same small compatibility changes. The bounded network response handlers stay in the newer provider utilities.

The repair checks both dependency versions, the secure parser version and unique source markers; it is idempotent and fails on unexpected source. The owned local AG-UI runtime declares its bridge/client and secure parser as runtime dependencies. Production-only installs run the same qualified UI utility repair; no development-only parser is borrowed. Original upstream licenses/attribution remain installed. `--ignore-scripts` requires `npm run postinstall` before use.

`test/ui-compatibility.test.ts` checks both module formats resolved from both consumers: IDs, synchronous complete/partial JSON, poisoned-input rejection, schema validation, data-stream handling and bounded body reads. The application suites verify the actual HTTP/AG-UI path. This qualifies the APIs used by this example; it is not a claim of compatibility with every legacy UI utility. Remove the scoped override and repair together after qualifying a newer client/bridge dependency chain.
