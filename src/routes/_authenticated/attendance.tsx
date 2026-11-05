import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { CheckCircle2, Clock, Coffee, Flag, History, MapPin, Play, ShieldCheck, Target, UserRound, CircleDot } from "lucide-react";
import { wf } from "@/lib/api";
import { AppShell, Card, CardTitle, Empty, StatusPill } from "@/components/AppShell";
import { BreakReminder, GeoPulsePanel, SyncShieldPanel } from "@/components/PunchPanel";
import { AIInsightsCard, KpiTile, ModuleHeading } from "@/components/ModuleUI";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtHours, fmtTime, lastVerify, useOfficeSettings, useToday, type VerifyResult } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import geoPhone from "@/assets/geo-phone.png";

const GeoMap = lazy(() => import("@/components/GeoMap"));

export const Route = createFileRoute("/_authenticated/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance – GeoPulse — Dayflow" },
      { name: "description", content: "GPS-based attendance with geofence verification and AI insights." },
      { property: "og:title", content: "Attendance – GeoPulse — Dayflow" },
      { property: "og:description", content: "GeoPulse check-in, geofence map, timeline and AI attendance insights." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AttendancePage,
});

const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function AttendancePage() {
  const { user } = Route.useRouteContext();
  const now = useNow();
  const { data: t } = useToday(user.id);
  const { data: office } = useOfficeSettings();
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [fix, setFix] = useState<[number, number] | null>(null);
  useEffect(() => {
    const read = () => { const v = lastVerify(); setVerify(v?.result ?? null); setFix(v ? [v.fix.lat, v.fix.lng] : null); };
    read();
    const i = setInterval(read, 2000);
    return () => clearInterval(i);
  }, [t]);

  const { data: rows } = useQuery({
    queryKey: ["attendance", "mine", user.id],
    queryFn: () => wf.attendance({ limit: 60 }),
  });
  const { data: logs } = useQuery({
    queryKey: ["attendance", "logs", user.id],
    queryFn: async () => (await wf.locationLogs()).slice(0, 10),
  });
  const { data: breakRows } = useQuery({
    queryKey: ["breaks", "today", t?.today?.id],
    enabled: !!t?.today,
    queryFn: async () => (await wf.today()).breaks,
  });
  const breaks = breakRows ?? [];

  const today = t?.today;
  const inMs = today ? new Date(today.check_in_time).getTime() : 0;
  const endMs = today?.check_out_time ? new Date(today.check_out_time).getTime() : now;
  const liveMs = today ? endMs - inMs : 0;
  const breakMs = (t?.breakMinutes ?? 0) * 60000;
  const status = today ? (today.check_out_time ? "Checked Out" : "Checked In") : "Not Checked In";
  const locStatus = verify?.status ?? today?.location_status;

  // Last 7 days
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10));
  const byDay = new Map((rows ?? []).map((r) => [r.attendance_date, r]));
  const present = days.filter((d) => byDay.has(d)).length;

  const timeline = [
    today && { icon: CheckCircle2, label: "Check In", time: today.check_in_time, tone: "text-success bg-success/15" },
    ...breaks.flatMap((b) => [
      { icon: Coffee, label: "Break", time: b.break_start, tone: "text-warning bg-warning/15" },
      ...(b.break_end ? [{ icon: Play, label: "Resume work", time: b.break_end, tone: "text-primary bg-primary/15" }] : []),
    ]),
    { icon: Flag, label: "Check Out", time: today?.check_out_time ?? null, tone: "text-foreground bg-muted" },
  ].filter(Boolean) as { icon: typeof Flag; label: string; time: string | null; tone: string }[];

  return (
    <AppShell user={user} title="GeoPulse">
      <ModuleHeading title="Attendance – GeoPulse" subtitle="GPS-based attendance with real-time verification and AI insights" />
      <BreakReminder userId={user.id} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="Today's Status" icon={UserRound} tone="success" value={status} valueTone={today && !today.check_out_time ? "success" : "default"} sub={today ? `Since ${fmtTime(today.check_in_time)}` : "Check in to start"} />
        <KpiTile label="Live Work Time" icon={Clock} tone="violet" value={hms(liveMs)} sub={today && !today.check_out_time ? (t?.activeBreak ? "On break" : "Working") : "—"} />
        <KpiTile label="Break Time" icon={Coffee} tone="primary" value={hms(breakMs)} sub={`${breaks.length} break${breaks.length === 1 ? "" : "s"} taken`} />
        <KpiTile label="Total Hours (Net)" icon={Target} tone="danger" value={hms(liveMs - breakMs)} sub="(Excl. break)" />
        <KpiTile label="Location Status" icon={ShieldCheck} tone="success" value={locStatus === "inside" ? "Inside Office" : locStatus === "outside" ? "Outside Office" : locStatus === "uncertain" ? "Uncertain" : locStatus === "low_accuracy" ? "GPS Uncertain" : "Not verified"} valueTone={locStatus === "inside" ? "success" : "default"} sub={verify?.distance_m != null ? `Distance: ${Math.round(verify.distance_m)} m` : "Verify to see distance"} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="relative">
          <GeoPulsePanel userId={user.id} />
          <img src={geoPhone} alt="" width={816} height={816} loading="lazy" className="pointer-events-none absolute -bottom-2 -left-2 hidden h-24 w-24 object-contain opacity-90 xl:block" />
        </div>
        <Card>
          <CardTitle icon={MapPin} title="Office Geofence" hint={office?.office_name ?? "Office"} />
          {office?.latitude != null && office?.longitude != null ? (
            <div className="relative">
              <ClientOnly fallback={<div className="h-56 rounded-xl bg-accent/60" />}>
                <Suspense fallback={<div className="h-56 rounded-xl bg-accent/60" />}>
                  <GeoMap office={[office.latitude, office.longitude]} radius={office.radius_m} you={fix} status={verify?.status} />
                </Suspense>
              </ClientOnly>
              <Radar status={verify?.status} />
            </div>
          ) : <Geofence radius={0} distance={null} configured={false} />}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CircleDot className="h-3 w-3 text-primary" /> Your location</span>
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3 text-success" /> Office</span>
            <span>Geofence ({office?.radius_m ?? "—"} m)</span>
          </div>
        </Card>
        <AIInsightsCard module="geopulse" title="AI Attendance Insights" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle title="Today's Timeline" />
          {today ? (
            <ol className="flex items-start justify-between gap-2 overflow-x-auto">
              {timeline.map((s, i) => (
                <li key={i} className="flex min-w-16 flex-1 flex-col items-center text-center">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-full", s.time ? s.tone : "bg-muted text-muted-foreground")}><s.icon className="h-4 w-4" /></div>
                  <p className="mt-2 text-xs font-semibold tabular-nums text-foreground">{s.time ? fmtTime(s.time) : "--"}</p>
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                </li>
              ))}
            </ol>
          ) : <Empty>No activity today yet.</Empty>}
        </Card>
        <Card>
          <CardTitle title="Attendance History" hint="Last 7 days" />
          <div className="flex items-end gap-4">
            <div className="flex h-28 flex-1 items-end justify-between gap-1.5">
              {days.map((d) => {
                const r = byDay.get(d);
                const h = r ? Math.min(1, Number(r.total_working_hours ?? 4) / 9) : 0.12;
                return (
                  <div key={d} className="flex flex-1 flex-col items-center gap-1">
                    <div className={cn("w-full rounded-md", r ? "bg-primary" : "bg-accent")} style={{ height: `${Math.max(12, h * 96)}px` }} title={r ? fmtHours(Number(r.total_working_hours)) : "Absent"} />
                    <span className="text-[10px] text-muted-foreground">{new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short" })}</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <div className="rounded-xl border px-3 py-2"><p className="font-display text-lg font-semibold">{present}/7</p><p className="text-[11px] text-muted-foreground">Days present</p></div>
              <div className="rounded-xl border px-3 py-2"><p className="font-display text-lg font-semibold">{Math.round((present / 7) * 1000) / 10}%</p><p className="text-[11px] text-muted-foreground">Attendance rate</p></div>
            </div>
          </div>
        </Card>
        <Card>
          <CardTitle title="Recent Location Verifications" />
          {logs?.length ? (
            <ul className="space-y-2.5 text-sm">
              {logs.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2">
                  <span className="truncate capitalize text-foreground">{l.purpose.replace("_", " ")} <span className="text-muted-foreground">· {fmtTime(l.recorded_at)}</span></span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><StatusPill status={l.geofence_status} />{l.distance_m != null && `${Math.round(l.distance_m)} m`}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No location checks yet.</Empty>}
        </Card>
      </div>

      <Card>
        <CardTitle icon={History} title="Attendance history" hint="Last 60 days" />
        {rows?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Check-in</TableHead><TableHead>Check-out</TableHead><TableHead>Hours</TableHead><TableHead>Location</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.attendance_date}</TableCell>
                    <TableCell className="tabular-nums">{fmtTime(r.check_in_time)}{r.synced_offline && <span className="ml-1 text-xs text-muted-foreground">(offline)</span>}</TableCell>
                    <TableCell className="tabular-nums">{fmtTime(r.check_out_time)}</TableCell>
                    <TableCell className="tabular-nums">{fmtHours(r.total_working_hours == null ? null : Number(r.total_working_hours))}</TableCell>
                    <TableCell><StatusPill status={r.location_status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <Empty>No attendance records yet.</Empty>}
      </Card>
      <SyncShieldPanel />
    </AppShell>
  );
}

/** Schematic geofence: office at centre, your last verified distance plotted to scale. */
function Geofence({ radius, distance, configured }: { radius: number; distance: number | null; configured: boolean }) {
  if (!configured) return <Empty>An administrator needs to set the office location first.</Empty>;
  const R = 70;
  const scale = distance != null ? Math.max(radius, distance) * 1.15 : radius;
  const fenceR = (radius / (scale || 1)) * R;
  const youR = distance != null ? (distance / (scale || 1)) * R : null;
  return (
    <div className="relative overflow-hidden rounded-xl bg-accent/60">
      <svg viewBox="0 0 200 160" className="h-44 w-full" role="img" aria-label="Office geofence map">
        <defs><pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" className="stroke-border" strokeWidth="0.6" /></pattern></defs>
        <rect width="200" height="160" fill="url(#grid)" />
        <circle cx="100" cy="80" r={fenceR} className="fill-primary/15 stroke-primary" strokeWidth="1" />
        <circle cx="100" cy="80" r="9" className="fill-success" />
        <text x="100" y="83.5" textAnchor="middle" className="fill-primary-foreground" fontSize="9">⌂</text>
        {youR != null && (
          <g>
            <line x1="100" y1="80" x2={100 + youR * 0.7} y2={80 + youR * 0.7} className="stroke-primary" strokeDasharray="3 2" strokeWidth="0.8" />
            <circle cx={100 + youR * 0.7} cy={80 + youR * 0.7} r="5" className="fill-primary stroke-card" strokeWidth="1.5" />
            <text x={100 + youR * 0.7 + 8} y={80 + youR * 0.7 + 3} fontSize="8" className="fill-foreground">You ({Math.round(distance!)} m)</text>
          </g>
        )}
      </svg>
      {youR == null && <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-muted-foreground">Verify your location to plot it here</p>}
    </div>
  );
}

/** Small animated radar overlay — purely decorative, shows the last real verification result. */
function Radar({ status }: { status?: string | undefined }) {
  const label = status === "inside" ? "Inside Office" : status === "outside" ? "Outside Office" : status === "uncertain" ? "Uncertain" : status === "low_accuracy" ? "GPS Uncertain" : "Not verified";
  const tone = status === "inside" ? "text-success" : status === "outside" ? "text-destructive" : "text-warning";
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-[500] flex items-center gap-2 rounded-full bg-card/90 py-1 pl-1 pr-3 shadow-sm">
      <div className="relative h-7 w-7 overflow-hidden rounded-full border border-primary/40 bg-primary/10">
        <div className="geo-radar-sweep absolute inset-0 rounded-full" />
        <div className="absolute inset-[11px] rounded-full bg-primary" />
      </div>
      <span className={cn("text-xs font-semibold", tone)}>{label}</span>
    </div>
  );
}
