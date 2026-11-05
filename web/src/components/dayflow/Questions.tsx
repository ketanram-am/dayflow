import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, MessageCircleQuestion } from "lucide-react";
import { dayflow } from "@/lib/dayflow";
import { Card, CardTitle } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { State } from "@/components/EngineUI";
import { myQuestions } from "@/lib/dayflow-questions";

/** Open questions the agent is waiting on this employee to answer. */
export function useMyQuestions(employeeId: string | null | undefined) {
  return useQuery({
    queryKey: ["dayflow", "resolutions"], queryFn: dayflow.resolutions,
    enabled: !!employeeId,
    select: (d) => myQuestions(d.items, employeeId),
  });
}

export function QuestionsCard({ employeeId, showEmpty }: { employeeId: string | null | undefined; showEmpty?: boolean }) {
  const qc = useQueryClient();
  const q = useMyQuestions(employeeId);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [thanked, setThanked] = useState<string[]>([]);
  const answer = useMutation({
    mutationFn: (a: { id: string; reply: "yes" | "no" | "correct" }) => dayflow.answer(a.id, a.reply, a.reply === "correct" ? times[a.id] : undefined),
    onSuccess: (_r, a) => { setThanked((t) => [...t, a.id]); qc.invalidateQueries({ queryKey: ["dayflow"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const items = q.data ?? [];
  if (!showEmpty && !items.length && !thanked.length && !q.isLoading && !q.error) return null;
  return (
    <Card>
      <CardTitle icon={MessageCircleQuestion} title="Questions for you" hint="A quick answer helps your manager fix your timecard." />
      <State loading={!!employeeId && q.isLoading} error={q.error} paused={q.fetchStatus === "paused"}>
      {!items.length && !thanked.length && <p className="text-sm text-muted-foreground">{employeeId ? "No questions for you right now." : "Employee confirmations are available only to the employee on the timecard."}</p>}
      {thanked.length > 0 && <p className="mb-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />Thanks! Your manager will approve it next.</p>}
      <div className="space-y-3">
        {items.map((i) => {
          const first = i.items.find((x) => x.question);
          const quote = i.items.find((x) => x.quote)?.quote;
          return (
            <div key={i.id} className="rounded-xl border p-4">
              <p className="text-sm font-medium">{first?.question ?? i.headline}</p>
              {quote && <blockquote className="mt-2 border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">You wrote: “{quote}”</blockquote>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={answer.isPending} onClick={() => answer.mutate({ id: i.id, reply: "yes" })}>Yes, that's right</Button>
                <Button size="sm" variant="outline" disabled={answer.isPending} onClick={() => answer.mutate({ id: i.id, reply: "no" })}>No</Button>
                <Input type="time" aria-label="Correct time" className="h-8 w-32" value={times[i.id] ?? ""} onChange={(e) => setTimes({ ...times, [i.id]: e.target.value })} />
                <Button size="sm" variant="secondary" disabled={!times[i.id] || answer.isPending} onClick={() => answer.mutate({ id: i.id, reply: "correct" })}>Use this time</Button>
              </div>
            </div>
          );
        })}
      </div>
      </State>
    </Card>
  );
}
