import { Fragment, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt, Search, Sparkles } from "lucide-react";
import { dayflow } from "@/lib/dayflow";
import { AppShell, Card, CardTitle } from "@/components/AppShell";
import { QuestionsCard } from "@/components/dayflow/Questions";
import { Money } from "@/components/dayflow/Money";
import { head, mins, Pill, State } from "@/components/EngineUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/lib/attendance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/pay")({
  head: head("Pay Explorer", "Line-by-line pay for each timecard, with formulas and plain-language answers."),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const me = useMe(user.id);
  const isAdmin = !!me.data?.isAdmin;
  const list = useQuery({ queryKey: ["dayflow", "cards"], queryFn: dayflow.cards });
  const [sel, setSel] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const cards = (list.data?.cards ?? []).filter((c) => !search || `${c.employee.name} ${c.id}`.toLowerCase().includes(search.toLowerCase()));
  const id = sel ?? (!isAdmin ? list.data?.cards[0]?.id : null) ?? null;
  return (
    <AppShell user={user} title={isAdmin ? "Pay Explorer" : "My pay"}>
      <div className="space-y-4">
        {!isAdmin && <QuestionsCard employeeId={user.employee_id} />}
        {(isAdmin || list.isLoading || !!list.error || !list.data?.cards.length || (list.data?.cards.length ?? 0) > 1) && (
          <Card>
            <CardTitle icon={Receipt} title="Timecards" right={<div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input className="h-8 w-56 pl-7" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>} />
            <State loading={list.isLoading} error={list.error} empty={!cards.length && "No timecards."}>
              <div className="max-h-80 overflow-auto"><table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Employee</th><th>Period</th><th>Status</th><th className="text-right">Total</th><th className="text-right">Open exceptions</th></tr></thead>
                <tbody>{cards.map((c) => (
                  <tr key={c.id} onClick={() => setSel(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(c.id)}
                    className={cn("cursor-pointer border-t hover:bg-muted/50", c.id === id && "bg-muted")}>
                    <td className="py-2">{c.employee.name}</td><td>{c.period_start} → {c.period_end}</td><td><Pill>{c.pay_status}</Pill></td>
                    <td className="text-right"><Money value={c.total} /></td><td className="text-right">{c.exceptions.length}</td>
                  </tr>))}</tbody>
              </table></div>
            </State>
          </Card>
        )}
        {id && <CardDetail key={id} id={id} />}
      </div>
    </AppShell>
  );
}

function CardDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["dayflow", "card", id], queryFn: () => dayflow.card(id) });
  const [open, setOpen] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const explain = useMutation({ mutationFn: () => dayflow.explain(id, question), onError: (e: Error) => toast.error(e.message) });
  const d = q.data;
  return (
    <State loading={q.isLoading} error={q.error}>
      {d && <div className="space-y-4">
        <Card>
          <CardTitle title={`${d.card.employee.name} · week of ${d.card.period_start}`} hint={`Revision ${d.card.revision} · ${d.card.period_status}`} right={<Money value={d.pay.total} className="font-display text-xl font-semibold" />} />
          <div className="mb-3 flex flex-wrap gap-4 text-sm text-muted-foreground"><span>Worked {mins(d.pay.work_minutes)}</span><span>Overtime {mins(d.pay.overtime_minutes)}</span><span>Night {mins(d.pay.night_minutes)}</span><Pill>{d.pay.status}</Pill></div>
          {d.card.note && <p className="mb-3 rounded-lg bg-muted/50 p-3 text-sm"><span className="font-medium">Employee note: for context only, not proof of time worked.</span> “{d.card.note}”</p>}
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Shifts vs schedule</h4>
          <div className="mb-4 grid gap-1 text-xs">
            {d.card.schedules.map((s) => {
              const shift = d.card.shifts.find((x) => x.id === s.id);
              const t = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "missing");
              return <div key={s.id} className="flex flex-wrap gap-3 border-b py-1"><span className="w-48 text-muted-foreground">Scheduled {t(s.start)} – {t(s.end)}</span><span className={cn(!shift?.start || !shift?.end ? "text-destructive" : "")}>Worked {t(shift?.start)} – {t(shift?.end)}</span></div>;
            })}
          </div>
          <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Pay lines</h4>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Line</th><th>Quantity</th><th>Rate</th><th className="text-right">Amount</th><th>Clause</th></tr></thead>
            <tbody>{d.pay.lines.map((l) => (
              <Fragment key={l.id}>
                <tr className="cursor-pointer border-t hover:bg-muted/40" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td className="py-1.5">{l.label}</td><td>{l.quantity} {l.unit}</td><td><Money value={l.rate} /></td><td className="text-right"><Money value={l.amount} /></td>
                  <td><span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{l.clause}</span></td>
                </tr>
                {open === l.id && <tr><td colSpan={5} className="bg-muted/30 p-2 text-xs"><code>{l.formula}</code>{l.sources.length > 0 && <p className="mt-1 text-muted-foreground">Sources: {l.sources.join(", ")}</p>}</td></tr>}
              </Fragment>))}</tbody>
          </table></div>
        </Card>
        <Card>
          <CardTitle icon={Sparkles} title="Ask about this paycheck" />
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); explain.mutate(); }}>
            <Input value={question} placeholder="Why was I paid overtime on Thursday?" onChange={(e) => setQuestion(e.target.value)} />
            <Button disabled={explain.isPending || question.trim().length < 3}>Ask</Button>
          </form>
          {explain.data && <div className="mt-3 space-y-1 text-sm"><Pill>{explain.data.source}</Pill><p className="whitespace-pre-wrap">{explain.data.text}</p>{explain.data.notice && <p className="text-xs text-muted-foreground">{explain.data.notice}</p>}</div>}
        </Card>
      </div>}
    </State>
  );
}
