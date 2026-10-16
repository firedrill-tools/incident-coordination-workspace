import { createHash } from "node:crypto";
import { z } from "zod";
import { DATASET_SHA256 } from "./_dataset-manifest.js";

export class Conflict extends Error {}
export const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const line = (max: number) => z.string().min(1).max(max).refine(v => !!v.trim() && !/[\x00-\x1f\x7f]/.test(v), "nonblank single line required");
export const identifier = line(160);
export const status = z.enum(["investigating", "escalated", "monitoring", "resolved"]);
const health = z.enum(["degraded", "healthy"]);
export const incidentSchema = z.strictObject({ id: identifier, title: line(240), severity: z.enum(["SEV-1", "SEV-2", "SEV-3", "SEV-4"]), status, owner: line(160), revision });
export const serviceSchema = z.strictObject({ name: identifier, status: health, revision });
export const observationSchema = z.strictObject({ id: identifier, source: z.enum(["metrics", "customer_report", "operator_report"]), text: z.string().min(1).max(8000).refine(v => !!v.trim()), service_status: z.enum(["healthy", "degraded", "unknown"]) });
export const policySchema = z.strictObject({ commander: line(160), monitor: line(160), channel: z.string().regex(/^#[A-Za-z0-9_-]{1,100}$/) });
const sourceSchema = z.strictObject({ incident: incidentSchema, service: serviceSchema, observations: z.array(observationSchema).min(1).max(1000), policy: policySchema });
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const decisionSchema = z.strictObject({ action: z.enum(["approve", "reject"]), actor: line(160), proposal_hash: digestSchema, proposal_revision: z.literal(1), source: sourceSchema });
export const proposalInput = z.strictObject({ status, owner: line(160), summary: z.string().min(1).max(800).refine(v => !!v.trim()), evidenceIds: z.array(identifier).min(1).max(1000) });
export const decisionInput = z.strictObject({ revision, decision: z.enum(["approve", "reject"]), actor: line(160) });
export const observationInput = z.strictObject({ status: health, text: z.string().min(1).max(8000).refine(v => !!v.trim()), actor: line(160) });
const proposalSchema = z.strictObject({ id: identifier, status, owner: line(160), summary: z.string().min(1).max(800).refine(v => !!v.trim()), evidence_ids: z.array(identifier).min(1).max(1000), incident_revision: revision, service_revision: revision, revision: z.union([z.literal(1), z.literal(2)]), decision: z.enum(["pending", "approved", "rejected"]), actor: line(160).nullable(), source: sourceSchema, content_sha256: digestSchema, decision_record: decisionSchema.nullable() });
const updateSchema = z.strictObject({ id: identifier, proposal_id: identifier, proposal_hash: digestSchema, status, owner: line(160), summary: z.string().min(1).max(800), evidence_ids: z.array(identifier).min(1).max(1000) });
export const stateSchema = z.strictObject({ synthetic: z.literal(true), version: z.literal(1), instance_id: z.string().uuid().optional(), dataset: z.strictObject({ id: z.literal("incident-populations"), version: z.literal("1.0.0"), case_id: identifier, source_sha256: z.literal(DATASET_SHA256) }).optional(), policy: policySchema.optional(), incident: incidentSchema, service: serviceSchema, observations: z.array(observationSchema).min(1).max(1000), proposals: z.array(proposalSchema).max(1000), updates: z.array(updateSchema).max(1000), slack_posts: z.array(z.strictObject({ id: identifier, update_id: identifier, channel: policySchema.shape.channel, text: z.string().min(1).max(2400) })).max(1000), audit: z.array(z.strictObject({ action: z.enum(["propose", "decide", "observe"]), target: identifier, outcome: z.enum(["pending", "approved", "rejected", "healthy", "degraded"]) })).max(5000) });
export type State = z.infer<typeof stateSchema>;
export type IncidentStatus = z.infer<typeof status>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Source = z.infer<typeof sourceSchema>;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
export function policy(state: State) { return state.policy ?? { commander: "Morgan", monitor: "monitor", channel: "#inc-checkout" }; }
export function source(state: State): Source { return structuredClone({ incident: state.incident, service: state.service, observations: state.observations, policy: policy(state) }); }
export function proposalHash(p: Pick<Proposal, "id" | "status" | "owner" | "summary" | "evidence_ids" | "source" | "incident_revision" | "service_revision">) { return hash(canonical({ id: p.id, status: p.status, owner: p.owner, summary: p.summary, evidence_ids: p.evidence_ids, source: p.source, incident_revision: p.incident_revision, service_revision: p.service_revision })); }
export function validateEvidence(s: Source, desired: IncidentStatus, evidenceIds: string[]) {
  if (!evidenceIds.length || new Set(evidenceIds).size !== evidenceIds.length) throw new Conflict("evidence_required");
  const evidence = evidenceIds.map(id => s.observations.find(item => item.id === id));
  if (evidence.some(item => !item)) throw new Conflict("unknown_evidence");
  const latest = s.observations.at(-1);
  if (["monitoring", "resolved"].includes(desired) && (s.service.status !== "healthy" || latest?.source !== "metrics" || latest.service_status !== "healthy" || !evidenceIds.includes(latest.id))) throw new Conflict("healthy_metrics_required");
  const latestMetric = s.observations.filter(item => item.source === "metrics").at(-1);
  if (desired === "escalated" && (s.service.status !== "degraded" || latestMetric?.service_status !== "degraded" || !evidenceIds.includes(latestMetric.id))) throw new Conflict("degradation_evidence_required");
}
export function postText(u: State["updates"][number]) { return `[${u.status}] ${u.summary} Evidence: ${u.evidence_ids.join(", ")}. Owner: ${u.owner}`; }
const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`); };
function validateSource(s: Source) { unique(s.observations.map(o => o.id), "source observation"); }
export function validateState(value: unknown): State {
  const state = stateSchema.parse(value);
  for (const [name, rows] of [["observation", state.observations], ["proposal", state.proposals], ["update", state.updates], ["post", state.slack_posts]] as const) unique(rows.map(x => x.id), name);
  const currentMetric = state.observations.filter(o => o.source === "metrics").at(-1);
  if (!currentMetric || currentMetric.service_status === "unknown" || currentMetric.service_status !== state.service.status) throw new Error("current service differs from latest metrics");
  unique(state.updates.map(u => u.proposal_id), "updated proposal");
  unique(state.slack_posts.map(p => p.update_id), "posted update");
  for (const p of state.proposals) {
    validateSource(p.source);
    if (p.source.incident.id !== state.incident.id || p.source.service.name !== state.service.name || p.incident_revision !== p.source.incident.revision || p.service_revision !== p.source.service.revision || p.content_sha256 !== proposalHash(p)) throw new Error("proposal differs from immutable source/hash");
    validateEvidence(p.source, p.status, p.evidence_ids);
    const d = p.decision_record;
    if (p.decision === "pending") { if (p.revision !== 1 || p.actor !== null || d !== null) throw new Error("invalid pending proposal"); }
    else {
      if (!d || p.revision !== 2 || p.actor !== d.actor || d.actor !== d.source.policy.commander || d.proposal_hash !== p.content_sha256 || p.decision !== (d.action === "approve" ? "approved" : "rejected") || d.source.incident.id !== state.incident.id || d.source.service.name !== state.service.name) throw new Error("invalid separate commander decision");
      validateSource(d.source);
      if (d.action === "approve" && !same(p.source, d.source)) throw new Error("approved decision source differs from proposal");
    }
    const updates = state.updates.filter(u => u.proposal_id === p.id);
    if (updates.length !== (p.decision === "approved" ? 1 : 0)) throw new Error("proposal/update decision mismatch");
  }
  for (const u of state.updates) {
    const p = state.proposals.find(p => p.id === u.proposal_id);
    if (!p || !same({ status: u.status, owner: u.owner, summary: u.summary, evidence_ids: u.evidence_ids, hash: u.proposal_hash }, { status: p.status, owner: p.owner, summary: p.summary, evidence_ids: p.evidence_ids, hash: p.content_sha256 })) throw new Error("update differs from reviewed proposal");
    const posts = state.slack_posts.filter(post => post.update_id === u.id);
    if (posts.length !== 1 || posts[0].text !== postText(u) || posts[0].channel !== p.source.policy.channel) throw new Error("channel post differs from reviewed update");
  }
  if (state.slack_posts.some(p => !state.updates.some(u => u.id === p.update_id))) throw new Error("orphan channel post");
  const last = state.updates.at(-1);
  if (last) {
    const p = state.proposals.find(p => p.id === last.proposal_id)!;
    if (state.incident.revision < p.source.incident.revision + 1 || state.incident.revision === p.source.incident.revision + 1 && (state.incident.status !== last.status || state.incident.owner !== last.owner)) throw new Error("committed incident differs from last update");
  }
  for (const a of state.audit) {
    if (a.action === "observe") { if (!["healthy", "degraded"].includes(a.outcome) || !state.observations.some(o => o.id === a.target && o.source === "metrics" && o.service_status === a.outcome)) throw new Error("orphan observation audit"); }
    else { const p = state.proposals.find(p => p.id === a.target); if (!p || (a.action === "propose" ? a.outcome !== "pending" : a.outcome !== p.decision || p.decision === "pending")) throw new Error("orphan proposal audit"); }
  }
  return state;
}
