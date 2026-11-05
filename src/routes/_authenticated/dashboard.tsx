import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  CircleCheck, LogIn, LogOut, Timer, MapPinned, Users, UserCheck, CalendarOff, Percent,
  MapPin, Repeat, HeartPulse, CloudUpload, BrainCircuit, ArrowRight, TrendingUp, TrendingDown,
} from "lucide-react";
import { Area, AreaChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { wf } from "@/lib/api";
import { AppShell, Card, CardTitle, Empty, Stat, StatusPill } from "@/components/AppShell";
import { CountUp } from "@/components/CountUp";
import { BreakReminder } from "@/components/PunchPanel";
import { fmtHours, fmtTime, lastVerify, useMe, useToday } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { WorkspaceModules } from "@/components/WorkspaceModules";
import { WorkforceHeatmap, SmartAlerts } from "@/components/WorkspaceAnalytics";
import campus from "@/assets/dashboard-campus.jpg";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Overview — Dayflow" },
      { name: "description", content: "Your Dayflow attendance overview." },
      { property: "og:title", content: "Overview — Dayflow" },
      { property: "og:description", content: "Today's attendance, shifts and leave at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Fade({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

type OrgKpis = { total_employees: number; present_today: number; present_last_week: number; on_leave: number; on_leave_yesterday: number };
type TrendRow = { day: string; present: number; rate: number };

function Trend({ now, prev, invert = false }: { now: number; prev: number; invert?: boolean }) {
  if (!prev) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (!pct) return null;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-destructive")}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {up ? "+" : ""}{pct}%
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, suffix, trend, spark, color, delay }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number; suffix?: string;
  trend?: ReactNode; spark?: { day: string; v: number }[]; color: string; delay: number;
}) {
  return (
    <Fade delay={delay}>
      <div className="workspace-panel flex h-full items-center gap-3 rounded-xl border bg-card p-3 shadow-card transition-colors hover:border-primary/40">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground"><CountUp value={value} decimals={suffix ? 1 : 0} suffix={suffix} /></p>
            {trend}
          </div>
          <p className="truncate text-[11px] font-medium text-foreground">{label}</p>
        </div>
        {spark && spark.length > 1 && (
          <div className="hidden h-10 w-20 shrink-0 xl:block">
            <ResponsiveContainer>
              <AreaChart data={spark} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.15} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Fade>
  );
}

const MODULES = [
  { to: "/attendance", name: "GeoPulse", desc: "GPS Check-in & Geofence", icon: MapPin, color: "var(--cyan)" },
  { to: "/shifts", name: "RotaFlow", desc: "Shift & Roster Management", icon: Repeat, color: "var(--violet)" },
  { to: "/wellness", name: "ZenBreak", desc: "Work-Rest Balance", icon: HeartPulse, color: "var(--success)" },
  { to: "/sync", name: "SyncShield", desc: "Offline Sync & Recovery", icon: CloudUpload, color: "var(--primary)" },
  { to: "/tasks", name: "TaskForge", desc: "Tasks & Productivity", icon: BrainCircuit, color: "var(--warning)" },
] as const;

const QUICK = [
  { to: "/attendance", label: "Check In", icon: MapPin, color: "var(--success)" },
  { to: "/attendance", label: "Check Out", icon: LogOut, color: "var(--cyan)" },
  { to: "/leave", label: "Apply Leave", icon: CalendarOff, color: "var(--violet)" },
  { to: "/shifts", label: "Swap Shift", icon: Repeat, color: "var(--primary)" },
] as const;

const DEPT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted-foreground)"];

function AdminOverview() {
  const { data: kpis } = useQuery({
    queryKey: ["org-kpis"],
    queryFn: () => wf.kpis() as Promise<OrgKpis>,
  });
  const { data: trend } = useQuery({
    queryKey: ["org-trend"],
    queryFn: () => wf.trend(7) as Promise<TrendRow[]>,
  });
  const { data: depts } = useQuery({
    queryKey: ["org-depts"],
    queryFn: () => wf.departments(),
  });

  const k = kpis ?? { total_employees: 0, present_today: 0, present_last_week: 0, on_leave: 0, on_leave_yesterday: 0 };
  const rate = k.total_employees ? Math.round((k.present_today / k.total_employees) * 1000) / 10 : 0;
  const prevRate = k.total_employees ? Math.round((k.present_last_week / k.total_employees) * 1000) / 10 : 0;
  const spark = (trend ?? []).map((t) => ({ day: t.day, v: t.present }));
  const rateSpark = (trend ?? []).map((t) => ({ day: t.day, v: t.rate }));
  const chart = (trend ?? []).map((t) => ({ day: new Date(t.day + "T00:00").toLocaleDateString(undefined, { weekday: "short" }), rate: t.rate, present: t.present }));
  const totalDept = (depts ?? []).reduce((s, d) => s + d.n, 0);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Total Employees" value={k.total_employees} color="var(--chart-1)" delay={0} />
        <KpiCard icon={UserCheck} label="Present Today" value={k.present_today} color="var(--success)" delay={0.05} trend={<Trend now={k.present_today} prev={k.present_last_week} />} spark={spark} />
        <KpiCard icon={CalendarOff} label="On Leave" value={k.on_leave} color="var(--warning)" delay={0.1} trend={<Trend now={k.on_leave} prev={k.on_leave_yesterday} invert />} />
        <KpiCard icon={Percent} label="Attendance Rate" value={rate} suffix="%" color="var(--violet)" delay={0.15} trend={<Trend now={rate} prev={prevRate} />} spark={rateSpark} />
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.35fr_1.25fr_1fr_0.95fr]">
        <Fade delay={0.2}>
          <Card className="workspace-panel h-full !rounded-xl !p-3">
            <CardTitle icon={TrendingUp} title="Attendance Trend" />
            {chart.length ? (
              <div className="h-32">
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ top: 5, bottom: 0, left: -18, right: 5 }}>
                    <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="rate" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-1)" }} name="Attendance" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty>No attendance recorded this week.</Empty>}
          </Card>
        </Fade>
        <Fade delay={0.22}><WorkforceHeatmap /></Fade>
        <Fade delay={0.25}>
          <Card className="workspace-panel h-full !rounded-xl !p-3">
            <CardTitle title="Department Distribution" />
            {depts?.length ? (
              <div className="flex items-center gap-2">
                <div className="relative h-28 w-28 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={depts} dataKey="n" nameKey="department" innerRadius={33} outerRadius={50} strokeWidth={0}>
                        {depts.map((_, i) => <Cell key={i} fill={DEPT_COLORS[i % DEPT_COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className="font-display text-xl font-semibold text-foreground">{totalDept}</p>
                    <p className="text-[10px] text-muted-foreground">Employees</p>
                  </div>
                </div>
                <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
                  {depts.slice(0, 6).map((d, i) => (
                    <li key={d.department} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                        <span className="truncate text-muted-foreground">{d.department}</span>
                      </span>
                      <span className="tabular-nums text-foreground">{totalDept ? Math.round((d.n / totalDept) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <Empty>No departments set yet. Add departments in employee profiles.</Empty>}
          </Card>
        </Fade>
        <Fade delay={0.28}><SmartAlerts /></Fade>
      </section>
    </>
  );
}

function EmployeeOverview({ userId }: { userId: string }) {
  const { data } = useToday(userId);
  const [now, setNow] = useState(new Date());
  const [verify, setVerify] = useState<ReturnType<typeof lastVerify>>(null);
  useEffect(() => {
    setVerify(lastVerify());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const since = new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10);
  const { data: rows } = useQuery({
    queryKey: ["attendance", "trend", userId],
    queryFn: async () => (await wf.week()).filter((r) => r.attendance_date >= since),
  });

  const t = data?.today;
  const liveHours = t && !t.check_out_time ? Math.max(0, (now.getTime() - new Date(t.check_in_time).getTime()) / 3600000 - (data?.breakMinutes ?? 0) / 60) : null;
  const chart = (rows ?? []).map((r) => ({ day: new Date(r.attendance_date + "T00:00").toLocaleDateString(undefined, { weekday: "short" }), hours: Number(r.total_working_hours ?? 0) }));

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Today's status" icon={CircleCheck} tone={t ? "success" : "default"} value={!t ? "Not checked in" : t.check_out_time ? "Completed" : data?.activeBreak ? "On break" : "Present"} />
        <Stat label="Check-in" icon={LogIn} value={fmtTime(t?.check_in_time)} sub={t?.synced_offline ? "Synced from offline" : undefined} />
        <Stat label="Check-out" icon={LogOut} value={fmtTime(t?.check_out_time)} />
        <Stat label="Working hours" icon={Timer} value={fmtHours(t?.check_out_time ? Number(t.total_working_hours) : liveHours)} sub={liveHours != null ? "Running, excludes breaks" : undefined} />
        <Stat
          label="GPS verification"
          icon={MapPinned}
          tone={verify?.result.status === "inside" ? "success" : verify ? "warning" : "default"}
          value={verify ? <StatusPill status={verify.result.status} /> : "Not verified"}
          sub={verify ? `± ${Math.round(verify.fix.accuracy)} m · ${new Date(verify.fix.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : <Link to="/location" className="text-primary hover:underline">Verify location</Link>}
        />
      </section>
      <Fade delay={0.1}>
        <Card>
          <CardTitle title="Your hours" hint="Working hours per day, last 14 days" />
          {chart.length ? (
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={chart} margin={{ top: 5, bottom: 0, left: -18, right: 5 }}>
                  <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="hours" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-2)" }} name="Hours" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty>No attendance recorded in the last 14 days.</Empty>}
        </Card>
      </Fade>
    </>
  );
}

function Dashboard() {
  const { user } = Route.useRouteContext();
  const { data: me } = useMe(user.id);
  const firstName = (me?.employee?.full_name || user.email?.split("@")[0] || "").split(" ")[0];
  const h = new Date().getHours();

  return (
    <AppShell user={user} title="Horizon">
      <Fade>
        <div className="relative flex min-h-20 flex-col justify-center overflow-hidden gap-2 sm:flex-row sm:items-center sm:justify-between">
          <img src={campus} width={1536} height={512} alt="" className="workspace-illustration absolute right-0 bottom-0 hidden h-24 w-[45%] object-cover object-center opacity-75 lg:block" />
          <div className="relative">
            <h2 className="font-display text-2xl font-semibold text-foreground">
              {h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening"}, <span className="text-primary">{firstName}</span> 👋
            </h2>
            <p className="text-xs text-muted-foreground">Here’s your workforce intelligence for today</p>
          </div>
          {!me?.employee?.employee_id && me && (
            <Link to="/profile" className="relative self-start rounded-lg bg-card/95 px-2 py-1 text-xs text-warning hover:underline sm:self-center">Add your employee ID in Profile →</Link>
          )}
        </div>
      </Fade>

      <BreakReminder userId={user.id} />

      {me?.isAdmin ? <AdminOverview /> : <EmployeeOverview userId={user.id} />}

      <Fade delay={0.3}><WorkspaceModules userId={user.id} /></Fade>
    </AppShell>
  );
}
