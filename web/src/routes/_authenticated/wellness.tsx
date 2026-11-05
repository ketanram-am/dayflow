import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Loader2, MapPin } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, Coffee, HeartPulse, Play, ShieldCheck, Timer, TrendingUp } from "lucide-react";
import { wf } from "@/lib/api";
import { AppShell, Card, CardTitle, Empty } from "@/components/AppShell";
import { AIAssistant, AIInsightsCard, KpiTile, ModuleHeading } from "@/components/ModuleUI";
import { Ring } from "@/components/ShiftOverview";
import { Button } from "@/components/ui/button";
import { BreakReminder } from "@/components/PunchPanel";
import { fmtTime, useOfficeSettings, useToday } from "@/lib/attendance";
import { wellnessScore } from "@/lib/wellness";

export const Route = createFileRoute("/_authenticated/wellness")({
  head: () => ({
    meta: [
      { title: "Wellness – Workforce Wellness — Dayflow" },
      { name: "description", content: "Work-rest balance, break tracking and AI wellness insights." },
      { property: "og:title", content: "Wellness – Workforce Wellness — Dayflow" },
      { property: "og:description", content: "Breaks, reminders, wellness score and AI break recommendations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WellnessPage,
});

const STANDARD_DAY_H = 8;

function WellnessPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data } = useToday(user.id);
  const { data: office } = useOfficeSettings();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    // Totals come from saved timestamps on the server; refresh them regularly.
    const r = setInterval(() => qc.invalidateQueries({ queryKey: ["today", user.id] }), 30000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [qc, user.id]);

  const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const { data: week } = useQuery({
    queryKey: ["wellness", "week", user.id],
    queryFn: async () => {
      const [att, brk] = await Promise.all([wf.attendance({ start: since }), wf.breaks(since)]);
      return { att, brk };
    },
  });

  async function brk(start: boolean) {
    setBusy(true);
    try { await (start ? wf.startBreak() : wf.endBreak()); } catch (e) { setBusy(false); return void toast.error((e as Error).message); }
    setBusy(false);
    toast.success(start ? "Break started" : "Welcome back");
    qc.invalidateQueries({ queryKey: ["today", user.id] });
    qc.invalidateQueries({ queryKey: ["wellness", "week", user.id] });
  }

  const mins = (s: string, e: string | null) => ((e ? new Date(e).getTime() : now) - new Date(s).getTime()) / 60000;
  const att = week?.att ?? [];
  const brks = week?.brk ?? [];
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10));
  const chart = days.map((d) => {
    const a = att.find((x) => x.attendance_date === d);
    const breakH = brks.filter((b) => a && b.attendance_id === a.id).reduce((s, b) => s + mins(b.break_start, b.break_end), 0) / 60;
    const total = a ? mins(a.check_in_time, a.check_out_time) / 60 : 0;
    const work = Math.max(0, total - breakH);
    return { day: new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short" }), Work: +Math.min(work, STANDARD_DAY_H).toFixed(2), Break: +breakH.toFixed(2), Overtime: +Math.max(0, work - STANDARD_DAY_H).toFixed(2), worked: !!a };
  });
  const workedDays = chart.filter((c) => c.worked);
  const overtimeH = chart.reduce((s, c) => s + c.Overtime, 0);
  const score = wellnessScore({
    workedDays: workedDays.length,
    daysWithBreak: workedDays.filter((c) => c.Break > 0).length,
    overtimeHours: overtimeH,
    avgBreakMin: workedDays.length ? (workedDays.reduce((s, c) => s + c.Break, 0) * 60) / workedDays.length : 0,
  });

  const today = data?.today;
  const checkedIn = !!today && !today.check_out_time;
  const todayBreaks = data?.breaks ?? brks.filter((b) => today && b.attendance_id === today.id);
  const workedTodayMin = data?.netMinutes ?? 0;
  const active = data?.activeBreak;
  const activeMin = active ? mins(active.break_start, null) : 0;
  const reminder = office?.break_reminder_min ?? 240;
  const sinceBreakMin = checkedIn && !active ? data?.continuousMinutes ?? 0 : 0;
  const state: "none" | "working" | "break" | "done" = !today ? "none" : today.check_out_time ? "done" : active ? "break" : "working";
  const stateMeta = {
    none: { label: "Not checked in", tone: "bg-muted text-muted-foreground", message: "Please check in first on GeoPulse — breaks can only start during an active attendance." },
    working: { label: "Working", tone: "bg-success/15 text-success", message: `Working ${hm(sinceBreakMin)} since your last break.` },
    break: { label: "On Break", tone: "bg-warning/15 text-warning", message: `On break since ${active ? fmtTime(active.break_start) : ""}. Your work timer is paused.` },
    done: { label: "Checked out", tone: "bg-primary/15 text-primary", message: `You checked out at ${today?.check_out_time ? fmtTime(today.check_out_time) : ""}, so breaks are closed for today. They open again after your next check-in.` },
  }[state];
  const clock = (m: number) => { const s = Math.floor(m * 60); return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  function hm(m: number) { return `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`; }

  const clientData = JSON.stringify({ checkedIn, onBreak: !!active, minutesWorkedToday: Math.round(workedTodayMin), minutesSinceLastBreak: Math.round(sinceBreakMin), breakReminderMin: reminder, standardDayHours: STANDARD_DAY_H, wellnessScore: score });

  return (
    <AppShell user={user} title="ZenBreak">
      <ModuleHeading title="Wellness – Workforce Wellness" subtitle="Work-rest balance, break tracking and AI wellness insights" />
      <BreakReminder userId={user.id} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="Total Breaks Today" icon={Coffee} tone="success" value={todayBreaks.length} sub={active ? "On break now" : "Completed"} />
        <KpiTile label="Break Duration" icon={Timer} tone="violet" value={`${Math.round(data?.breakMinutes ?? 0)}m`} sub={todayBreaks.length ? `Avg ${Math.round((data?.breakMinutes ?? 0) / todayBreaks.length)}m` : "Today"} />
        <KpiTile label="Working Hours" icon={Clock} value={hm(Math.max(0, workedTodayMin))} sub={`of ${STANDARD_DAY_H}h`} />
        <KpiTile label="Overtime" icon={TrendingUp} tone="danger" value={hm(overtimeH * 60)} sub="This week" />
        <KpiTile label="Wellness Score" icon={ShieldCheck} tone="success" value={score == null ? "—" : `${score}%`} valueTone={score != null && score >= 70 ? "success" : "default"} sub={score == null ? "Needs a worked day" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "Needs attention"} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 animate-pulse rounded-full bg-gradient-to-br from-primary/25 to-violet/25 blur-3xl" />
          <CardTitle icon={Coffee} title="Break Control" hint={state === "working" || state === "break" ? "Breaks pause your working-hours counter" : undefined} />
          <div className="relative flex flex-wrap items-center gap-6">
            <motion.div key={state} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}>
              <Ring pct={active ? (activeMin / 60) * 100 : ((data?.breakMinutes ?? 0) / 60) * 100} label={active ? "Current break" : "Taken today"} center={active ? clock(activeMin) : `${Math.round(data?.breakMinutes ?? 0)}m`} />
            </motion.div>
            <div className="flex-1 space-y-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${stateMeta.tone}`}>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{stateMeta.label}
              </span>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-muted-foreground">Work today</dt><dd className="font-semibold tabular-nums text-foreground">{clock(Math.max(0, workedTodayMin))}</dd></div>
                <div><dt className="text-muted-foreground">Break now</dt><dd className="font-semibold tabular-nums text-foreground">{active ? clock(activeMin) : "—"}</dd></div>
                <div><dt className="text-muted-foreground">Breaks today</dt><dd className="font-semibold text-foreground">{todayBreaks.length}</dd></div>
                <div><dt className="text-muted-foreground">Next reminder</dt><dd className="font-semibold text-foreground">{state === "working" ? `in ${hm(Math.max(0, reminder - sinceBreakMin))}` : "—"}</dd></div>
              </dl>
              <p className="text-sm text-muted-foreground">{stateMeta.message}</p>
              {state === "none" || state === "done" ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled><Coffee className="mr-1 h-4 w-4" /> Start Break</Button>
                  {state === "none" && <Button asChild variant="outline"><Link to="/attendance"><MapPin className="mr-1 h-4 w-4" /> Check in on GeoPulse</Link></Button>}
                </div>
              ) : (
                <Button variant={active ? "outline" : "default"} className={active ? "border-destructive text-destructive transition-transform hover:scale-[1.03]" : "bg-gradient-to-r from-primary to-violet transition-transform hover:scale-[1.03]"} disabled={busy} onClick={() => brk(!active)}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : active ? <Play className="mr-1 h-4 w-4" /> : <Coffee className="mr-1 h-4 w-4" />}
                  {active ? "End Break" : "Start Break"}
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Reminder every {hm(reminder)} · Since last break: {hm(sinceBreakMin)}</span><span>{Math.min(100, Math.round((sinceBreakMin / reminder) * 100))}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-primary to-violet" style={{ width: `${Math.min(100, (sinceBreakMin / reminder) * 100)}%` }} /></div>
          </div>
        </Card>
        <Card>
          <CardTitle icon={HeartPulse} title="Work-Rest Balance" hint="This week (hours)" />
          {workedDays.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} />
                  <Tooltip />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Work" stackId="a" fill="var(--primary)" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="Break" stackId="a" fill="var(--success)" />
                  <Bar dataKey="Overtime" stackId="a" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No worked days this week yet.</Empty>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AIInsightsCard module="wellness" title="AI Wellness Insights" clientData={clientData} />
        <Card>
          <CardTitle icon={Timer} title="Break History (Today)" />
          {todayBreaks.length ? (
            <ul className="divide-y text-sm">
              {todayBreaks.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2.5">
                  <span className="flex items-center gap-2 text-foreground"><Coffee className="h-4 w-4 text-warning" />{mins(b.break_start, b.break_end) >= 25 ? "Long break" : "Short break"}</span>
                  <span className="text-muted-foreground tabular-nums">{fmtTime(b.break_start)} – {b.break_end ? fmtTime(b.break_end) : "now"}</span>
                  <span className="font-medium tabular-nums">{Math.round(mins(b.break_start, b.break_end))}m</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No breaks recorded today.</Empty>}
        </Card>
      </div>

      <AIAssistant module="wellness" title="AI Wellness Assistant" clientData={clientData}
        suggestions={["How many hours have I worked today?", "When should I take my next break?", "How has my break routine changed this week?", "Am I working more overtime than usual?"]} />
      <p className="text-xs text-muted-foreground">Wellness score = 40% days with a break + 30% average break length (target 30 min) + 30% low overtime (10h+ in a week scores 0). Work-pattern guidance only — not a medical or mental-health assessment.</p>
    </AppShell>
  );
}
