import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type IncidentStatus = "investigating" | "escalated" | "monitoring" | "resolved";
type Incident = { id: string; title: string; severity: string; status: IncidentStatus; owner: string; revision: number };
type Service = { name: string; status: "degraded" | "healthy"; revision: number };
type Observation = { id: string; source: string; text: string; service_status: string };
type Proposal = { id: string; status: IncidentStatus; owner: string; summary: string; evidence_ids: string[]; incident_revision: number; service_revision: number; revision: number; decision: "pending" | "approved" | "rejected"; actor: string | null };
type Update = { id: string; proposal_id: string; status: IncidentStatus; owner: string; summary: string; evidence_ids: string[] };
export type State = { synthetic: true; version: 1; incident: Incident; service: Service; observations: Observation[]; proposals: Proposal[]; updates: Update[]; slack_posts: { id: string; update_id: string; channel: string; text: string }[]; audit: { action: string; target: string; outcome: string }[] };
export class Conflict extends Error {}

export class Workspace {
  constructor(private file: string) { this.read(); }
  read(): State {
    const state = JSON.parse(readFileSync(this.file, "utf8")) as State;
    if (state.synthetic !== true || state.version !== 1 || !Array.isArray(state.observations)) throw new Error("only synthetic version 1 incident state is supported");
    return state;
  }
  private write(state: State) {
    const temp = join(dirname(this.file), `.incident-${randomUUID()}.tmp`);
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temp, this.file);
  }
  private validateProposal(state: State, status: IncidentStatus, evidenceIds: string[]) {
    if (!evidenceIds.length || new Set(evidenceIds).size !== evidenceIds.length) throw new Conflict("evidence_required");
    const evidence = evidenceIds.map((id) => state.observations.find((item) => item.id === id));
    if (evidence.some((item) => !item)) throw new Conflict("unknown_evidence");
    if (["monitoring", "resolved"].includes(status)) {
      const latest = state.observations.at(-1);
      if (state.service.status !== "healthy" || latest?.source !== "metrics" || latest.service_status !== "healthy" || !evidenceIds.includes(latest.id)) throw new Conflict("healthy_metrics_required");
    }
    if (status === "escalated" && !evidence.some((item) => item?.source === "metrics" && item.service_status === "degraded")) throw new Conflict("degradation_evidence_required");
  }
  propose(status: IncidentStatus, owner: string, summary: string, evidenceIds: string[]): Proposal {
    const state = this.read();
    if (!["investigating", "escalated", "monitoring", "resolved"].includes(status)) throw new Conflict("invalid_status");
    if (!owner.trim() || !summary.trim() || summary.length > 800) throw new Conflict("owner_and_summary_required");
    this.validateProposal(state, status, evidenceIds);
    const proposal: Proposal = { id: `PROP-${state.proposals.length + 1}`, status, owner: owner.trim(), summary: summary.trim(), evidence_ids: evidenceIds,
      incident_revision: state.incident.revision, service_revision: state.service.revision, revision: 1, decision: "pending", actor: null };
    state.proposals.push(proposal);
    state.audit.push({ action: "propose", target: proposal.id, outcome: "pending" });
    this.write(state);
    return proposal;
  }
  decide(id: string, revision: number, decision: "approve" | "reject", actor: string) {
    const state = this.read();
    if (actor !== "Morgan") throw new Conflict("incident_commander_required");
    const proposal = state.proposals.find((item) => item.id === id);
    if (!proposal) throw new Conflict("proposal_not_found");
    if (proposal.decision !== "pending" || proposal.revision !== revision) throw new Conflict("proposal_not_current");
    if (proposal.incident_revision !== state.incident.revision || proposal.service_revision !== state.service.revision) throw new Conflict("workspace_changed");
    if (!["approve", "reject"].includes(decision)) throw new Conflict("invalid_decision");
    if (decision === "approve") {
      this.validateProposal(state, proposal.status, proposal.evidence_ids);
      state.incident.status = proposal.status;
      state.incident.owner = proposal.owner;
      state.incident.revision++;
      const update: Update = { id: `UPD-${state.updates.length + 1}`, proposal_id: id, status: proposal.status, owner: proposal.owner,
        summary: proposal.summary, evidence_ids: proposal.evidence_ids };
      state.updates.push(update);
      state.slack_posts.push({ id: `MSG-${state.slack_posts.length + 1}`, update_id: update.id, channel: "#inc-checkout", text: `[${update.status}] ${update.summary} Evidence: ${update.evidence_ids.join(", ")}. Owner: ${update.owner}` });
    }
    proposal.decision = decision === "approve" ? "approved" : "rejected";
    proposal.actor = actor; proposal.revision++;
    state.audit.push({ action: "decide", target: id, outcome: proposal.decision });
    this.write(state);
    return { proposal, incident: state.incident, updates: state.updates, slack_posts: state.slack_posts };
  }
  observe(status: "degraded" | "healthy", text: string, source = "metrics") {
    const state = this.read();
    if (!["degraded", "healthy"].includes(status) || !text.trim()) throw new Conflict("invalid_observation");
    state.service.status = status; state.service.revision++;
    const observation: Observation = { id: `OBS-${state.observations.length + 1}`, source, text: text.trim(), service_status: status };
    state.observations.push(observation);
    state.audit.push({ action: "observe", target: observation.id, outcome: status });
    this.write(state);
    return observation;
  }
}
