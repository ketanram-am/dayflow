import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CheckCheck, Clock, Gavel, Play, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import { dayflow, type Lane, type Resolution } from "@/lib/dayflow";
import { AppShell, Card, Empty } from "@/components/AppShell";
import { KpiTile } from "@/components/ModuleUI";
import { AdminOnly, KIND_LABEL, humanise } from "@/components/dayflow/AdminOnly";
import { Money } from "@/components/dayflow/Money";
import { head, State } from "@/components/EngineUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/queue")({
  head: head("Resolution Queue", "Every fix is proven by the pay engine before you see it."),
  component: Page,
});

const LANES: { lane: Lane; title: string; border: string }[] = [
  { lane: "ready", title: "Ready to approve", border: "border-t-success" },
  { lane: "waiting", title: "Waiting on the employee", border: "border-t-warning" },
  { lane: "judgment", title: "Needs your judgment", border: "border-t-destructive" },
];

function Page() {
  const { user } = Route.useRouteContext();
  return <AppShell user={user} title="Resolution Queue"><AdminOnly userId={user.id}><Queue /></AdminOnly></AppShell>;
}

function Queue() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Resolution | null>(null);
  const config = useQuery({ queryKey: ["dayflow", "config"], queryFn: dayflow.config });
  const list = useQuery({ queryKey: ["dayflow", "resolutions"], queryFn: dayflow.resolutions });
  const latest = useQuery({
    queryKey: ["dayflow", "latestRun"], queryFn: dayflow.latestRun,
    refetchInterval: (q) => (q.state.data?.run?.status === "running" ? 900 : false),
  });
  const run = latest.data?.run ?? list.data?.run ?? null;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (run?.status === "running") wasRunning.current = true;
    else if (wasRunning.current && run) {
      wasRunning.current = false;
      toast.success(`Agent finished: ${run.lanes.ready ?? 0} ready, ${run.lanes.waiting ?? 0} waiting, ${run.lanes.judgment ?? 0} need you`);
      qc.invalidateQueries({ queryKey: ["dayflow", "resolutions"] });
    }
  }, [run, qc]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dayflow"] });
  // The switch is the server-side "AI on" flag, so the run really uses the model (and the audit log shows who turned it on).
  const aiOn = !!config.data?.llm_enabled && !!config.data?.llm_configured;
  const toggleAi = useMutation({
    mutationFn: (enabled: boolean) => dayflow.setAi(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dayflow", "config"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const start = useMutation({ mutationFn: () => dayflow.startRun(aiOn), onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const ready = useMutation({
    mutationFn: dayflow.approveReady,
    onSuccess: (r) => { toast.success(`${r.approved} approved, ${r.blocked} blocked`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const items = (list.data?.items ?? []).filter((i) => i.state === "open");
  const aiAvailable = !!config.data?.llm_configured;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Resolution queue</h2>
          <p className="text-sm text-muted-foreground">Every fix is proven by the pay engine before you see it.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm" title={aiAvailable ? undefined : "No AI model is configured on the server"}>
            <Switch checked={aiOn} onCheckedChange={(v) => toggleAi.mutate(v)} disabled={!aiAvailable || toggleAi.isPending} aria-label="Use AI to read employee notes" />
            Use AI to read employee notes
          </label>
          <Button onClick={() => start.mutate()} disabled={start.isPending || run?.status === "running"}><Play className="mr-1 h-4 w-4" />Run agent</Button>
        </div>
      </div>

      {run?.status === "running" && (
        <Card><p className="mb-2 text-sm">Planning fixes… {run.done} / {run.total}</p><Progress value={run.total ? (run.done / run.total) * 100 : 0} /></Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Ready to approve" value={run?.lanes.ready ?? 0} icon={CheckCircle2} tone="success" />
        <KpiTile label="Waiting on employee" value={run?.lanes.waiting ?? 0} icon={Clock} tone="warning" />
        <KpiTile label="Needs your judgment" value={run?.lanes.judgment ?? 0} icon={Gavel} tone="danger" />
        <KpiTile label="Approved this run" value={run?.approved ?? 0} icon={CheckCheck} tone="primary" />
      </div>

      <State loading={list.isLoading} error={list.error}>
        {!run ? (
          <Card className="text-center"><p className="mb-3 text-sm text-muted-foreground">Run the agent to plan fixes for every exception.</p>
            <Button onClick={() => start.mutate()} disabled={start.isPending}><Play className="mr-1 h-4 w-4" />Run agent</Button></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {LANES.map((l) => {
              const laneItems = items.filter((i) => i.lane === l.lane);
              return (
                <section key={l.lane} aria-label={l.title} className={cn("rounded-2xl border border-t-4 bg-card p-4 shadow-card", l.border)}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-sm font-semibold">{l.title} <span className="text-muted-foreground">({laneItems.length})</span></h3>
                    {l.lane === "ready" && laneItems.length > 0 && (
                      <Button size="sm" disabled={ready.isPending} onClick={() => { if (confirm(`Approve all ${laneItems.length} ready fixes? Each is re-verified first.`)) ready.mutate(); }}>Approve all</Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence initial={false}>
                      {laneItems.map((i) => (
                        <motion.button layout key={i.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                          onClick={() => setOpen(i)} className="w-full rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{i.employee}</span><span>{i.card_id}</span></div>
                          <p className="mt-1 text-sm">{i.headline}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {[...new Set(i.items.map((x) => x.kind))].map((k) => <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{KIND_LABEL[k] ?? humanise(k)}</span>)}
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">{i.engine === "ai" ? "AI read the note" : "Rules"}</span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground"><Money value={i.simulation.before_total} /> → <Money value={i.simulation.after_total} className="font-medium text-foreground" /></p>
                        </motion.button>
                      ))}
                    </AnimatePresence>
                    {!laneItems.length && <p className="text-xs text-muted-foreground">Nothing here.</p>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </State>
      <PlanDrawer item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />
    </div>
  );
}

function PlanDrawer({ item, onClose, onDone }: { item: Resolution | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const approve = useMutation({
    mutationFn: (id: string) => dayflow.approve(id),
    onSuccess: (r) => { r.verified ? toast.success("Approved and committed") : toast.error(`Blocked: ${r.failures.join("; ")}`); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (id: string) => dayflow.reject(id, reason),
    onSuccess: () => { toast.success("Rejected"); setReason(""); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {item && <>
          <SheetHeader><SheetTitle>{item.employee} · {item.card_id}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-5 text-sm">
            {item.hostile && <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive"><ShieldAlert className="h-4 w-4 shrink-0" />This note tried to give instructions to the system. It was not sent to the AI.</div>}
            <p className="font-medium">{item.headline}</p>
            <section><h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Plan</h4>
              <ul className="space-y-2">{item.items.map((x, n) => (
                <li key={n} className="rounded-lg border p-3">
                  <p className="font-medium">{KIND_LABEL[x.kind] ?? humanise(x.kind)}{x.time && <span className="ml-2 text-primary">{x.field} {x.time}</span>}</p>
                  <p className="text-xs text-muted-foreground">{x.reason}</p>
                  {x.source === "note" && x.quote && <blockquote className="mt-2 border-l-2 border-primary pl-3 italic">“{x.quote}”</blockquote>}
                  {x.kind === "fix_schedule" && x.detail && (
                    <div className="mt-2 text-xs">
                      <p>{x.detail.mode === "reassign" ? `Give to ${x.detail.to_employee}` : `${x.detail.when} → ${x.detail.to_when}`}</p>
                      <ul className="mt-1 space-y-0.5">{x.detail.checks?.map((c) => <li key={c} className="flex gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-success" />{c}</li>)}</ul>
                    </div>
                  )}
                </li>))}</ul>
            </section>
            <section><h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Engine check</h4>
              <p className="flex items-center gap-1">{item.simulation.ok ? <><CheckCircle2 className="h-4 w-4 text-success" />Verified</> : <><XCircle className="h-4 w-4 text-destructive" />Not verified</>}</p>
              {item.simulation.failures.map((f) => <p key={f} className="text-xs text-destructive">{f}</p>)}
              <p className="text-xs text-muted-foreground">Pay <Money value={item.simulation.before_total} /> → <Money value={item.simulation.after_total} /></p>
              {!!item.simulation.cleared.length && <p className="text-xs">Clears: {item.simulation.cleared.join(", ")}</p>}
              {!!item.simulation.new_blocking.length && <p className="text-xs text-destructive">New blocking: {item.simulation.new_blocking.join(", ")}</p>}
            </section>
            {!!item.trace?.length && <section><h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Agent steps</h4>
              <ol className="space-y-1 border-l pl-4">{item.trace.map((t, n) => (
                <li key={n} className={cn("text-xs", t.ok === false && "text-warning")}>
                  {t.ok === false && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                  {humanise(t.step)}{t.attempt ? ` (attempt ${t.attempt})` : ""}{t.error ? `: AI answer rejected: ${t.error}` : ""}{t.reason ? ` — ${t.reason}` : ""}
                </li>))}</ol></section>}
            {item.lane === "waiting" && <p className="flex items-center gap-1 text-warning"><Clock className="h-4 w-4" />Waiting for {item.employee} to confirm.</p>}
            {item.lane === "judgment" && <p className="flex items-center gap-1 text-destructive"><Gavel className="h-4 w-4" />The engine could not prove a fix on its own, so a person must decide.</p>}
            <div className="space-y-2 border-t pt-4">
              {item.lane === "ready" && <Button className="w-full" disabled={approve.isPending} onClick={() => approve.mutate(item.id)}><Sparkles className="mr-1 h-4 w-4" />Approve</Button>}
              <div className="flex gap-2">
                <Input placeholder="Reason to reject (8+ characters)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reject reason" />
                <Button variant="outline" disabled={reason.trim().length < 8 || reject.isPending} onClick={() => reject.mutate(item.id)}>Reject</Button>
              </div>
            </div>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}
