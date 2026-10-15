"use client";

import { IncidentChat } from "./incident-chat";
import { useCallback, useEffect, useState } from "react";

type Incident = { id: string; title: string; severity: string; status: string; owner: string; revision: number };
type Service = { name: string; status: string; revision: number };
type Observation = { id: string; source: string; text: string; service_status: string };
type Proposal = { id: string; status: string; owner: string; summary: string; evidence_ids: string[]; revision: number; decision: string };
type Update = { id: string; status: string; owner: string; summary: string; evidence_ids: string[] };
type State = { incident: Incident; service: Service; observations: Observation[]; proposals: Proposal[]; updates: Update[]; slack_posts: { id: string; text: string }[] };
const api = process.env.NEXT_PUBLIC_INCIDENT_API_URL || "http://localhost:8126";

export default function Page() {
  const [state, setState] = useState<State | null>(null);
  const [actor, setActor] = useState("Morgan");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { const response = await fetch(`${api}/workspace`, { cache: "no-store" }); if (!response.ok) throw new Error("Incident API unavailable"); setState(await response.json()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load incident"); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => window.clearInterval(timer); }, [refresh]);
  async function post(url: string, body: object) {
    setBusy(true);
    try { const response = await fetch(`${api}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const problem = await response.json(); throw new Error(problem.error || "Action failed"); }
      setError(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); await refresh(); }
    finally { setBusy(false); }
  }
  const pending = state?.proposals.filter((item) => item.decision === "pending") || [];
  const recent = [...(state?.observations || [])].reverse();
  return <main className="shell"><header className="top"><div className="wordmark"><span className="signal">●</span> NORTHSTAR <span>/ INCIDENT COMMAND</span></div><div className="top-right">OPERATIONS DESK <b>LOCAL SYNTHETIC</b></div></header>
    <div className="container"><div className="hero"><div><div className="eyebrow">ACTIVE INCIDENT / {state?.incident.id || "INC-101"}</div><h1>{state?.incident.title || "Checkout latency"}</h1><p>One operational record. Every status change and channel update needs current evidence and commander approval.</p></div><div className="hero-status"><span>{state?.incident.severity || "SEV-2"}</span><strong>{state?.incident.status || "Loading"}</strong><small>Owner {state?.incident.owner || "—"}</small></div></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="metrics"><div><span>SERVICE</span><strong>{state?.service.name || "—"}</strong><small className={state?.service.status === "healthy" ? "good" : "bad"}>{state?.service.status || "—"}</small></div><div><span>OBSERVATIONS</span><strong>{state?.observations.length ?? 0}</strong><small>source records</small></div><div><span>REVIEW QUEUE</span><strong>{pending.length}</strong><small>pending proposals</small></div><div><span>CHANNEL POSTS</span><strong>{state?.slack_posts.length ?? 0}</strong><small>#inc-checkout</small></div></div>
      <div className="grid"><div className="left"><section className="panel evidence"><div className="panel-head"><div><span className="eyebrow">01 / SIGNALS</span><h2>Evidence stream</h2></div><button className="outline" disabled={busy} onClick={() => void post("/observations", { actor: "monitor", status: "healthy", text: "Checkout p95 210 ms and error rate back to baseline" })}>Simulate healthy metrics</button></div><div className="records">{recent.map((item) => <article key={item.id} className="observation"><div className="record-meta"><span>{item.id}</span><span>{item.source.toUpperCase()}</span></div><p>{item.text}</p><span className={`tag ${item.service_status === "healthy" ? "green" : ""}`}>{item.service_status}</span></article>)}</div><p className="note">A customer report alone cannot mark checkout recovered. Monitoring and resolution require the latest healthy metric observation.</p></section>
        <section className="panel timeline"><div className="panel-head"><div><span className="eyebrow">02 / COMMITTED</span><h2>Incident timeline</h2></div><span className="count">{state?.updates.length ?? 0} UPDATES</span></div><div className="records">{!state?.updates.length && <p className="quiet">No approved updates yet. The incident remains investigating.</p>}{state?.updates.map((item) => <article className="update" key={item.id}><div className="record-meta"><span>{item.id} · {item.status.toUpperCase()}</span><span>OWNER {item.owner.toUpperCase()}</span></div><p>{item.summary}</p><small>Evidence {item.evidence_ids.join(", ")}</small></article>)}</div></section></div>
      <aside className="right"><section className="panel review"><div className="panel-head"><div><span className="eyebrow">03 / DECISIONS</span><h2>Review queue</h2></div><span className="count">{pending.length} PENDING</span></div><div className="review-body"><label htmlFor="actor">Incident commander</label><input id="actor" value={actor} onChange={(event) => setActor(event.target.value)}/><p className="helper">Only Morgan can decide in this local demo. A proposal does not change the incident.</p>{!pending.length && <p className="quiet">Ask the copilot to prepare an evidence-backed status or owner update.</p>}{pending.map((item) => <div className="proposal" key={item.id}><div className="record-meta"><span>{item.id}</span><span>{item.status.toUpperCase()}</span></div><h3>{item.summary}</h3><p>New owner: {item.owner}</p><small>Evidence {item.evidence_ids.join(", ")}</small><div className="buttons"><button disabled={busy} className="reject" onClick={() => void post(`/proposals/${item.id}/decision`, { revision: item.revision, decision: "reject", actor })}>Reject</button><button disabled={busy} onClick={() => void post(`/proposals/${item.id}/decision`, { revision: item.revision, decision: "approve", actor })}>Approve update</button></div></div>)}</div></section>
        <section className="panel chat-panel"><div className="chat-intro"><span className="eyebrow">04 / ASSISTANT</span><h2>Incident copilot</h2><p>Review evidence and draft an update. The commander makes the decision.</p></div><div className="chat-wrap"><IncidentChat /></div></section></aside></div>
      <section className="channel"><div><span className="eyebrow">CHANNEL MIRROR</span><h2>#inc-checkout</h2></div><div className="posts">{!state?.slack_posts.length ? <span>No approved update has been posted.</span> : state.slack_posts.map((post) => <p key={post.id}><b>{post.id}</b> {post.text}</p>)}</div></section><footer>SYNTHETIC INCIDENT WORKSPACE <span>NO EXTERNAL SLACK OR SERVICE WRITES</span></footer>
    </div></main>;
}
