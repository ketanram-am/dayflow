import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import robot from "@/assets/ai-robot.png";
import { AlertTriangle, CheckCircle2, CalendarDays, Layers, Target, ChevronLeft, ChevronRight, Repeat, UserCheck } from "lucide-react";
import { wf } from "@/lib/api";
import { Card, CardTitle, Empty } from "@/components/AppShell";
import { AIInsightsCard, KpiTile } from "@/components/ModuleUI";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function weekStart(offset: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offset * 7);
  return d;
}
export function shiftKind(start: string) {
  const h = Number(start.slice(0, 2));
  return h >= 5 && h < 12 ? "Morning" : h >= 12 && h < 20 ? "Evening" : "Night";
}
const kindCls: Record<string, string> = {
  Morning: "bg-success/15 text-success",
  Evening: "bg-violet/15 text-violet",
  Night: "bg-primary/15 text-primary",
};

export function ShiftOverview({ userId, isAdmin, pendingSwaps, swapsCard, upcomingCard }: { userId: string; isAdmin: boolean; pendingSwaps: number; swapsCard?: ReactNode; upcomingCard?: ReactNode }) {
  const [offset, setOffset] = useState(0);
  const start = weekStart(offset);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000)) as [Date, Date, Date, Date, Date, Date, Date];
  const { data } = useQuery({
    queryKey: ["shifts", "week", iso(start), isAdmin],
    queryFn: () => wf.shifts({ start: iso(days[0]), end: iso(days[6]) }),
  });
  const { data: leaves } = useQuery({
    queryKey: ["leave", "approved", iso(start), isAdmin],
    queryFn: async () => {
      const rows = await wf.calendar(iso(days[0]), iso(days[6]));
      return rows.filter((l) => l.approval_status === "approved" && (isAdmin || l.employee_id === userId));
    },
  });
  const { data: active } = useQuery({
    queryKey: ["employees", "activeCount"],
    enabled: isAdmin,
    queryFn: async () => (await wf.employees()).filter((e) => e.is_active).length,
  });

  const shifts = data ?? [];
  const people = [...new Map(shifts.map((s) => [s.employee_id, s.employee?.full_name || "Employee"])).entries()];
  const cell = new Map(shifts.map((s) => [`${s.employee_id}|${s.assigned_date}`, s]));
  const assigned = people.length;
  const unassigned = isAdmin && active != null ? Math.max(0, active - assigned) : null;
  const counts = { Morning: 0, Evening: 0, Night: 0 } as Record<string, number>;
  shifts.forEach((s) => counts[shiftKind(s.shift_start)] = (counts[shiftKind(s.shift_start)] ?? 0) + 1);
  const weekdays = days.slice(0, 5).filter((d) => shifts.some((s) => s.assigned_date === iso(d))).length;
  const coverage = Math.round((weekdays / 5) * 100);
  const todayIso = iso(new Date());
  const conflicts = shifts.filter((s) => (leaves ?? []).some((l) => l.employee_id === s.employee_id && l.start_date <= s.assigned_date && l.end_date >= s.assigned_date));

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-violet p-6 text-primary-foreground shadow-card md:p-8">
        <div className="relative z-10 max-w-xl">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Smart Shift Management</h2>
          <p className="mt-1 text-sm opacity-90 md:text-base">Plan, assign, swap and optimise workforce shifts with AI insights.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Auto Scheduling", "Conflict Detection", "Staffing Forecast", "AI Recommendations"].map((t) => (
              <span key={t} className="flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-medium backdrop-blur"><CheckCircle2 className="h-3.5 w-3.5" />{t}</span>
            ))}
          </div>
        </div>
        <img src={robot} alt="" className="pointer-events-none absolute -bottom-4 right-4 hidden h-40 md:block" />
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Total Shifts" icon={CalendarDays} value={shifts.length} sub="This week" />
        <KpiTile label="Assigned" icon={UserCheck} tone="success" value={assigned} sub={isAdmin ? "Employees scheduled" : "You"} />
        <KpiTile label="Unassigned" icon={Layers} tone="danger" value={unassigned ?? "—"} sub={isAdmin ? "Active, no shift" : "Admin only"} />
        <KpiTile label="Swap Requests" icon={Repeat} tone="warning" value={pendingSwaps} sub="Pending" />
        <KpiTile label="Conflicts" icon={AlertTriangle} tone="danger" value={conflicts.length} sub={conflicts.length ? "Needs action" : "Shift on approved leave"} />
        <KpiTile label="Coverage" icon={Target} tone="violet" value={`${coverage}%`} sub="Weekdays staffed" />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardTitle title="Weekly Shift Calendar" right={
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              {days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – {days[6].toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Next week" onClick={() => setOffset((o) => o + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          } />
          {people.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th />
                    {days.map((d) => (
                      <th key={iso(d)} className={cn("rounded-lg px-1 py-1 font-medium text-muted-foreground", iso(d) === todayIso && "bg-accent text-foreground")}>
                        {d.toLocaleDateString(undefined, { weekday: "short" })}<br />{d.getUTCDate()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map(([id, name]) => (
                    <tr key={id}>
                      <td className="truncate pr-2 font-medium text-foreground">{name}</td>
                      {days.map((d) => {
                        const s = cell.get(`${id}|${iso(d)}`);
                        const k = s && shiftKind(s.shift_start);
                        return (
                          <td key={iso(d)} className={cn("rounded-md px-1 py-1.5 text-center", s ? kindCls[k!] : "bg-muted/60 text-muted-foreground")}>
                            {s ? <><span className="font-semibold">{k}</span><br />{s.shift_start.slice(0, 5)}–{s.shift_end.slice(0, 5)}</> : "Off"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No shifts scheduled this week.{isAdmin && " Assign shifts below."}</Empty>}
        </Card>
        <div className="space-y-4">
          <AIInsightsCard module="shifts" title="AI Shift Optimizer" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
            <CardTitle title="Shift Analytics" hint="This week" />
            {shifts.length ? (
              <div className="flex items-center gap-4">
                <Ring pct={coverage} label="Coverage" />
                <ul className="flex-1 space-y-1.5 text-xs">
                  {Object.entries(counts).map(([k, n]) => (
                    <li key={k} className="flex justify-between"><span className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", kindCls[k])} />{k}</span><span className="tabular-nums text-muted-foreground">{n} ({Math.round((n / shifts.length) * 100)}%)</span></li>
                  ))}
                </ul>
              </div>
            ) : <Empty>No data yet.</Empty>}
          </Card>
        {swapsCard}
        {upcomingCard}
      </div>
      {conflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-5 py-3 text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <span className="font-semibold text-destructive">Shift Conflict Alert</span>
          <span className="text-foreground">{conflicts.length} shift{conflicts.length > 1 ? "s" : ""} scheduled on approved leave days: {conflicts.slice(0, 3).map((c) => `${c.employee?.full_name ?? "Employee"} (${c.assigned_date})`).join(", ")}</span>
        </div>
      )}
    </>
  );
}

export function Ring({ pct, label, center }: { pct: number; label: string; center?: string }) {
  const c = 2 * Math.PI * 38;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="38" fill="none" className="stroke-muted" strokeWidth="10" />
        <circle cx="50" cy="50" r="38" fill="none" className="stroke-success transition-all" strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct / 100)))} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-base font-semibold tabular-nums">{center ?? `${pct}%`}</span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}
