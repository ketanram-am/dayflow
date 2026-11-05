import { useState, type ComponentType, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, Loader2, RefreshCw, Send, Sparkles as Spark } from "lucide-react";
import { wf } from "@/lib/api";
import type { AssistantReply } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import robot from "@/assets/ai-robot.png";

type Tone = "success" | "primary" | "violet" | "warning" | "danger";
const toneCls: Record<Tone, string> = {
  success: "bg-success/15 text-success",
  primary: "bg-primary/15 text-primary",
  violet: "bg-accent text-accent-foreground",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
};

export function ModuleHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold text-foreground md:text-2xl">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function KpiTile({ label, value, sub, icon: Icon, tone = "primary", valueTone }: { label: string; value: ReactNode; sub?: ReactNode; icon: ComponentType<{ className?: string }>; tone?: Tone; valueTone?: "success" | "default" }) {
  return (
    <div className="flex h-full items-center gap-3 rounded-2xl border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", toneCls[tone])}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("truncate font-display text-lg font-semibold tabular-nums md:text-xl", valueTone === "success" ? "text-success" : "text-foreground")}>{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

type Mod = "geopulse" | "shifts" | "wellness" | "sync" | "tasks" | "leave";
type Res = AssistantReply;
const sourceLabel = (r: { source: "rules" | "model" }) => (r.source === "model" ? "Model wording, numbers verified" : "Rule-based findings");

/** One-click AI insights generated on the server from real records. */
export function AIInsightsCard({ module, title, clientData, className }: { module: Mod; title: string; clientData?: string; className?: string }) {
  const [res, setRes] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setRes(await wf.ask(module, undefined)); }
    catch { setRes({ ok: false, error: "Could not reach the AI service." }); }
    finally { setBusy(false); }
  }
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card to-accent/40 p-4 shadow-card md:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-primary"><Spark className="h-4 w-4" /> {title}</h3>
        <Button size="sm" variant={res ? "ghost" : "default"} disabled={busy} onClick={run}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : res ? <RefreshCw className="h-3.5 w-3.5" /> : null}
          {res ? "Refresh" : busy ? "Analysing…" : "Analyse"}
        </Button>
      </div>
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 text-sm">
          {!res && !busy && <p className="text-muted-foreground">Analyse your real attendance, break and shift records. Every finding cites its evidence and confidence.</p>}
          {busy && <p className="text-muted-foreground">Reading your records…</p>}
          {res && !res.ok && <p className="text-destructive">{res.error}</p>}
          {res?.ok && <div className="ai-md text-foreground"><ReactMarkdown>{res.text}</ReactMarkdown>
            <p className="mt-2 text-[11px] text-muted-foreground">{sourceLabel(res)}{res.notice ? ` · ${res.notice}` : ""}</p></div>}
        </div>
        <img src={robot} alt="" width={816} height={816} loading="lazy" className="hidden h-28 w-28 shrink-0 object-contain sm:block" />
      </div>
    </div>
  );
}

/** Conversational assistant; history is kept for this page visit only. */
export function AIAssistant({ module, title, suggestions, clientData }: { module: Mod; title: string; suggestions: string[]; clientData?: string }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string; error?: boolean; note?: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(q: string) {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setText("");
    setBusy(true);
    try {
      const r = await wf.ask(module, q);
      setMsgs((m) => [...m, r.ok ? { role: "assistant", content: r.text, note: `${sourceLabel(r)}${r.notice ? ` · ${r.notice}` : ""}` } : { role: "assistant", content: r.error, error: true }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Could not reach the AI service.", error: true }]);
    } finally { setBusy(false); }
  }
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary"><Bot className="h-4 w-4" /></div>
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {!msgs.length && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border bg-secondary px-3 py-1 text-xs text-secondary-foreground transition-colors hover:border-primary/50">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => m.role === "user"
          ? <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">{m.content}</div>
          : <div key={i} className={cn("ai-md text-sm", m.error ? "text-destructive" : "text-foreground")}><ReactMarkdown>{m.content}</ReactMarkdown>{m.note && <p className="mt-1 text-[11px] text-muted-foreground">{m.note}</p>}</div>)}
        {busy && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking records…</p>}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your records…" maxLength={1000} />
        <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
