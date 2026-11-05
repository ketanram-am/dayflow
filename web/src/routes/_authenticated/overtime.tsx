import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Send, TrendingUp, Users } from "lucide-react";
import { ApiError } from "@/lib/api";
import { dayflow, type ForecastOption, type ForecastPerson } from "@/lib/dayflow";
import { AppShell, Card, Empty } from "@/components/AppShell";
import { KpiTile } from "@/components/ModuleUI";
import { AdminOnly } from "@/components/dayflow/AdminOnly";
import { Money } from "@/components/dayflow/Money";
import { head, mins, State, when } from "@/components/EngineUI";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/overtime")({
  head: head("Overtime", "Overtime you can still stop this week, and next week's planned swaps."),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Overtime">
      <AdminOnly userId={user.id}>
        <Tabs defaultValue="live">
          <TabsList><TabsTrigger value="live">This week (live)</TabsTrigger><TabsTrigger value="next">Next week (planned)</TabsTrigger></TabsList>
          <TabsContent value="live"><Live /></TabsContent>
          <TabsContent value="next"><Next /></TabsContent>
        </Tabs>
      </AdminOnly>
    </AppShell>
  );
}

function Live() {
  const q = useQuery({ queryKey: ["dayflow", "forecast"], queryFn: dayflow.forecast });
  const f = q.data;
  return (
    <State loading={q.isLoading} error={q.error}>
      {f && <div className="space-y-4">
        <div><h2 className="font-display text-lg font-semibold">Overtime you can still stop</h2>
          <p className="text-sm text-muted-foreground">Worked hours so far plus the shifts still scheduled. Updated {when(f.as_of)}.</p></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile label="Potential saving" value={<Money value={f.potential_saving} />} icon={TrendingUp} tone="success" />
          <KpiTile label="People flagged" value={f.flagged.length} sub={`of ${f.employees_checked} checked`} icon={Users} tone="warning" />
          <KpiTile label="Weekly line" value={mins(f.threshold_minutes)} icon={AlertTriangle} tone="primary" />
        </div>
        {!f.flagged.length && <Empty>Nobody is heading into overtime this week.</Empty>}
        {f.flagged.map((p) => <Person key={p.employee_id} p={p} threshold={f.threshold_minutes} />)}
        {f.note && <p className="text-xs text-muted-foreground">{f.note}</p>}
      </div>}
    </State>
  );
}

function Person({ p, threshold }: { p: ForecastPerson; threshold: number }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState(p.recommended ?? p.options[0]?.id ?? "");
  const opt = p.options.find((o) => o.id === pick);
  const apply = useMutation({
    mutationFn: (o: ForecastOption) => dayflow.applyForecast(o.id),
    onSuccess: () => { toast.success("Applied and recorded in the audit ledger"); qc.invalidateQueries({ queryKey: ["dayflow"] }); },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 409) { toast.error(e.message); qc.invalidateQueries({ queryKey: ["dayflow", "forecast"] }); }
      else toast.error(e.message);
    },
  });
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div><p className="font-medium">{p.employee}</p><p className="text-xs text-muted-foreground">{p.department}</p></div>
        <p className="text-sm">{p.projected_minutes} min projected, {p.over_minutes} min over the {threshold} min line</p>
      </div>
      <div className="mb-4 grid grid-cols-7 gap-1" aria-label="Week by day">
        {p.days.map((d) => (
          <div key={d.date} className="text-center text-[10px] text-muted-foreground">
            <div className="mb-1 flex min-h-16 flex-col justify-center rounded bg-muted p-1">
              <span>{d.worked} min worked</span>
              <span>{d.remaining} min scheduled</span>
            </div>
            {new Date(d.date).toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>
      {!p.options.length ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{p.no_option_reason ?? "No safe option found."}</p>
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label={`Options for ${p.employee}`}>
          {p.options.map((o) => (
            <label key={o.id} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3", pick === o.id && "border-primary bg-primary/5")}>
              <input type="radio" name={p.employee_id} checked={pick === o.id} onChange={() => setPick(o.id)} className="mt-1" />
              <div className="flex-1 text-sm">
                <p className="font-medium">{o.title} {o.id === p.recommended && <span className="ml-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] text-success">Recommended</span>}</p>
                <p className="text-xs text-muted-foreground">Saves <Money value={o.saving} /> · {o.overtime_minutes_avoided} overtime min avoided</p>
                <ul className="mt-1 flex flex-wrap gap-x-3 text-[11px]">{o.checks.map((c) => <li key={c} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" />{c}</li>)}</ul>
              </div>
            </label>
          ))}
          <Button disabled={!opt || apply.isPending} onClick={() => {
            if (opt && confirm(`${opt.title}. This updates RotaFlow and is recorded in the audit ledger.`)) apply.mutate(opt);
          }}>Apply</Button>
        </div>
      )}
    </Card>
  );
}

function Next() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dayflow", "planner"], queryFn: dayflow.planner });
  const send = useMutation({
    mutationFn: dayflow.sendSwap,
    onSuccess: () => { toast.success("Recommendation recorded for scheduling review"); qc.invalidateQueries({ queryKey: ["dayflow"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <State loading={q.isLoading} error={q.error} empty={q.data && !q.data.suggestions.length && "No overtime expected next week."}>
      <div className="space-y-3">
        {q.data?.suggestions.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{s.employee} → {s.to ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{s.shift}</p>
                <p className="mt-1">{s.reason}</p>
                {s.before && s.after && <p className="mt-1 text-xs text-muted-foreground">Before: {s.before.employee} / {s.before.to} · After: {s.after.employee} / {s.after.to}</p>}
              </div>
              <div className="text-right text-sm">
                <p>Saves <Money value={s.saving} className="font-semibold" /></p>
                {s.to === null ? <span className="text-xs text-warning">No safe swap</span>
                  : s.sent ? <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">Sent</span>
                  : <Button size="sm" className="mt-2" disabled={send.isPending} onClick={() => send.mutate(s.id)}><Send className="mr-1 h-3.5 w-3.5" />Send to scheduling</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </State>
  );
}
