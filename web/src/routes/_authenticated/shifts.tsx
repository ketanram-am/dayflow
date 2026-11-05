import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Repeat, Plus, Trash2, Check, X } from "lucide-react";
import { wf, ApiError } from "@/lib/api";
import { AppShell, Card, CardTitle, Empty, StatusPill } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { todayUTC, useMe } from "@/lib/attendance";
import { ShiftOverview } from "@/components/ShiftOverview";

export const Route = createFileRoute("/_authenticated/shifts")({
  head: () => ({
    meta: [
      { title: "RotaFlow – Shift Management — Dayflow" },
      { name: "description", content: "RotaFlow schedule and swap requests." },
      { property: "og:title", content: "RotaFlow – Shift Management — Dayflow" },
      { property: "og:description", content: "View your shifts and request swaps." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ShiftsPage,
});

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");
const day = (d: string) => new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function ShiftsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: me } = useMe(user.id);
  const isAdmin = !!me?.isAdmin;

  const { data: shifts } = useQuery({
    queryKey: ["shifts", "mine", user.id],
    queryFn: () => wf.shifts({ start: todayUTC(), mine: true }),
  });
  const { data: colleagues } = useQuery({ queryKey: ["colleagues"], queryFn: () => wf.colleagues() });
  const { data: swaps } = useQuery({
    queryKey: ["swaps", isAdmin],
    queryFn: () => wf.swaps(),
    enabled: !!me,
  });
  const names = new Map((colleagues ?? []).map((c) => [c.id, c.full_name]));
  const refresh = () => qc.invalidateQueries({ queryKey: ["swaps"] });

  const [picks, setPicks] = useState<Record<string, string>>({});

  async function review(id: string, status: "approved" | "rejected", swap: { target_employee_id: string | null }) {
    try {
      // "Anyone available" requests need a person chosen by the manager before approval.
      if (status === "approved" && !swap.target_employee_id) {
        const pick = picks[id];
        if (!pick) return void toast.error("Choose a colleague for this swap before approving");
        await wf.setSwapTarget(id, pick);
      }
      await wf.decideSwap(id, status);
    } catch (e) { return void toast.error(msg(e)); }
    toast.success(`Swap ${status}`);
    refresh();
    qc.invalidateQueries({ queryKey: ["shifts"] });
  }

  return (
    <AppShell user={user} title="RotaFlow">
      <ShiftOverview userId={user.id} isAdmin={isAdmin} pendingSwaps={(swaps ?? []).filter((x) => x.status === "pending").length}
        swapsCard={<Card>
          <CardTitle icon={Repeat} title={`Swap Requests (${(swaps ?? []).length})`} />
          {swaps?.length ? (
            <ul className="divide-y">
              {swaps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{s.shift ? `${day(s.shift.assigned_date)} · ${s.shift.shift_start.slice(0, 5)}–${s.shift.shift_end.slice(0, 5)}` : "Shift"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {isAdmin && `${s.requester?.full_name ?? "Employee"} → `}{s.target_employee_id ? names.get(s.target_employee_id) ?? "Colleague" : "Anyone"}{s.reason && ` · ${s.reason}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={s.status} />
                    {isAdmin && s.status === "pending" && (
                      <>
                        {!s.target_employee_id && (
                          <Select value={picks[s.id] ?? ""} onValueChange={(v) => setPicks((p) => ({ ...p, [s.id]: v }))}>
                            <SelectTrigger className="h-8 w-40 text-xs" aria-label="Choose colleague"><SelectValue placeholder="Choose colleague" /></SelectTrigger>
                            <SelectContent>{(colleagues ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                        <Button size="icon" variant="ghost" aria-label="Approve" onClick={() => review(s.id, "approved", s)}><Check className="h-4 w-4 text-success" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Reject" onClick={() => review(s.id, "rejected", s)}><X className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                    {!isAdmin && s.status === "pending" && (
                      <Button size="icon" variant="ghost" aria-label="Cancel" onClick={async () => { try { await wf.cancelSwap(s.id); } catch (e) { toast.error(msg(e)); } refresh(); }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty>No swap requests.</Empty>}
        </Card>}
        upcomingCard={<Card>
          <CardTitle icon={CalendarDays} title="Upcoming Shifts" hint="Assigned to you" />
          {shifts?.length ? (
            <ul className="divide-y">
              {shifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{day(s.assigned_date)}</p>
                    <p className="tabular-nums text-muted-foreground">{s.shift_start.slice(0, 5)} – {s.shift_end.slice(0, 5)}</p>
                  </div>
                  <SwapDialog shiftId={s.id} colleagues={colleagues ?? []} onDone={refresh} />
                </li>
              ))}
            </ul>
          ) : <Empty>No upcoming shifts.</Empty>}
        </Card>} />
      {isAdmin && <AssignShifts />}
    </AppShell>
  );
}

function SwapDialog({ shiftId, colleagues, onDone }: { shiftId: string; colleagues: { id: string; full_name: string }[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string>("any");
  const [reason, setReason] = useState("");
  async function submit() {
    try { await wf.requestSwap({ shift_id: shiftId, target_employee_id: target === "any" ? null : target, reason: reason.trim() }); }
    catch (e) { return void toast.error(msg(e)); }
    toast.success("Swap request sent");
    setOpen(false);
    onDone();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary"><Repeat className="mr-1 h-3.5 w-3.5" /> Swap</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Request a shift swap</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Swap with</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anyone available</SelectItem>
                {colleagues.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Reason</Label><Textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <Button className="w-full" onClick={submit}>Send request</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignShifts() {
  const qc = useQueryClient();
  const { data: emps } = useQuery({ queryKey: ["employees", "all"], queryFn: async () => (await wf.employees()).filter((e) => e.is_active) });
  const { data: all } = useQuery({
    queryKey: ["shifts", "all"],
    queryFn: async () => (await wf.shifts({ start: todayUTC() })).slice(0, 100),
  });
  const [f, setF] = useState({ employee: "", date: todayUTC(), start: "09:00", end: "17:00" });
  async function add() {
    if (!f.employee) return void toast.error("Choose an employee");
    if (f.end <= f.start) return void toast.error("End time must be after start time");
    try { await wf.saveShift({ employee_id: f.employee, date: f.date, start: f.start, end: f.end }); }
    catch (e) { return void toast.error(msg(e)); }
    toast.success("Shift saved");
    qc.invalidateQueries({ queryKey: ["shifts"] });
  }
  return (
    <Card>
      <CardTitle icon={Plus} title="Assign shifts" hint="Administrator" />
      <div className="grid gap-3 md:grid-cols-5">
        <Select value={f.employee} onValueChange={(v) => setF({ ...f, employee: v })}>
          <SelectTrigger className="md:col-span-2"><SelectValue placeholder="Employee" /></SelectTrigger>
          <SelectContent>{emps?.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}{e.employee_id ? ` (${e.employee_id})` : ""}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <div className="flex gap-2"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <Button onClick={add}>Save shift</Button>
      </div>
      <ul className="mt-5 divide-y text-sm">
        {all?.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-2.5">
            <span className="text-foreground">{s.employee?.full_name} · {day(s.assigned_date)}</span>
            <span className="flex items-center gap-2 tabular-nums text-muted-foreground">{s.shift_start.slice(0, 5)}–{s.shift_end.slice(0, 5)}
              <Button size="icon" variant="ghost" aria-label="Delete shift" onClick={async () => { try { await wf.deleteShift(s.id); } catch (e) { toast.error(msg(e)); } qc.invalidateQueries({ queryKey: ["shifts"] }); }}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
