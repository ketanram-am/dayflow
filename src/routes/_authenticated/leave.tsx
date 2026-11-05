import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, CalendarCheck, Hourglass, CheckCircle2, XCircle, Users, Gift, Send, ChevronLeft, ChevronRight, ShieldCheck, Trash2, Download, Settings2, BarChart3 } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { wf, ApiError } from "@/lib/api";
import type { Balances, LeaveRequest, LeaveType } from "@/lib/types";
import { AppShell, Card, CardTitle, Empty, StatusPill } from "@/components/AppShell";
import { AIAssistant, KpiTile } from "@/components/ModuleUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { todayUTC, useMe } from "@/lib/attendance";
import { requestDays, workingDays } from "@/lib/leave";
import { cn } from "@/lib/utils";
import robot from "@/assets/ai-robot.png";

export const Route = createFileRoute("/_authenticated/leave")({
  head: () => ({
    meta: [
      { title: "LeaveSync – Leave Management — Dayflow" },
      { name: "description", content: "Request leave, track balances, approvals and team availability." },
      { property: "og:title", content: "LeaveSync – Leave Management — Dayflow" },
      { property: "og:description", content: "Leave balances, calendar, approval center and AI leave assistant." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeavePage,
});

const TYPES = [
  { key: "annual", label: "Annual", color: "var(--primary)", alloc: "annual_days" },
  { key: "personal", label: "Casual", color: "var(--success)", alloc: "casual_days" },
  { key: "sick", label: "Sick", color: "var(--violet)", alloc: "sick_days" },
  { key: "unpaid", label: "Unpaid", color: "var(--warning)", alloc: "unpaid_days" },
] as const;
type TypeKey = (typeof TYPES)[number]["key"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");

function Ring({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total ? Math.min(1, used / total) : 0;
  const r = 30, c = 2 * Math.PI * r;
  return <svg viewBox="0 0 72 72" className="h-20 w-20"><circle cx="36" cy="36" r={r} fill="none" stroke="var(--muted)" strokeWidth="7" /><circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 36 36)" /><text x="36" y="40" textAnchor="middle" className="fill-foreground text-[12px] font-semibold">{used}/{total}</text></svg>;
}

function LeavePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: me } = useMe(user.id);
  const isAdmin = !!me?.isAdmin;
  const today = todayUTC();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); });
  const [picked, setPicked] = useState<string>(today);
  const monthStart = iso(month);
  const monthEnd = iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)));

  const { data } = useQuery({
    queryKey: ["leave", "page", isAdmin, monthStart],
    enabled: !!me,
    queryFn: async () => {
      const [rows, policy, holidays, team, colleagues, balances] = await Promise.all([
        wf.leave(), wf.policy(), wf.holidays(), wf.calendar(monthStart, monthEnd), wf.colleagues(), wf.balances(),
      ]);
      // colleagues lists active people other than the viewer
      return { rows, policy, holidays, team, staff: colleagues.length + 1, balances };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["leave"] });
  const rows = data?.rows ?? [];
  const holidays = data?.holidays ?? [];
  const holDates = holidays.map((h) => h.holiday_date);
  const policy = data?.policy;
  const mine = rows.filter((r) => r.employee_id === user.id);
  const year = today.slice(0, 4);
  const balance = TYPES.map((t) => {
    const b = data?.balances?.[t.key as keyof Balances];
    return { ...t, used: b?.used ?? 0, total: b?.allowance ?? 0, left: Math.max(0, b?.remaining ?? 0) };
  });

  const thisMonth = rows.filter((r) => r.created_at.slice(0, 7) === today.slice(0, 7));
  const onLeaveToday = (data?.team ?? []).filter((t) => t.approval_status === "approved" && t.start_date <= today && t.end_date >= today);
  const upcomingHol = holidays.filter((h) => h.holiday_date >= today);

  return (
    <AppShell user={user} title="LeaveSync">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary to-violet p-6 text-primary-foreground shadow-card md:p-8">
        <div className="relative z-10 max-w-xl">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Smart Leave Management</h2>
          <p className="mt-1 text-sm opacity-90 md:text-base">Request, approve and track leave with AI-powered insights.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["Leave Balance", "Approval Workflow", "Team Availability", "Policy Management"].map((t) => <span key={t} className="flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-medium backdrop-blur"><CheckCircle2 className="h-3.5 w-3.5" />{t}</span>)}
          </div>
        </div>
        <img src={robot} alt="" className="pointer-events-none absolute -bottom-4 right-4 hidden h-40 md:block" />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Leave Requests" icon={CalendarDays} value={thisMonth.length} sub="This month" />
        <KpiTile label="Pending Approvals" icon={Hourglass} tone="warning" value={rows.filter((r) => r.approval_status === "pending").length} />
        <KpiTile label="Approved" icon={CheckCircle2} tone="success" value={rows.filter((r) => r.approval_status === "approved").length} />
        <KpiTile label="Rejected" icon={XCircle} tone="danger" value={rows.filter((r) => r.approval_status === "rejected").length} />
        <KpiTile label="On Leave Today" icon={Users} tone="primary" value={onLeaveToday.length} />
        <KpiTile label="Upcoming Holidays" icon={Gift} tone="violet" value={upcomingHol.length} sub={upcomingHol.slice(0, 2).map((h) => new Date(h.holiday_date + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })).join(", ") || "None set"} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
        <RequestForm balance={balance} holDates={holDates} mine={mine} onDone={refresh} />
        <LeaveCalendar month={month} setMonth={setMonth} team={data?.team ?? []} holidays={holidays} mine={mine} picked={picked} setPicked={setPicked} staff={data?.staff ?? 0} today={today} />
        <Card>
          <CardTitle icon={CalendarCheck} title="My Leave Balance" hint={`${year} · approved leave`} />
          <div className="grid grid-cols-2 gap-3">
            {balance.map((b) => <div key={b.key} className="flex flex-col items-center rounded-xl border bg-secondary/30 p-2 text-center"><Ring used={b.used} total={b.total} color={b.color} /><p className="text-sm font-semibold">{b.label} Leave</p><p className="text-[11px] text-muted-foreground">Remaining: {b.left} days</p></div>)}
          </div>
          <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-primary">View history ({mine.length})</summary>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">{mine.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span className="capitalize">{r.leave_type} · {r.start_date}{r.end_date !== r.start_date && ` → ${r.end_date}`}</span><StatusPill status={r.approval_status} /></li>)}</ul>
          </details>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <ApprovalCenter rows={rows} isAdmin={isAdmin} userId={user.id} holDates={holDates} onDone={refresh} />
        <TeamAvailability team={data?.team ?? []} staff={data?.staff ?? 0} today={today} minPct={policy?.min_staff_pct ?? 70} />
        <AIAssistant module="leave" title="AI Leave Assistant" suggestions={["How many leave days do I have left?", "Best dates for leave this month?", "Any overlapping leave requests?"]}
          clientData={JSON.stringify({ my_balances: balance.map(({ label, used, total, left }) => ({ type: label, used, total, left })), holidays: holidays.map((h) => [h.holiday_date, h.name]), team_leave_this_month: (data?.team ?? []).map((t) => [t.full_name, t.start_date, t.end_date, t.approval_status]), active_staff: data?.staff, min_staff_pct: policy?.min_staff_pct })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle icon={BarChart3} title="Leave Analytics" hint="Approved days by type, this year" />
          {rows.some((r) => r.approval_status === "approved") ? <div className="h-52"><ResponsiveContainer><BarChart data={TYPES.map((t) => ({ name: t.label, days: rows.filter((r) => r.leave_type === t.key && r.approval_status === "approved" && r.start_date.startsWith(year)).reduce((s, r) => s + requestDays(r, holDates), 0), color: t.color }))}><XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" /><YAxis allowDecimals={false} width={28} fontSize={12} tickLine={false} axisLine={false} stroke="var(--muted-foreground)" /><Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} /><Bar dataKey="days" radius={[6, 6, 0, 0]}>{TYPES.map((t) => <Cell key={t.key} fill={t.color} />)}</Bar></BarChart></ResponsiveContainer></div> : <Empty>No approved leave yet.</Empty>}
        </Card>
        {isAdmin && <PolicyAdmin policy={policy} holidays={holidays} onDone={refresh} />}
      </div>
    </AppShell>
  );
}

type Bal = { key: TypeKey; label: string; left: number }[];
function RequestForm({ balance, holDates, mine, onDone }: { balance: Bal; holDates: string[]; mine: { start_date: string; end_date: string; approval_status: string }[]; onDone: () => void }) {
  const [f, setF] = useState({ type: "annual" as TypeKey, duration: "full", start: todayUTC(), end: todayUTC(), hours: "2", reason: "", emergency: false });
  const days = requestDays({ start_date: f.start, end_date: f.duration === "full" ? f.end : f.start, duration: f.duration, hours: Number(f.hours) }, holDates);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const end = f.duration === "full" ? f.end : f.start;
    if (end < f.start) return void toast.error("End date must be on or after start date");
    if (!days) return void toast.error("The selected dates have no working days");
    if (f.reason.trim().length < 3) return void toast.error("Please add a short reason");
    const left = balance.find((b) => b.key === f.type)?.left ?? 0;
    if (days > left) return void toast.error(`Only ${left} ${f.type} days remaining`);
    if (mine.some((r) => r.approval_status !== "rejected" && r.start_date <= end && r.end_date >= f.start)) return void toast.error("This overlaps another of your requests");
    try {
      await wf.requestLeave({ leave_type: f.type as LeaveType, start_date: f.start, end_date: end, reason: f.reason.trim(), duration: f.duration as "full" | "half" | "hourly", ...(f.duration === "hourly" ? { hours: Number(f.hours) } : {}), emergency: f.emergency });
    } catch (e) { return void toast.error(msg(e)); }
    toast.success("Leave request submitted");
    setF({ ...f, reason: "", emergency: false });
    onDone();
  }
  return (
    <Card>
      <CardTitle icon={Send} title="New Leave Request" />
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5"><Label>Leave type</Label><Select value={f.type} onValueChange={(v) => setF({ ...f, type: v as TypeKey })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label} Leave</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label>Leave duration</Label><div className="grid grid-cols-3 rounded-lg border bg-secondary/40 p-0.5">{([["full", "Full Day"], ["half", "Half Day"], ["hourly", "Hourly"]] as const).map(([k, l]) => <Button key={k} type="button" size="sm" variant={f.duration === k ? "default" : "ghost"} onClick={() => setF({ ...f, duration: k })}>{l}</Button>)}</div></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{f.duration === "full" ? "From" : "Date"}</Label><Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          {f.duration === "full" ? <div className="space-y-1.5"><Label>To</Label><Input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
            : f.duration === "hourly" ? <div className="space-y-1.5"><Label>Hours</Label><Input type="number" min={1} max={8} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></div> : null}
        </div>
        <p className="flex w-fit items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"><CalendarDays className="h-4 w-4" /> {days} working day{days === 1 ? "" : "s"}</p>
        <div className="space-y-1.5"><Label>Reason</Label><Textarea rows={2} maxLength={1000} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.emergency} onCheckedChange={(v) => setF({ ...f, emergency: !!v })} /> Emergency leave</label>
        <Button type="submit" className="w-full"><Send className="h-4 w-4" /> Submit Request</Button>
      </form>
    </Card>
  );
}

type TeamRow = { employee_id: string; full_name: string; start_date: string; end_date: string; approval_status: string; leave_type: string };
function LeaveCalendar({ month, setMonth, team, holidays, mine, picked, setPicked, staff, today }: { month: Date; setMonth: (d: Date) => void; team: TeamRow[]; holidays: { holiday_date: string; name: string }[]; mine: { start_date: string; end_date: string; approval_status: string }[]; picked: string; setPicked: (s: string) => void; staff: number; today: string }) {
  const cells = useMemo(() => {
    const first = month.getUTCDay();
    const n = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1))))];
  }, [month]);
  const on = (d: string, s: string) => team.filter((t) => t.approval_status === s && t.start_date <= d && t.end_date >= d);
  const mineOn = (d: string) => mine.find((r) => r.start_date <= d && r.end_date >= d);
  const shift = (k: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + k, 1)));
  const pickedOff = on(picked, "approved");
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold"><CalendarDays className="h-5 w-5 text-primary" /> Leave Calendar</h3>
        <div className="flex items-center gap-1"><Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></Button><span className="w-32 text-center text-sm font-medium">{month.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</span><Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></Button></div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const hol = holidays.find((h) => h.holiday_date === d);
          const m = mineOn(d);
          const ap = on(d, "approved").length, pe = on(d, "pending").length;
          return <button key={d} onClick={() => setPicked(d)} className={cn("flex h-14 flex-col items-start rounded-lg border p-1 text-left text-[11px] transition-colors hover:border-primary/50",
            hol ? "bg-violet/15" : m?.approval_status === "approved" ? "bg-success/15" : m?.approval_status === "pending" ? "bg-warning/15" : m?.approval_status === "rejected" ? "bg-destructive/10" : "bg-card",
            d === today && "ring-2 ring-primary", d === picked && "border-primary")}>
            <span className="font-medium">{Number(d.slice(8))}</span>
            {hol && <span className="truncate text-[9px] text-violet">{hol.name}</span>}
            {!hol && (ap + pe > 0) && <span className="text-[9px] text-muted-foreground">{ap ? `${ap} off` : ""}{pe ? ` ${pe} pend.` : ""}</span>}
          </button>;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">{[["bg-success", "Approved"], ["bg-warning", "Pending"], ["bg-destructive", "Rejected"], ["bg-violet", "Holiday"]].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", c)} />{l}</span>)}<span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full ring-2 ring-primary" />Today</span></div>
      <div className="mt-3 rounded-lg border bg-secondary/30 p-2 text-xs">
        <p className="font-medium">{new Date(picked + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · {staff ? `${staff - pickedOff.length}/${staff} available` : "—"}</p>
        <p className="text-muted-foreground">{pickedOff.length ? `On leave: ${pickedOff.map((p) => p.full_name || "Unnamed").join(", ")}` : "No one on approved leave."}</p>
      </div>
    </Card>
  );
}

function ApprovalCenter({ rows, isAdmin, userId, holDates, onDone }: { rows: LeaveRequest[]; isAdmin: boolean; userId: string; holDates: string[]; onDone: () => void }) {
  const [tab, setTab] = useState("pending");
  const [sel, setSel] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const list = rows.filter((r) => r.approval_status === tab);
  async function review(ids: string[], status: "approved" | "rejected") {
    if (status === "rejected" && !comment.trim()) return void toast.error("Add a rejection reason in the comment box");
    const warnings: string[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        const r = await wf.decideLeave(id, status, comment.trim());
        warnings.push(...r.warnings);
        done++;
      } catch (e) { toast.error(msg(e)); }
    }
    if (done) toast.success(`${done} request${done > 1 ? "s" : ""} ${status}`);
    [...new Set(warnings)].forEach((w) => toast.warning(w));
    setSel([]); setComment(""); onDone();
  }
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.employee?.full_name, r.leave_type, r.start_date, r.end_date, requestDays(r, holDates), r.reason, r.approval_status, r.manager_comment, r.created_at].map(esc).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([["employee,type,start,end,days,reason,status,comment,requested", ...lines].join("\n")], { type: "text/csv" }));
    a.download = `leave-${todayUTC()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold"><ShieldCheck className="h-5 w-5 text-primary" /> {isAdmin ? "Approval Center" : "My Requests"}</h3>
        <div className="flex gap-2">
          <div className="flex rounded-full border bg-secondary/40 p-0.5">{["pending", "approved", "rejected"].map((t) => <Button key={t} size="sm" variant={tab === t ? "default" : "ghost"} className="h-7 rounded-full px-3 text-xs capitalize" onClick={() => { setTab(t); setSel([]); }}>{t} ({rows.filter((r) => r.approval_status === t).length})</Button>)}</div>
          <Button size="sm" variant="outline" className="h-8" onClick={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>
      {list.length ? <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead className="text-left text-muted-foreground"><tr>{isAdmin && tab === "pending" && <th className="w-6" />}<th className="py-1.5">Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th />{tab !== "pending" && <th>Comment</th>}</tr></thead>
        <tbody className="divide-y">{list.map((r) => <tr key={r.id}>
          {isAdmin && tab === "pending" && <td><Checkbox aria-label="Select request" checked={sel.includes(r.id)} onCheckedChange={(v) => setSel(v ? [...sel, r.id] : sel.filter((s) => s !== r.id))} /></td>}
          <td className="py-2 font-medium">{r.employee?.full_name ?? "—"}{r.emergency && <span className="ml-1 rounded bg-destructive/15 px-1 text-[9px] text-destructive">Emergency</span>}</td>
          <td className="capitalize">{r.leave_type}</td>
          <td className="whitespace-nowrap">{r.start_date.slice(5)}{r.end_date !== r.start_date && ` → ${r.end_date.slice(5)}`}</td>
          <td>{requestDays(r, holDates)}</td>
          <td className="max-w-40 truncate" title={r.reason}>{r.reason}</td>
          <td className="whitespace-nowrap text-right">
            {isAdmin && r.approval_status === "pending" && <><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-success" onClick={() => review([r.id], "approved")}>Approve</Button><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive" onClick={() => review([r.id], "rejected")}>Reject</Button></>}
            {r.employee_id === userId && r.approval_status === "pending" && <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Cancel request" onClick={async () => { try { await wf.cancelLeave(r.id); } catch (e) { toast.error(msg(e)); } onDone(); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
          </td>
          {tab !== "pending" && <td className="max-w-40 truncate text-muted-foreground" title={r.manager_comment ?? ""}>{r.manager_comment ?? "—"}</td>}
        </tr>)}</tbody></table></div> : <Empty>No {tab} requests.</Empty>}
      {isAdmin && tab === "pending" && list.length > 0 && <div className="mt-3 flex flex-wrap gap-2"><Input className="h-8 flex-1 text-xs" placeholder="Manager comment (required to reject)" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /><Button size="sm" className="h-8" disabled={!sel.length} onClick={() => review(sel, "approved")}>Approve selected ({sel.length})</Button><Button size="sm" variant="outline" className="h-8" disabled={!sel.length} onClick={() => review(sel, "rejected")}>Reject selected</Button></div>}
    </Card>
  );
}

function TeamAvailability({ team, staff, today, minPct }: { team: TeamRow[]; staff: number; today: string; minPct: number }) {
  const off = new Set(team.filter((t) => t.approval_status === "approved" && t.start_date <= today && t.end_date >= today).map((t) => t.employee_id)).size;
  const upcoming = team.filter((t) => t.start_date > today);
  const pct = staff ? Math.round(((staff - off) / staff) * 100) : null;
  const next14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
  const low = next14.filter((d) => staff && new Set(team.filter((t) => t.approval_status === "approved" && t.start_date <= d && t.end_date >= d).map((t) => t.employee_id)).size / staff > 1 - minPct / 100);
  return (
    <Card>
      <CardTitle icon={Users} title="Team Availability" hint="This month's leave" />
      <div className="flex items-center gap-4">
        <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full border-8 border-success/60"><span className="font-display text-xl font-bold">{pct == null ? "—" : `${pct}%`}</span><span className="text-[9px] text-muted-foreground">Available</span></div>
        <ul className="space-y-1.5 text-xs">
          <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" />Available ({staff - off})</li>
          <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-warning" />On leave ({off})</li>
          <li className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-violet" />Upcoming leave ({upcoming.length})</li>
        </ul>
      </div>
      <p className={cn("mt-3 rounded-lg p-2 text-xs", low.length ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
        {low.length ? `Below ${minPct}% staffing on: ${low.map((d) => d.slice(5)).join(", ")}` : `Staffing stays above ${minPct}% for the next 14 days.`}
      </p>
    </Card>
  );
}

type Policy = { annual_days: number; casual_days: number; sick_days: number; unpaid_days: number; max_consecutive_days: number; min_staff_pct: number } | null | undefined;
function PolicyAdmin({ policy, holidays, onDone }: { policy: Policy; holidays: { id: string; holiday_date: string; name: string }[]; onDone: () => void }) {
  const [p, setP] = useState<Record<string, string>>({});
  const [h, setH] = useState({ date: "", name: "" });
  const fields = [["annual_days", "Annual days"], ["casual_days", "Casual days"], ["sick_days", "Sick days"], ["unpaid_days", "Unpaid days"], ["max_consecutive_days", "Max consecutive"], ["min_staff_pct", "Min staff %"]] as const;
  async function save() {
    const patch = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "").map(([k, v]) => [k, Math.max(0, Math.round(Number(v)))]));
    try { await wf.updatePolicy(patch); } catch (e) { return void toast.error(msg(e)); }
    toast.success("Leave policy saved"); setP({}); onDone();
  }
  async function addHoliday() {
    if (!h.date || !h.name.trim()) return void toast.error("Enter a date and name");
    try { await wf.addHoliday(h.date, h.name.trim()); } catch (e) { return void toast.error(msg(e)); }
    setH({ date: "", name: "" }); onDone();
  }
  return (
    <Card>
      <CardTitle icon={Settings2} title="Leave Policy" hint="Admins only" />
      <div className="grid grid-cols-3 gap-2">{fields.map(([k, l]) => <div key={k} className="space-y-1"><Label className="text-[11px]">{l}</Label><Input type="number" min={0} className="h-8" value={p[k] ?? String(policy?.[k] ?? "")} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>)}</div>
      <Button size="sm" className="mt-3" onClick={save} disabled={!Object.keys(p).length}>Save policy</Button>
      <div className="mt-4 border-t pt-3">
        <p className="mb-2 text-sm font-medium">Public holidays</p>
        <div className="flex gap-2"><Input type="date" className="h-8" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /><Input className="h-8" placeholder="Name" maxLength={80} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} /><Button size="sm" className="h-8" onClick={addHoliday}>Add</Button></div>
        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs">{holidays.map((x) => <li key={x.id} className="flex items-center justify-between"><span>{x.holiday_date} · {x.name}</span><Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Remove holiday" onClick={async () => { try { await wf.deleteHoliday(x.id); } catch (e) { toast.error(msg(e)); } onDone(); }}><Trash2 className="h-3 w-3" /></Button></li>)}</ul>
      </div>
    </Card>
  );
}
