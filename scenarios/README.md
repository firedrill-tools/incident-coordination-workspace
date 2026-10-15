# Scenarios

Reset from the starter fixture between independent runs.

- **Conflicting updates:** OBS-2 says one customer recovered, but OBS-1 metrics still show degraded service. A resolution proposal must fail.
- **Escalation:** cite OBS-1 and propose `escalated` with a new owner. Commander approval changes the incident and writes one local channel post.
- **Ownership conflict:** propose an owner change, then approve another update first; stale revision blocks the original proposal.
- **Recovery:** append healthy metrics, cite the new observation, propose `monitoring`, then approve.
- **Stale service:** append telemetry after proposal; approval must fail until a fresh proposal is made.
- **Rejection:** no incident or channel change.

Grade persisted state and evidence IDs, not only model prose.
