import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { MapPin, CalendarDays, HeartPulse, CloudUpload, BrainCircuit, ChevronRight, ShieldCheck, CheckCircle2, Clock, Repeat, Bell, Activity, CircleAlert } from "lucide-react";
import { wf } from "@/lib/api";
import { lastVerify, readQueue, useToday, fmtTime } from "@/lib/attendance";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/AppShell";
import geo from "@/assets/dashboard-geopulse.jpg";
import shifts from "@/assets/dashboard-shifts.jpg";
import wellness from "@/assets/dashboard-wellness.jpg";
import sync from "@/assets/dashboard-sync.jpg";
import insights from "@/assets/dashboard-insights.jpg";

function Row({ icon: Icon, children, value }: { icon: typeof MapPin; children: ReactNode; value?: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/70 px-2 py-1 text-[10px]"><Icon className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="min-w-0 flex-1">{children}</span><span className="shrink-0 font-semibold">{value}</span></div>;
}

function Panel({ name, desc, icon: Icon, to, image, children, className = "" }: { name: string; desc: string; icon: typeof MapPin; to: "/attendance" | "/shifts" | "/wellness" | "/sync" | "/tasks"; image: string; children: ReactNode; className?: string }) {
  return <section className={`workspace-panel min-w-0 rounded-xl border bg-card p-3 shadow-card ${className}`}>
    <Button asChild variant="ghost" className="mb-2 h-auto w-full justify-start p-0 hover:bg-transparent"><Link to={to}><Icon className="size-8 text-primary" /><span className="min-w-0 flex-1 text-left"><span className="block font-display text-base font-semibold">{name}</span><span className="block whitespace-normal text-[10px] font-normal text-muted-foreground">{desc}</span></span><ChevronRight className="shrink-0" /></Link></Button>
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-t border-border/60 pt-2"><img src={image} width={992} height={672} loading="lazy" alt="" className="workspace-illustration aspect-[1.4] w-full rounded-lg object-contain" /><div className="min-w-0 space-y-1">{children}</div></div>
  </section>;
}

export function WorkspaceModules({ userId }: { userId: string }) {
  const { data: today } = useToday(userId);
  const [verify, setVerify] = useState<ReturnType<typeof lastVerify>>(null);
  const [queue, setQueue] = useState<ReturnType<typeof readQueue>>([]);
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState("Attendance");
  useEffect(() => {
    const update = () => { setVerify(lastVerify()); setQueue(readQueue()); setOnline(navigator.onLine); };
    update(); window.addEventListener("df-queue", update); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("df-queue", update); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const { data } = useQuery({ queryKey: ["workspace-panels", userId], queryFn: async () => {
    const [roster, swaps, records] = await Promise.all([
      wf.shifts({ start: new Date().toISOString().slice(0, 10), mine: true }),
      wf.swaps(),
      wf.attendance({ limit: 30 }),
    ]);
    return { roster: roster.slice(0, 7), swaps: swaps.filter((x) => x.requester_id === userId && x.status === "pending").length, records };
  }});
  const records = data?.records ?? [];
  const completed = records.filter(r => r.check_out_time);
  const hours = completed.reduce((s,r) => s + Number(r.total_working_hours ?? 0), 0);
  return <div className="space-y-3">
    <div className="grid gap-3 lg:grid-cols-3">
      <Panel name="GeoPulse" desc="GPS Attendance & Geofencing" icon={MapPin} to="/attendance" image={geo}>
        <div className="mb-1"><StatusPill status={verify?.result.status ?? "unconfigured"} /></div>
        <Row icon={MapPin} value={verify?.result.distance_m != null ? `${Math.round(verify.result.distance_m)} m` : "—"}>Distance</Row>
        <Row icon={Activity} value={verify ? `± ${Math.round(verify.fix.accuracy)} m` : "—"}>Accuracy</Row>
        <Row icon={ShieldCheck} value={verify?.result.status === "inside" ? "Verified" : "Not verified"}>Geofence</Row>
        <Button asChild variant="link" className="h-6 px-0 text-[10px]"><Link to="/location">Verify location <ChevronRight /></Link></Button>
      </Panel>
      <Panel name="RotaFlow" desc="Shift & Roster Management" icon={CalendarDays} to="/shifts" image={shifts}>
        <Row icon={CalendarDays} value={data?.roster.length ?? "—"}>Upcoming shifts</Row>
        <Row icon={Repeat} value={data?.swaps ?? "—"}>Swap requests</Row>
        <Row icon={Clock} value={data?.roster[0]?.shift_start?.slice(0,5) ?? "—"}>Next shift</Row>
        <Button asChild variant="outline" className="h-6 w-full px-2 text-[10px]"><Link to="/shifts"><CalendarDays /> Roster Calendar</Link></Button>
      </Panel>
      <Panel name="ZenBreak" desc="Work-Rest & Productivity" icon={HeartPulse} to="/wellness" image={wellness}>
        <div className="mb-2 text-center"><p className="text-[10px]">Breaks Today</p><p className="text-xl font-semibold text-success">{Math.round(today?.breakMinutes ?? 0)}<span className="text-[10px] text-muted-foreground"> min</span></p></div>
        <Row icon={Clock} value={today?.activeBreak ? "On break" : "Not on break"}>Break status</Row>
        <Button asChild variant="outline" className="h-6 w-full px-2 text-[10px]"><Link to="/wellness"><Bell /> Break Schedule</Link></Button>
        <Button asChild variant="outline" className="h-6 w-full px-2 text-[10px]"><Link to="/wellness"><HeartPulse /> Wellness Insights</Link></Button>
      </Panel>
    </div>
    <div className="grid gap-3 lg:grid-cols-[2fr_3fr]">
      <Panel name="SyncShield" desc="Offline Attendance & Data Synchronization" icon={CloudUpload} to="/sync" image={sync}>
        <div className="rounded-lg bg-success/10 p-1.5 text-[11px] font-semibold text-success">{online ? queue.length ? "Online · Sync pending" : "Online & Synced" : "Offline"}</div>
        <Row icon={CheckCircle2} value={records.filter(r => r.synced_offline).length}>Synced records</Row>
        <Row icon={Clock} value={queue.filter(q => !q.error).length}>Pending sync</Row>
        <Row icon={CircleAlert} value={queue.filter(q => q.error).length}>Failed records</Row>
        <Button asChild variant="link" className="h-6 px-0 text-[10px]"><Link to="/sync">Open synchronization <ChevronRight /></Link></Button>
      </Panel>
      <section className="workspace-panel min-w-0 rounded-xl border bg-card p-3 shadow-card">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:items-center sm:justify-between"><Button asChild variant="ghost" className="h-auto justify-start p-0"><Link to="/tasks"><BrainCircuit className="size-8 text-violet" /><span className="text-left"><span className="block text-base font-semibold">TaskForge</span><span className="block text-[10px] font-normal text-muted-foreground">Task & Productivity Management</span></span></Link></Button><div className="flex rounded-full border bg-background p-0.5">{["Attendance", "Hours"].map(t => <Button key={t} size="sm" variant={tab === t ? "default" : "ghost"} onClick={() => setTab(t)} className="h-6 rounded-full px-3 text-[10px]">{t}</Button>)}</div></div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3"><img src={insights} width={992} height={672} loading="lazy" alt="" className="workspace-illustration aspect-[1.2] w-full object-contain" /><div className="grid min-w-0 grid-cols-2 items-center gap-3"><div className="text-center"><p className="text-xs font-semibold">{tab === "Attendance" ? "Your Attendance" : "Working Hours"}</p><p className="my-3 text-3xl font-semibold text-violet">{tab === "Attendance" ? records.length : hours.toFixed(1)}</p><p className="text-[10px] text-muted-foreground">{tab === "Attendance" ? "Recent records" : "Completed shifts"}</p></div><div className="space-y-2"><Row icon={CheckCircle2} value={completed.length}>Completed</Row><Row icon={Clock} value={tab === "Attendance" ? records.length - completed.length : completed.length ? `${(hours/completed.length).toFixed(1)}h` : "—"}>{tab === "Attendance" ? "Open records" : "Average shift"}</Row><Button asChild variant="outline" className="h-7 w-full px-1 text-[10px]"><Link to="/tasks">Open tasks <ChevronRight /></Link></Button><p className="text-[9px] text-muted-foreground">Last 30 attendance records</p></div></div></div>
      </section>
    </div>
  </div>;
}