"use client";
import { useCallback, useEffect, useRef, useState } from "react";
export type Incident = { id: string; title: string; severity: string; status: string; owner: string; revision: number };
export type Service = { name: string; status: string; revision: number };
export type Observation = { id: string; source: string; text: string; service_status: string };
export type Proposal = { id: string; status: string; owner: string; summary: string; evidence_ids: string[]; incident_revision: number; service_revision: number; revision: number; decision: string };
export type Update = { id: string; status: string; owner: string; summary: string; evidence_ids: string[] };
export type State = { incident: Incident; service: Service; observations: Observation[]; proposals: Proposal[]; updates: Update[]; slack_posts: { id: string; text: string }[]; policy?: { commander: string; monitor: string; channel: string } };
const api = process.env.NEXT_PUBLIC_INCIDENT_API_URL || "http://localhost:8126";
function valid(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const v = value as State;
  return !!v.incident && typeof v.incident.id === "string" && typeof v.incident.title === "string" && typeof v.incident.owner === "string" && typeof v.incident.status === "string" && Number.isSafeInteger(v.incident.revision) && v.incident.revision > 0 && !!v.service && typeof v.service.name === "string" && typeof v.service.status === "string" && Number.isSafeInteger(v.service.revision) && v.service.revision > 0 && Array.isArray(v.observations) && Array.isArray(v.proposals) && Array.isArray(v.updates) && Array.isArray(v.slack_posts);
}
function problem(value: unknown, status: number) {
  const error = value && typeof value === "object" && "error" in value ? value.error : null;
  if (typeof error !== "string") return `Action failed (HTTP ${status})`;
  return ({ incident_commander_required: "Enter the current incident commander's name to decide.", monitor_required: "The current synthetic monitor identity is required.", workspace_changed: "Incident, owner or evidence changed after this proposal. Reject it and request a fresh proposal.", proposal_not_current: "This proposal changed. Review the current queue.", healthy_metrics_required: "Current healthy metrics are required for recovery.", degradation_evidence_required: "Current degraded metrics must support escalation.", revision_exhausted: "This workspace reached its revision limit. Use a fresh workspace." } as Record<string, string>)[error] ?? error;
}
export function useWorkspace() {
  const [state, setState] = useState<State | null>(null), [actor, setActorValue] = useState(""), [busy, setBusy] = useState(false), [available, setAvailable] = useState(false), [readError, setReadError] = useState(""), [actionError, setActionError] = useState("");
  const sequence = useRef(0), activeRead = useRef<AbortController | null>(null), mounted = useRef(true), inflight = useRef(false), actorEdited = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++sequence.current; activeRead.current?.abort();
    const controller = new AbortController(); activeRead.current = controller;
    try {
      const response = await fetch(`${api}/workspace`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Incident API unavailable. Current actions cannot be confirmed.");
      const value: unknown = await response.json(); if (!valid(value)) throw new Error("Incident API returned invalid state.");
      if (!mounted.current || current !== sequence.current) return;
      setState(value); if (!actorEdited.current) setActorValue(value.policy?.commander ?? "Morgan");
      setReadError(""); setAvailable(true);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current || current !== sequence.current) return;
      setAvailable(false); setReadError(error instanceof Error ? error.message : "Could not load incident");
    }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => { mounted.current = false; window.clearInterval(timer); activeRead.current?.abort(); }; }, [refresh]);
  async function post(url: string, body: object) {
    if (inflight.current || !available) return;
    inflight.current = true; setBusy(true); ++sequence.current; activeRead.current?.abort();
    try {
      const response = await fetch(`${api}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { let details: unknown; try { details = await response.json(); } catch {} throw new Error(problem(details, response.status)); }
      if (mounted.current) setActionError(""); await refresh();
    } catch (error) { if (mounted.current) setActionError(error instanceof Error ? error.message : "Action failed"); await refresh(); }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }
  return { state, actor, setActor: (value: string) => { actorEdited.current = true; setActorValue(value); }, busy, available, error: [actionError, readError].filter(Boolean).join(" "), post };
}
