import { useState } from "react";
import { motion } from "motion/react";
import { api, type PolicyDocument } from "./api";
import { currency, friendly, type Run } from "./App";
import { CountUp } from "./motion";

type Provenance = {
  field: string; clause?: string; value?: string; quote?: string | null; ambiguous?: boolean;
  needs_human?: boolean; source: string; note?: string;
};
type Draft = { status: string; document: PolicyDocument | null; provenance: Provenance[]; message: string };

/** AI policy compiler: prose -> rules with a verbatim quote per rule. Draft only; a human signs. */
export function ExtractPanel({ onLoad, busy }: { onLoad: (document: PolicyDocument) => void; busy: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const extract = async () => {
    setWorking(true); setError("");
    try {
      setDraft(await api<Draft>("/policies/draft-from-prose", "POST", { version: `ai-draft-${Date.now()}` }));
    } catch (err) { setError(err instanceof Error ? err.message : "Extraction failed"); }
    finally { setWorking(false); }
  };
  return <section className="ai-panel" aria-label="AI policy compiler">
    <div className="section-heading"><h3>AI policy compiler</h3>
      <button className="button secondary small" disabled={busy || working} onClick={extract}>{working ? "Reading policy…" : "Extract rules from policy text"}</button></div>
    <p className="muted">The model reads the policy prose and must quote each rule verbatim. Quotes and values are checked in code; unclear rules keep the reviewed baseline and are flagged for you. Nothing is saved or signed until you do it.</p>
    {error && <div role="alert" className="notice error"><span>{error}</span></div>}
    {draft && <>
      <div className={`info-box ${draft.status === "extracted" ? "" : "warn"}`}>{draft.status === "extracted" ? "Model extraction" : draft.status === "offline" ? "AI is off: baseline shown, every rule needs human review" : "Manual review required"}. {draft.message}</div>
      <table className="rules-table"><thead><tr><th>Parameter</th><th className="numeric">Value</th><th>Verbatim quote</th><th>Status</th></tr></thead>
        <tbody>{draft.provenance.filter(p => p.field !== "*").map(p => <tr key={p.field}>
          <td>{friendly(p.field)}<small>{p.clause}</small></td><td className="numeric figure">{p.value}</td>
          <td>{p.quote ? <q>{p.quote}</q> : <span className="muted">no model quote</span>}{p.note && <small>{p.note}</small>}</td>
          <td><span className={`badge ${p.needs_human ? "amber" : "green"}`}>{p.needs_human ? "Human check" : "Quote verified"}</span></td></tr>)}</tbody></table>
      {draft.document && <button className="button primary" onClick={() => onLoad(draft.document!)}>Load draft into compiler</button>}
    </>}
  </section>;
}

type Replay = {
  period_start: string; active_version: string; candidate_version: string; cards: number;
  changed: number; incomplete: number; total_before: string; total_after: string; total_delta: string;
  by_component: Record<string, string>;
  rows: { card_id: string; employee: string; employment: string; before: string | null; after: string | null; delta: string | null }[];
};

/** Policy change replay: active ruleset vs the selected version on the latest pay period. */
export function ReplayPanel({ candidateId, candidateLabel }: { candidateId: string; candidateLabel: string }) {
  const [result, setResult] = useState<Replay | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setWorking(true); setError("");
    try { setResult(await api<Replay>("/policies/replay", "POST", { candidate_id: candidateId })); }
    catch (err) { setError(err instanceof Error ? err.message : "Replay failed"); }
    finally { setWorking(false); }
  };
  const delta = result ? Number(result.total_delta) : 0;
  return <section className="ai-panel" aria-label="Policy change replay">
    <div className="section-heading"><h3>Policy change replay</h3>
      <button className="button secondary small" disabled={working} onClick={go}>{working ? "Replaying…" : `Replay ${candidateLabel} on last period`}</button></div>
    <p className="muted">Recomputes the latest pay period with the active ruleset and with this version, using the same engine. Read-only; nothing is changed.</p>
    {error && <div role="alert" className="notice error"><span>{error}</span></div>}
    {result && <>
      <div className="replay-summary"><div><span>Active ({result.active_version})</span><strong className="figure">{currency(result.total_before)}</strong></div>
        <div><span>This version ({result.candidate_version})</span><strong className="figure">{currency(result.total_after)}</strong></div>
        <div><span>Dollar impact</span><strong className={`figure ${delta > 0 ? "up" : ""}`}>{delta > 0 ? "+" : ""}{currency(result.total_delta)}</strong></div>
        <div><span>Timecards changed</span><strong>{result.changed} of {result.cards}</strong></div></div>
      {result.incomplete > 0 && <small className="muted">{result.incomplete} timecards have incomplete pay and are excluded from totals.</small>}
      {Object.keys(result.by_component).length > 0 && <p className="muted">By component: {Object.entries(result.by_component).map(([k, v]) => `${friendly(k)} ${Number(v) > 0 ? "+" : ""}${v}`).join(" · ")}</p>}
      <table className="rules-table"><thead><tr><th>Employee</th><th className="numeric">Before</th><th className="numeric">After</th><th className="numeric">Change</th></tr></thead>
        <tbody>{result.rows.filter(r => r.delta !== "0.00").slice(0, 12).map(r => <tr key={r.card_id}><td>{r.employee}<small>{friendly(r.employment)}</small></td>
          <td className="numeric figure">{r.before === null ? "—" : currency(r.before)}</td><td className="numeric figure">{r.after === null ? "—" : currency(r.after)}</td>
          <td className="numeric figure">{r.delta === null ? "incomplete" : `${Number(r.delta) > 0 ? "+" : ""}${r.delta}`}</td></tr>)}</tbody></table>
      {result.changed === 0 && <div className="info-box">No pay changes for this period under this version.</div>}
    </>}
  </section>;
}

type Chat = { text: string; source: string; status: string; notice: string | null; cited_line_ids: string[] };

/** Explain my paycheck: wording from the model, every number checked against the engine trace. */
export function ExplainChat({ cardId, onCite }: { cardId: string; onCite?: (id: string) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Chat | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const ask = async (e: React.FormEvent) => {
    e.preventDefault(); setWorking(true); setError("");
    try { setAnswer(await api<Chat>(`/cards/${cardId}/explain`, "POST", { question })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not explain"); }
    finally { setWorking(false); }
  };
  return <section className="ai-panel" aria-label="Explain my paycheck">
    <div className="section-heading"><h3>Explain my paycheck</h3></div>
    <form className="chat-form" onSubmit={ask}><label className="sr-only" htmlFor="explain-q">Your question</label>
      <input id="explain-q" value={question} onChange={e => setQuestion(e.target.value)} minLength={3} maxLength={300} required
        placeholder="e.g. Why is my overtime pay this amount?" />
      <button className="button primary small" disabled={working}>{working ? "Checking…" : "Explain"}</button></form>
    {error && <div role="alert" className="notice error"><span>{error}</span></div>}
    {answer && <div className="chat-answer"><p>{answer.text}</p>
      <div className="citation-row">{answer.cited_line_ids.map(id => <button className="citation" key={id} onClick={() => onCite?.(id)}>{id}</button>)}</div>
      <small className="muted"><span className={`badge ${answer.source === "model" ? "green" : "neutral"}`}>{answer.source === "model" ? "Model wording · numbers verified" : "Engine derivation"}</span> {answer.notice}</small></div>}
  </section>;
}

type Unsafe = { verified: boolean; failures: string[]; committed: boolean; edit: { start: string; end: string } };

/** Proposes an overlapping duplicate shift and shows the verifier rejecting it. */
export function UnsafeFixDemo({ cardId, run, busy }: { cardId: string; run: Run; busy: boolean }) {
  const [result, setResult] = useState<Unsafe | null>(null);
  return <section className="ai-panel" aria-label="Unsafe fix demo">
    <div className="section-heading"><h3>Unsafe fix demo</h3>
      <button className="button secondary small" disabled={busy} onClick={() => run(async () => {
        setResult(await api<Unsafe>(`/cards/${cardId}/demo/unsafe-fix`, "POST"));
      }, "Unsafe proposal created and rejected by the verifier. Nothing was committed.")}>Propose an unsafe fix</button></div>
    <p className="muted">Creates a real proposal that duplicates an existing shift. The engine must refuse it. It is recorded in the audit ledger and never committed.</p>
    {result && <div className={result.verified ? "info-box" : "critic flagged"}><strong>{result.verified ? "Unexpectedly verified" : "Rejected by the verifier"}</strong>
      <ul>{result.failures.map(f => <li key={f}>{f}</li>)}</ul></div>}
  </section>;
}

type WhatIfResult = {
  status: string; source?: string; note?: string; message: string; document?: PolicyDocument;
  change?: { field: string; label: string; unit: string; clause: string; old: string; new: string; clause_before: string; clause_after: string };
  replay?: Replay;
};
const RULES: [string, string][] = [
  ["daily_minutes", "Daily overtime after (minutes)"], ["double_minutes", "Double time after (minutes)"],
  ["weekly_minutes", "Weekly overtime after (minutes)"], ["night_differential", "Night differential (USD/hour)"],
  ["first_meal_minutes", "First meal after (minutes)"], ["second_meal_minutes", "Second meal after (minutes)"],
  ["tolerance_minutes", "Punch tolerance (minutes)"],
];
const EXAMPLES = ["What if overtime started after 7 hours?", "What if weekly overtime started after 38 hours?", "What if night shifts paid $3 more?"];

/** Policy what-if: plain English -> draft rule change -> engine replay -> dollar impact. */
export function WhatIfPanel({ run, busy, onSaved }: { run: Run; busy: boolean; onSaved: (id: string) => void }) {
  const [question, setQuestion] = useState("");
  const [field, setField] = useState("daily_minutes");
  const [value, setValue] = useState("");
  const [manual, setManual] = useState(false);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const ask = async (text?: string) => {
    setWorking(true); setError(""); setResult(null);
    try {
      const body = manual ? { field, value: Number(value) } : { question: text ?? question };
      setResult(await api<WhatIfResult>("/policies/what-if", "POST", body));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not run what-if"); }
    finally { setWorking(false); }
  };
  const replay = result?.replay;
  const delta = replay ? Number(replay.total_delta) : 0;
  return <section className="ai-panel whatif" aria-label="Policy what-if">
    <div className="section-heading"><h3>What if we changed a rule?</h3><span className="badge neutral">Draft only · nothing is saved</span></div>
    <p className="muted">Ask in plain English. The assistant picks the rule and the new value; the pay engine then recomputes last period under both rulesets, so the cost comes from calculation, not from AI.</p>
    <form className="chat-form" onSubmit={e => { e.preventDefault(); void ask(); }}>
      {!manual ? <><label className="sr-only" htmlFor="whatif-q">What-if question</label>
        <input id="whatif-q" value={question} onChange={e => setQuestion(e.target.value)} maxLength={300} required placeholder="e.g. What if overtime started after 7 hours?" /></> :
        <><label className="sr-only" htmlFor="whatif-f">Rule</label><select id="whatif-f" value={field} onChange={e => setField(e.target.value)}>{RULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="sr-only" htmlFor="whatif-v">New value</label><input id="whatif-v" type="number" step="any" min="0" value={value} onChange={e => setValue(e.target.value)} placeholder="New value" required /></>}
      <button className="button primary small" disabled={working || busy}>{working ? "Calculating…" : "Show the cost"}</button>
    </form>
    <div className="chips">{EXAMPLES.map(x => <button key={x} type="button" className="chip" disabled={working || manual} onClick={() => { setQuestion(x); void ask(x); }}>{x.replace("What if ", "").replace("?", "")}</button>)}
      <button type="button" className="text-button" onClick={() => setManual(!manual)}>{manual ? "Ask in plain English" : "Choose a rule manually"}</button></div>
    {error && <div role="alert" className="notice error"><span>{error}</span></div>}
    {result && result.status !== "ok" && <div className="info-box warn">{result.message}</div>}
    {result?.status === "ok" && result.change && replay && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="whatif-result">
      <div className="change-line"><span className={`badge ${result.source === "model" ? "green" : "neutral"}`}>{result.source === "model" ? "Understood by AI" : result.source === "rules" ? "Understood by rule parser" : "Chosen manually"}</span>
        <strong>{result.change.label}</strong><span className="figure">{result.change.old} → {result.change.new} {result.change.unit}</span><code>{result.change.clause}</code></div>
      {result.note && <small className="muted">{result.note}</small>}
      <div className="replay-summary">
        <div><span>Cost change, {replay.period_start}</span><strong className={`figure ${delta > 0 ? "up" : ""}`}>{delta > 0 ? "+" : delta < 0 ? "−" : ""}$<CountUp value={Math.abs(delta)} format={n => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} /></strong></div>
        <div><span>Timecards affected</span><strong><CountUp value={replay.changed} /> of {replay.cards}</strong></div>
        <div><span>Before → after</span><strong className="figure small">{currency(replay.total_before)} → {currency(replay.total_after)}</strong></div>
      </div>
      {replay.incomplete > 0 && <small className="muted">{replay.incomplete} timecards have incomplete pay and are not in these totals.</small>}
      {Object.keys(replay.by_component).length > 0 && <p className="muted">Where it lands: {Object.entries(replay.by_component).map(([k, v]) => `${friendly(k)} ${Number(v) > 0 ? "+" : ""}${v}`).join(" · ")}</p>}
      <table className="rules-table"><thead><tr><th>Who is affected</th><th className="numeric">Before</th><th className="numeric">After</th><th className="numeric">Change</th></tr></thead>
        <tbody>{replay.rows.filter(r => r.delta !== "0.00" && r.delta !== null).slice(0, 8).map(r => <tr key={r.card_id}><td>{r.employee}<small>{friendly(r.employment)}</small></td>
          <td className="numeric figure">{currency(r.before)}</td><td className="numeric figure">{currency(r.after)}</td><td className="numeric figure">{Number(r.delta) > 0 ? "+" : ""}{r.delta}</td></tr>)}</tbody></table>
      <details><summary>Policy wording that would change</summary>
        <div className="clause-diff"><span className="label">Before</span><pre>{result.change.clause_before}</pre><span className="label">After</span><pre>{result.change.clause_after}</pre></div></details>
      <button className="button secondary" disabled={busy} onClick={() => run(async () => {
        const saved = await api<{ id: string }>("/policies/compile", "POST", { ...result.document, version: `what-if-${Date.now().toString(36)}` });
        onSaved(saved.id);
      }, "Saved as an unsigned draft version. Review and sign it in the version list to use it.")}>Save as draft version</button>
    </motion.div>}
  </section>;
}
