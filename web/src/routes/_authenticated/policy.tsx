import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FlaskConical, ScrollText } from "lucide-react";
import { dayflow, type PolicyVersion } from "@/lib/dayflow";
import { AppShell, Card, CardTitle } from "@/components/AppShell";
import { AdminOnly, humanise } from "@/components/dayflow/AdminOnly";
import { Money } from "@/components/dayflow/Money";
import { head, JsonView, Pill, State, when } from "@/components/EngineUI";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/policy")({
  head: head("Policy Studio", "Signed pay rules, their source sentences, and what-if replays."),
  component: Page,
});

const SUGGESTIONS = ["What if overtime started after 7 hours?", "What if the meal break was 45 minutes?", "What if the night differential was $3?"];

function Page() {
  const { user } = Route.useRouteContext();
  return (
    <AppShell user={user} title="Policy Studio">
      <AdminOnly userId={user.id}>
        <Policies />
      </AdminOnly>
    </AppShell>
  );
}

function Policies() {
  const q = useQuery({ queryKey: ["dayflow", "policies"], queryFn: dayflow.policies });
  return <div className="space-y-4">
          <State loading={q.isLoading} error={q.error} empty={q.data && !q.data.versions.length && "No policy versions."}>
            {q.data?.versions.map((v) => <Version key={v.id} v={v} active={v.id === q.data?.active_id} />)}
          </State>
          <WhatIf />
        </div>
  ;
}

function Version({ v, active }: { v: PolicyVersion; active: boolean }) {
  const qc = useQueryClient();
  const [reviewed, setReviewed] = useState(false);
  const sign = useMutation({
    mutationFn: () => dayflow.signPolicy(v.id, v.content_hash),
    onSuccess: () => { toast.success("Signed and activated"); qc.invalidateQueries({ queryKey: ["dayflow"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card>
      <CardTitle icon={ScrollText} title={`Ruleset ${v.version}`} hint={v.content_hash.slice(0, 16) + "…"}
        right={active ? <Pill tone="good">Active · signed by {v.signer} {when(v.signed_at)}</Pill> : v.signer ? <Pill>Signed</Pill> : <Pill tone="warn">Unsigned</Pill>} />
      <Accordion type="multiple">
        {Object.entries(v.document.clauses).map(([id, text]) => {
          const maps = v.mappings.filter((m) => m.clause === id);
          return (
            <AccordionItem key={id} value={id}>
              <AccordionTrigger className="text-sm"><span><span className="mr-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{id}</span>{text.slice(0, 90)}{text.length > 90 ? "…" : ""}</span></AccordionTrigger>
              <AccordionContent className="space-y-2 text-sm">
                <p>{text}</p>
                {maps.map((m) => <div key={m.field} className="rounded-lg border p-2 text-xs"><b>{humanise(m.field)} = {m.value}</b><p className="text-muted-foreground">“{m.source}”</p></div>)}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      {!v.signer && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={reviewed} onCheckedChange={(c) => setReviewed(c === true)} />I reviewed every source sentence and its mapped rule</label>
          <Button disabled={!reviewed || sign.isPending} onClick={() => sign.mutate()}>Sign and activate</Button>
        </div>
      )}
    </Card>
  );
}

function WhatIf() {
  const [question, setQuestion] = useState("");
  const run = useMutation({ mutationFn: (qs: string) => dayflow.whatIf({ question: qs }), onError: (e: Error) => toast.error(e.message) });
  const r = run.data;
  const result = r?.status === "ok" ? r : null;
  const rows = result?.replay.rows ?? [];
  return (
    <Card>
      <CardTitle icon={FlaskConical} title="What if we changed a rule?" hint="Replays the period under the change. Nothing is saved." />
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(question); }}>
        <Input value={question} placeholder="What if overtime started after 7 hours?" onChange={(e) => setQuestion(e.target.value)} />
        <Button disabled={run.isPending || question.trim().length < 3}>Replay</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <Button key={s} type="button" variant="outline" size="sm" disabled={run.isPending} onClick={() => { setQuestion(s); run.mutate(s); }}>{s}</Button>)}</div>
      {run.isPending && <State loading />}
      {r && <div className="mt-4 space-y-3 text-sm">
        <div className="flex flex-wrap gap-2"><Pill>{r.status}</Pill>{r.source && <Pill tone="good">{r.source}</Pill>}
          {result && <span>Understood: <b>{result.change.label}</b> {result.change.old} → <b>{result.change.new}</b> {result.change.unit}</span>}
          {result && <span>Total change: <Money value={result.replay.total_delta} /></span>}</div>
        {result && <p className="text-xs text-muted-foreground">Period {result.replay.period_start} · {result.replay.changed} changed · {result.replay.incomplete} incomplete</p>}
        {r.message && <p className="text-muted-foreground">{r.message}</p>}
        {rows.length > 0 ? (
          <table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th className="py-1">Employee</th><th className="text-right">Before</th><th className="text-right">After</th><th className="text-right">Change</th></tr></thead>
            <tbody>{rows.map((x) => <tr key={x.card_id} className="border-t"><td className="py-1">{x.employee}</td><td className="text-right"><Money value={x.before} /></td><td className="text-right"><Money value={x.after} /></td><td className="text-right"><Money value={x.delta} /></td></tr>)}</tbody></table>
        ) : <details><summary className="cursor-pointer text-xs text-muted-foreground">Full result</summary><JsonView value={r} /></details>}
      </div>}
    </Card>
  );
}
