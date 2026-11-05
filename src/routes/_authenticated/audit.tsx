import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { dayflow } from "@/lib/dayflow";
import { AppShell, Card } from "@/components/AppShell";
import { AdminOnly, humanise } from "@/components/dayflow/AdminOnly";
import { head, JsonView, State, when } from "@/components/EngineUI";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/attendance";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/audit")({
  head: head("Audit Ledger", "Tamper-evident, hash-chained log of every action in Dayflow."),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  const me = useMe(user.id);
  const q = useQuery({ queryKey: ["dayflow", "audit"], queryFn: dayflow.audit, enabled: !!me.data?.isAdmin });
  const [action, setAction] = useState<string | null>(null);
  const [text, setText] = useState("");
  const events = q.data?.events ?? [];
  const actions = [...new Set(events.map((e) => e.action))].sort();
  const shown = events.filter((e) => (!action || e.action === action) && (!text || JSON.stringify(e).toLowerCase().includes(text.toLowerCase())));
  return (
    <AppShell user={user} title="Audit Ledger">
      <AdminOnly userId={user.id}>
        <State loading={q.isLoading} error={q.error}>
          {q.data && <div className="space-y-4">
            <div className={cn("flex items-center gap-3 rounded-2xl border p-4", q.data.integrity ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}>
              {q.data.integrity ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              <div><p className="font-semibold">{q.data.integrity ? "The chain is intact" : "Chain broken"}</p>
                <p className="text-xs opacity-80">{events.length} events · {q.data.unverified_commits} unverified commits</p></div>
            </div>
            <Card>
              <div className="mb-4 flex flex-wrap gap-2">
                <Input className="h-8 w-56" placeholder="Search events…" value={text} onChange={(e) => setText(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => setAction(null)} aria-pressed={!action}>All</Button>
                {actions.map((a) => <Button variant="outline" size="sm" key={a} onClick={() => setAction(a === action ? null : a)} aria-pressed={action === a}>{humanise(a)}</Button>)}
              </div>
              <ol className="space-y-3 border-l pl-5">
                {shown.slice(0, 300).map((e) => (
                  <li key={e.sequence} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="font-medium">{humanise(e.action)}</span><span className="text-xs text-muted-foreground">by {e.actor} · {e.entity} · {when(e.at)}</span></div>
                    <p className="font-mono text-[10px] text-muted-foreground">#{e.sequence} · {e.event_hash.slice(0, 12)}…</p>
                    {Object.keys(e.details ?? {}).length > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Details</summary><div className="mt-1"><JsonView value={e.details} /></div></details>}
                  </li>
                ))}
              </ol>
              {!shown.length && <p className="py-4 text-sm text-muted-foreground">No audit events match your filters.</p>}
            </Card>
          </div>}
        </State>
      </AdminOnly>
    </AppShell>
  );
}
