import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, CheckCheck, CircleAlert, Clock3, FileText, Play, ShieldCheck, UserRound, X } from "lucide-react";
import { api, type AgentRun, type Resolution } from "./api";
import { currency, type Run } from "./App";
import { CountUp } from "./motion";

export const KIND_LABEL: Record<string, string> = {
  fill_punch: "Fill missing punch", remove_duplicate: "Remove duplicate punch", add_shift: "Add worked shift",
  pay_premium: "Pay meal premium", accept_as_recorded: "Pay as recorded", ask_employee: "Ask employee",
  record_leave: "Record leave in HR", needs_manager: "Manager decides",
};
const LANES: { key: Resolution["lane"]; title: string; hint: string; icon: React.ReactNode }[] = [
  { key: "ready", title: "Ready to approve", hint: "Checked by the pay engine. No change to anyone's hours.", icon: <CheckCheck size={16} /> },
  { key: "waiting", title: "Waiting on employee", hint: "Changes worked time, so the employee confirms first.", icon: <UserRound size={16} /> },
  { key: "judgment", title: "Needs your judgment", hint: "Outside what a timecard edit can fix, or the note looked like an instruction.", icon: <CircleAlert size={16} /> },
];

type Data = { run: AgentRun | null; items: Resolution[] };

function stepText(step: Resolution["trace"][number]) {
  if (step.step === "model") return step.ok ? `AI read the note${step.cached ? " (cached)" : ""}` : `AI answer rejected: ${step.error}`;
  if (step.step === "fallback") return "Fell back to the rules plan";
  if (step.step === "verify") return step.ok ? "Pay engine re-checked the fix" : `Pay engine rejected: ${(step.failures || []).join("; ")}`;
  if (step.step === "employee") return step.reply === "correct" ? `Employee gave the right time: ${step.time}` : `Employee answered ${step.reply}`;
  return step.step;
}

function PayChange({ item }: { item: Resolution }) {
  const { before_total: before, after_total: after } = item.simulation;
  if (!item.correction) return null;
  return <span className="pay-change figure">{before === null ? "Unknown" : currency(before)} → {after === null ? "Unknown" : currency(after)}</span>;
}

function PlanCard({ item, onOpen, onApprove, busy }: { item: Resolution; onOpen: () => void; onApprove?: () => void; busy: boolean }) {
  const quote = item.items.find(i => i.quote)?.quote;
  return <motion.article layout initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, scale: .96 }} transition={{ duration: .3 }} className={`plan-card lane-${item.lane}`}>
    <button className="plan-open" onClick={onOpen} aria-label={`Open plan for ${item.employee} ${item.card_id}`}>
      <div className="plan-top"><strong>{item.employee}</strong><span className={`engine-chip ${item.engine}`}>{item.engine === "ai" ? <><Bot size={12} />AI</> : "Rules"}</span></div>
      <p>{item.headline}</p>
      {quote && <q className="note-quote">{quote}</q>}
      <div className="plan-foot"><span className="kinds">{[...new Set(item.items.map(i => KIND_LABEL[i.kind]))].slice(0, 3).join(" · ")}</span><PayChange item={item} /></div>
    </button>
    {onApprove && <button className="button primary small" disabled={busy} onClick={onApprove}><Check size={14} />Approve</button>}
  </motion.article>;
}

function PlanDrawer({ item, onClose, run, busy, onOpenCard }: {
  item: Resolution; onClose: () => void; run: Run; busy: boolean; onOpenCard: (id: string) => void;
}) {
  const [reason, setReason] = useState("");
  return <div className="drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <motion.aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="plan-title"
      initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
      <header><div><span className="label">{LANES.find(l => l.key === item.lane)?.title ?? "No issues"}</span><h2 id="plan-title">{item.employee}</h2><small className="muted figure">{item.card_id}</small></div>
        <button className="icon-button" aria-label="Close plan" onClick={onClose}><X size={18} /></button></header>
      <p className="drawer-lead">{item.headline}</p>
      <section><h3>What the agent proposes</h3>
        <ol className="plan-items">{item.items.map(i => <li key={i.exception_id}><span className={`kind kind-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
          <p>{i.reason}</p>{i.quote && <q className="note-quote">{i.quote}</q>}</li>)}</ol></section>
      <section><h3><ShieldCheck size={15} /> Pay engine check</h3>
        {item.correction ? <div className={`engine-box ${item.simulation.ok ? "ok" : "bad"}`}>
          <strong>{item.simulation.ok ? "The fix clears the problem and creates no new one." : "The fix was rejected."}</strong>
          {!item.simulation.ok && <ul>{item.simulation.failures.map(f => <li key={f}>{f}</li>)}</ul>}
          <span className="figure">Gross pay {item.simulation.before_total === null ? "unknown" : currency(item.simulation.before_total)} → {item.simulation.after_total === null ? "unknown" : currency(item.simulation.after_total)}</span>
        </div> : <div className="engine-box ok"><strong>No punches change.</strong><span>Approving records the decision; pay stays as the engine computed it.</span></div>}</section>
      <section><h3>Agent steps</h3><ol className="trace">{item.trace.map((s, n) => <li key={n} className={s.ok === false ? "bad" : ""}>{stepText(s)}</li>)}</ol></section>
      <footer>
        <button className="text-button" onClick={() => onOpenCard(item.card_id)}><FileText size={14} />Open timecard</button>
        {item.state === "open" && item.lane !== "clear" && <>
          <input aria-label="Reason to reject" placeholder="Reason to reject (8+ characters)" value={reason} onChange={e => setReason(e.target.value)} />
          <button className="button secondary" disabled={busy || reason.length < 8} onClick={() => run(async () => {
            await api(`/resolutions/${item.id}/reject`, "POST", { reason }); onClose();
          }, "Plan rejected. Nothing changed.")}>Reject</button>
          {item.lane === "ready" && <button className="button primary" disabled={busy} onClick={() => run(async () => {
            const result = await api<{ status: string; failures: string[] }>(`/resolutions/${item.id}/approve`, "POST");
            if (result.status !== "approved") throw new Error(`Verifier blocked it: ${result.failures.join("; ")}`);
            onClose();
          }, "Approved. The verified correction is committed.")}>Approve</button>}
        </>}
        {item.state !== "open" && <span className={`badge ${item.state === "approved" ? "green" : "neutral"}`}>{item.state}</span>}
      </footer>
    </motion.aside>
  </div>;
}

export default function Queue({ run, busy, refresh, aiReady, model, onOpenCard }: {
  run: Run; busy: boolean; refresh: number; aiReady: boolean; model: string | null; onOpenCard: (id: string) => void;
}) {
  const [data, setData] = useState<Data>({ run: null, items: [] });
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api<Data>("/resolutions").then(setData).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load, refresh]);
  useEffect(() => {
    if (data.run?.status !== "running") return;
    const timer = window.setInterval(load, 900);
    return () => window.clearInterval(timer);
  }, [data.run?.status, load]);
  const live = useMemo(() => data.items.filter(i => i.state === "open"), [data.items]);
  const done = data.items.filter(i => i.state === "approved").length;
  const clear = data.items.filter(i => i.lane === "clear").length;
  const total = data.run?.total ?? 0;
  const ready = clear + done;
  const running = data.run?.status === "running";
  const selected = data.items.find(i => i.id === open);
  return <section className="resolution">
    <div className="run-bar card">
      <div className="run-copy"><h2>Resolve the queue</h2>
        <p>The agent plans a compliant fix for every exception, the pay engine checks each one, and the plan lands in the lane of whoever acts next.</p></div>
      <div className="run-actions">
        <span className={`engine-chip big ${aiReady ? "ai" : "rules"}`}>{aiReady ? <><Bot size={14} />AI on · {model}</> : "Rules only (AI off)"}</span>
        <button className="button primary" disabled={busy || running} onClick={() => run(async () => {
          await api("/agent/runs", "POST", { use_ai: aiReady }); await load();
        }, "Agent started. Plans will appear as each timecard is checked.")}><Play size={15} />{data.run ? "Run agent again" : "Run agent"}</button>
      </div>
      {data.run && <div className="run-progress" aria-label="Agent progress">
        <div className="bar"><motion.i animate={{ width: `${total ? (data.run.done / total) * 100 : 0}%` }} transition={{ duration: .4 }} /></div>
        <small className="muted">{running ? `Checking timecard ${data.run.done} of ${total}…` : `Run finished · ${data.run.mode === "ai" ? `AI (${data.run.model})` : "rules only"} · ${new Date(data.run.started_at).toLocaleTimeString()}`}</small>
      </div>}
    </div>
    {data.run && <div className="kpis">
      <div className="kpi tone-green"><span>Payroll-ready timecards</span><strong><CountUp value={ready} /> <small>of {total}</small></strong></div>
      {LANES.map((lane, n) => <div key={lane.key} className={`kpi tone-${["blue", "violet", "amber"][n]}`}><span>{lane.title}</span><strong><CountUp value={live.filter(i => i.lane === lane.key).length} /></strong></div>)}
    </div>}
    {!data.run && <div className="empty card"><Clock3 size={22} /><h3>No agent run yet</h3><p>Sign the ruleset, then run the agent. It works through all 60 timecards and sorts every exception.</p></div>}
    {data.run && <div className="lanes">{LANES.map(lane => {
      const items = live.filter(i => i.lane === lane.key);
      return <section key={lane.key} className={`lane lane-${lane.key}`} aria-label={lane.title}>
        <header><span className="lane-icon">{lane.icon}</span><div><h3>{lane.title} <span className="count">{items.length}</span></h3><small>{lane.hint}</small></div></header>
        {lane.key === "ready" && items.length > 0 && <button className="button primary wide" disabled={busy || running} onClick={() => run(async () => {
          const result = await api<{ approved: number; blocked: number }>("/resolutions/approve-ready", "POST");
          if (result.blocked) throw new Error(`${result.approved} approved, ${result.blocked} blocked by the verifier`);
        }, "All ready plans approved and committed after verification.")}><CheckCheck size={15} />Approve all {items.length}</button>}
        <div className="lane-body"><AnimatePresence>{items.map(item => <PlanCard key={item.id} item={item} busy={busy}
          onOpen={() => setOpen(item.id)}
          onApprove={lane.key === "ready" ? () => run(async () => {
            const result = await api<{ status: string; failures: string[] }>(`/resolutions/${item.id}/approve`, "POST");
            if (result.status !== "approved") throw new Error(`Verifier blocked it: ${result.failures.join("; ")}`);
          }, `${item.employee}: approved and committed.`) : undefined} />)}</AnimatePresence>
          {!items.length && <p className="muted lane-empty">{running ? "Working…" : "Nothing here."}</p>}</div>
      </section>;
    })}</div>}
    {selected && <PlanDrawer item={selected} onClose={() => setOpen(null)} run={run} busy={busy} onOpenCard={id => { setOpen(null); onOpenCard(id); }} />}
  </section>;
}

/** Employee view: one-tap answers to the agent's questions. */
export function Questions({ run, busy, refresh }: { run: Run; busy: boolean; refresh: number }) {
  const [items, setItems] = useState<Resolution[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  useEffect(() => { api<Data>("/resolutions").then(d => setItems(d.items)).catch(() => undefined); }, [refresh]);
  if (!items.length) return null;
  return <section className="questions card" aria-label="Questions for you">
    <div className="card-head"><span className="chip-icon"><UserRound size={16} /></span><h3>Questions for you</h3><span className="badge amber">{items.length}</span></div>
    {items.map(item => {
      const question = item.items.find(i => i.question);
      const canTime = question?.kind === "fill_punch";
      return <div key={item.id} className="question">
        <p>{question?.question ?? item.headline}</p>
        <div className="question-actions">
          <button className="button primary small" disabled={busy} onClick={() => run(() => api(`/resolutions/${item.id}/answer`, "POST", { reply: "yes" }),
            "Thanks. Your manager will approve it next.")}>Yes, that's right</button>
          {canTime && <><input aria-label="Correct time" type="time" value={times[item.id] || ""} onChange={e => setTimes(t => ({ ...t, [item.id]: e.target.value }))} />
            <button className="button secondary small" disabled={busy || !times[item.id]} onClick={() => run(() => api(`/resolutions/${item.id}/answer`, "POST", { reply: "correct", time: times[item.id] }),
              "Thanks. We updated the time and re-checked your pay.")}>Use this time</button></>}
          <button className="text-button" disabled={busy} onClick={() => run(() => api(`/resolutions/${item.id}/answer`, "POST", { reply: "no" }),
            "Thanks. A manager will look at it.")}>No</button>
        </div>
      </div>;
    })}
  </section>;
}
