import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { dayflow, type AgentScore } from "@/lib/dayflow";
import { AppShell, Card, CardTitle } from "@/components/AppShell";
import { CountUp } from "@/components/CountUp";
import { AdminOnly, humanise } from "@/components/dayflow/AdminOnly";
import { head, State } from "@/components/EngineUI";
import { useMe } from "@/lib/attendance";

export const Route = createFileRoute("/_authenticated/scorecard")({
  head: head("Scorecard", "Measured, not claimed: agent accuracy and detection precision and recall."),
  component: Page,
});

const METRICS: { key: keyof AgentScore; label: string; pct?: boolean; lowerBetter?: boolean }[] = [
  { key: "item_accuracy_pct", label: "Item accuracy", pct: true },
  { key: "note_dependent_accuracy_pct", label: "Note-dependent accuracy", pct: true },
  { key: "lane_accuracy_pct", label: "Lane accuracy", pct: true },
  { key: "invented_or_wrong_from_note", label: "Invented or wrong from note", lowerBetter: true },
  { key: "verifier_rejected_plans", label: "Verifier rejected plans", lowerBetter: true },
  { key: "fallbacks_to_rules", label: "Fallbacks to rules", lowerBetter: true },
];

function Page() {
  const { user } = Route.useRouteContext();
  const me = useMe(user.id);
  const q = useQuery({ queryKey: ["dayflow", "scorecard"], queryFn: dayflow.scorecard, enabled: !!me.data?.isAdmin });
  const s = q.data;
  const rules = s?.agent?.rules_only;
  const ai = s?.agent?.ai ?? null;
  return (
    <AppShell user={user} title="Scorecard">
      <AdminOnly userId={user.id}>
        <State loading={q.isLoading} error={q.error}>
          {s && <div className="space-y-4">
            <Card>
              <CardTitle title="Measured, not claimed" hint={ai ? `Rules only vs ${ai.model}` : "No model run recorded"} />
              {rules ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {METRICS.map((m) => {
                    const a = Number(rules[m.key] ?? 0), b = ai ? Number(ai[m.key] ?? 0) : null;
                    const max = Math.max(m.pct ? 100 : 1, a, b ?? 0);
                    return (
                      <div key={m.key} className="rounded-xl border p-3">
                        <p className="mb-2 text-xs text-muted-foreground">{m.label}{m.lowerBetter && " (lower is better)"}</p>
                        {[["Rules", a, "bg-muted-foreground"], ["AI", b, "bg-primary"]].map(([lbl, v, c]) => v == null ? null : (
                          <div key={lbl as string} className="mb-1 flex items-center gap-2 text-xs">
                            <span className="w-10">{lbl}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded bg-muted"><div className={`h-full ${c} motion-safe:transition-all`} style={{ width: `${(Number(v) / max) * 100}%` }} /></div>
                            <span className="w-14 text-right font-semibold tabular-nums"><CountUp value={Number(v)} />{m.pct ? "%" : ""}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  <div className="rounded-xl border p-3 text-sm">
                    <p className="mb-2 text-xs text-muted-foreground">Manager minutes</p>
                    <p>Manual: <b><CountUp value={rules.manager_minutes_manual_estimate} /></b></p>
                    <p>With agent: <b><CountUp value={(ai ?? rules).manager_minutes_with_agent_estimate} /></b></p>
                  </div>
                </div>
              ) : <p className="text-sm text-muted-foreground">No agent evaluation recorded.</p>}
              {!ai && rules && <p className="mt-3 text-xs text-muted-foreground">No model run recorded.</p>}
            </Card>
            <Card>
              <CardTitle title="Detection" hint={`${s.labelled_exceptions} labelled exceptions · seed ${s.seed}`} />
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Family</th><th className="text-right">Precision</th><th className="text-right">Recall</th><th className="text-right">TP</th><th className="text-right">FP</th><th className="text-right">FN</th></tr></thead>
                <tbody>{Object.entries(s.detection ?? {}).map(([k, v]) => (
                  <tr key={k} className="border-t"><td className="py-1.5">{humanise(k)}</td><td className="text-right">{(v.precision * 100).toFixed(1)}%</td><td className="text-right">{(v.recall * 100).toFixed(1)}%</td><td className="text-right">{v.tp}</td><td className="text-right">{v.fp}</td><td className="text-right">{v.fn}</td></tr>
                ))}</tbody>
              </table>
            </Card>
            <p className="text-xs text-muted-foreground">{s.disclaimer}</p>
            <p className="text-xs text-muted-foreground">{s.provenance}</p>
          </div>}
        </State>
      </AdminOnly>
    </AppShell>
  );
}
