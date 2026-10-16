import { readFileSync, renameSync, writeFileSync, openSync, closeSync, fstatSync, lstatSync, fsyncSync, rmSync, realpathSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Conflict, type State, type Proposal, type Source, type IncidentStatus, validateState, proposalInput, decisionInput, observationInput, proposalHash, source, same, policy, validateEvidence, postText, hash } from "./schema.js";
import { parseJSON } from "./json.js";
export { Conflict, validateState, source } from "./schema.js";
export type { State, Proposal, Source, IncidentStatus } from "./schema.js";
export { parseJSON } from "./json.js";
const MAX_BYTES = 8 * 1024 * 1024;
function load(file: string) {
  const initial = lstatSync(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > MAX_BYTES) throw new Error("state must be a bounded regular file");
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd), bytes = readFileSync(fd), after = fstatSync(fd), current = lstatSync(file);
    if (bytes.length > MAX_BYTES || initial.dev !== before.dev || initial.ino !== before.ino || before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) throw new Error("state changed while reading");
    return { state: validateState(parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes))), bytes, identity: `${before.dev}:${before.ino}`, digest: hash(bytes) };
  } finally { closeSync(fd); }
}
function save(file: string, state: State, prior: ReturnType<typeof load>) {
  validateState(state);
  const bytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  if (bytes.length > MAX_BYTES) throw new Error("state limit exceeded");
  const temp = join(dirname(file), `.incident-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    const current = load(file);
    if (current.identity !== prior.identity || current.digest !== prior.digest) throw new Conflict("state changed before commit");
    renameSync(temp, file);
    const parent = openSync(dirname(file), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally { rmSync(temp, { force: true }); }
}
function nextId(prefix: string, rows: { id: string }[]) { let n = rows.length + 1; while (rows.some(r => r.id === `${prefix}-${n}`)) n++; return `${prefix}-${n}`; }
function increment(n: number) { if (n === Number.MAX_SAFE_INTEGER) throw new Conflict("revision_exhausted"); return n + 1; }
export class Workspace {
  readonly file: string;
  private readonly instance: string | null;
  private readonly lock: string;
  constructor(file: string) {
    const s = load(file); this.file = realpathSync(file); this.instance = s.state.instance_id ?? null;
    this.lock = join(dirname(this.file), `.${basename(this.file)}.incident-lock.sqlite`);
  }
  snapshot() { const s = load(this.file); if ((s.state.instance_id ?? null) !== this.instance) throw new Conflict("workspace instance changed"); return s; }
  read(): State { return this.snapshot().state; }
  private transaction<T>(fn: (state: State) => T): T {
    if (existsSync(this.lock) && (!lstatSync(this.lock).isFile() || lstatSync(this.lock).isSymbolicLink())) throw new Error("invalid workspace mutex");
    try { closeSync(openSync(this.lock, "wx", 0o600)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const db = new DatabaseSync(this.lock);
    try {
      db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
      const prior = this.snapshot(), result = fn(prior.state);
      save(this.file, prior.state, prior); db.exec("COMMIT"); return structuredClone(result);
    } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
    finally { db.close(); }
  }
  propose(status: IncidentStatus, owner: string, summary: string, evidenceIds: string[], expectedSource?: Source): Proposal {
    const input = proposalInput.safeParse({ status, owner, summary, evidenceIds });
    if (!input.success) throw new Conflict("invalid_proposal_arguments");
    return this.transaction(state => {
      const current = source(state);
      if (expectedSource && !same(expectedSource, current)) throw new Conflict("workspace_changed_since_read");
      validateEvidence(current, input.data.status, input.data.evidenceIds);
      const proposal: Proposal = { id: nextId("PROP", state.proposals), status: input.data.status, owner: input.data.owner.trim(), summary: input.data.summary.trim(), evidence_ids: [...input.data.evidenceIds], incident_revision: state.incident.revision, service_revision: state.service.revision, revision: 1, decision: "pending", actor: null, source: current, content_sha256: "", decision_record: null };
      proposal.content_sha256 = proposalHash(proposal);
      state.proposals.push(proposal); state.audit.push({ action: "propose", target: proposal.id, outcome: "pending" }); return proposal;
    });
  }
  decide(id: string, revision: number, decision: "approve" | "reject", actor: string) {
    if (!decisionInput.safeParse({ revision, decision, actor }).success) throw new Conflict("invalid_decision_arguments");
    return this.transaction(state => {
      if (actor !== policy(state).commander) throw new Conflict("incident_commander_required");
      const proposal = state.proposals.find(p => p.id === id);
      if (!proposal) throw new Conflict("proposal_not_found");
      if (proposal.decision !== "pending" || proposal.revision !== revision) throw new Conflict("proposal_not_current");
      const current = source(state);
      if (decision === "approve") {
        if (!same(proposal.source, current)) throw new Conflict("workspace_changed");
        validateEvidence(current, proposal.status, proposal.evidence_ids);
        const next = increment(state.incident.revision);
        state.incident.status = proposal.status; state.incident.owner = proposal.owner; state.incident.revision = next;
        const update: State["updates"][number] = { id: nextId("UPD", state.updates), proposal_id: id, proposal_hash: proposal.content_sha256, status: proposal.status, owner: proposal.owner, summary: proposal.summary, evidence_ids: [...proposal.evidence_ids] };
        state.updates.push(update); state.slack_posts.push({ id: nextId("MSG", state.slack_posts), update_id: update.id, channel: proposal.source.policy.channel, text: postText(update) });
      }
      proposal.decision = decision === "approve" ? "approved" : "rejected"; proposal.actor = actor; proposal.revision = 2;
      proposal.decision_record = { action: decision, actor, proposal_hash: proposal.content_sha256, proposal_revision: 1, source: current };
      state.audit.push({ action: "decide", target: id, outcome: proposal.decision });
      return { proposal, incident: state.incident, updates: state.updates, slack_posts: state.slack_posts };
    });
  }
  observe(status: "degraded" | "healthy", text: string, origin = "metrics", actor?: string) {
    if (origin !== "metrics" || !observationInput.safeParse({ status, text, actor: "monitor" }).success) throw new Conflict("invalid_observation");
    return this.transaction(state => {
      if (actor !== undefined && actor !== policy(state).monitor) throw new Conflict("monitor_required");
      state.service.revision = increment(state.service.revision); state.service.status = status;
      const observation: State["observations"][number] = { id: nextId("OBS", state.observations), source: "metrics", text: text.trim(), service_status: status };
      state.observations.push(observation); state.audit.push({ action: "observe", target: observation.id, outcome: status }); return observation;
    });
  }
}
