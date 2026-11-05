import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LogIn, LogOut, Coffee, Play, WifiOff, RefreshCw, Trash2, MapPin } from "lucide-react";
import { wf } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, StatusPill } from "@/components/AppShell";
import {
  enqueuePunch, flushQueue, fmtTime, getPosition, lastVerify, punch, PunchError, readQueue, useMe, useOfficeSettings, useToday, verifyLocation, writeQueue,
  type GeoFix, type QueuedPunch, type VerifyResult,
} from "@/lib/attendance";

function isNetworkError(e: unknown) {
  return !navigator.onLine || /fetch|network/i.test(e instanceof Error ? e.message : String(e));
}

export function useQueue() {
  const [q, setQ] = useState<QueuedPunch[]>([]);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const up = () => setQ(readQueue());
    const net = () => setOnline(navigator.onLine);
    up(); net();
    window.addEventListener("df-queue", up);
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => { window.removeEventListener("df-queue", up); window.removeEventListener("online", net); window.removeEventListener("offline", net); };
  }, []);
  return { q, online };
}

export function GeoPulsePanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { data } = useToday(userId);
  const [busy, setBusy] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const { data: me } = useMe(userId);
  const { data: office } = useOfficeSettings();
  const unconfigured = office ? office.latitude == null || office.longitude == null : false;
  useEffect(() => {
    const l = lastVerify();
    setVerify(l?.result ?? null);
    setFix(l?.fix ?? null);
  }, []);

  async function setOfficeHere() {
    setBusy("office");
    try {
      const f = await getPosition();
      await wf.setOffice({ latitude: f.lat, longitude: f.lng, max_accuracy_m: Math.max(100, Math.ceil(f.accuracy) + 50) });
      toast.success(`Office set to your current location (± ${Math.round(f.accuracy)} m). Adjust radius in Settings.`);
      qc.invalidateQueries({ queryKey: ["office"] });
      setFix(f);
      setVerify(await verifyLocation(f, "verify"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set the office location");
    } finally {
      setBusy(null);
    }
  }
  const today = data?.today;
  const checkedIn = !!today && !today.check_out_time;
  const done = !!today?.check_out_time;

  async function doPunch(kind: "check_in" | "check_out") {
    setBusy(kind);
    try {
      const fix = await getPosition();
      if (!navigator.onLine) {
        enqueuePunch(kind, fix);
        toast.info("You're offline. Punch saved and will sync when you reconnect.");
        return;
      }
      setFix(fix);
      try {
        const r = await punch(kind, fix);
        setVerify(r as VerifyResult);
        toast.success(r.message);
      } catch (e) {
        if (e instanceof PunchError) {
          setVerify(e.result.status ? (e.result as VerifyResult) : null);
          throw e;
        }
        if (isNetworkError(e)) {
          enqueuePunch(kind, fix);
          toast.info("Connection lost. Punch queued for sync.");
        } else throw e;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record your punch");
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["today", userId] });
      qc.invalidateQueries({ queryKey: ["attendance"] });
    }
  }

  async function brk(start: boolean) {
    setBusy("break");
    try {
      await (start ? wf.startBreak() : wf.endBreak());
    } catch (e) {
      setBusy(null);
      return void toast.error(e instanceof Error ? e.message : "Could not update your break");
    }
    setBusy(null);
    toast.success(start ? "Break started" : "Welcome back");
    qc.invalidateQueries({ queryKey: ["today", userId] });
    qc.invalidateQueries({ queryKey: ["attendance"] });
  }

  return (
    <Card>
      <CardTitle icon={MapPin} title="GeoPulse" hint="Geofenced check-in and check-out" right={verify && <StatusPill status={verify.status} />} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Button size="lg" disabled={!!busy || checkedIn || done || unconfigured} onClick={() => doPunch("check_in")}>
          {busy === "check_in" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />} Check in
        </Button>
        <Button size="lg" variant="outline" disabled={!!busy || !checkedIn} onClick={() => { if (window.confirm(`Check out now? You can only check in once per day, so this ends today's attendance.`)) doPunch("check_out"); }}>
          {busy === "check_out" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />} Check out
        </Button>
      </div>
      {unconfigured && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
          <p className="font-medium">Office location not set — check-in is disabled.</p>
          {me?.isAdmin ? (
            <Button size="sm" className="mt-3" disabled={!!busy} onClick={setOfficeHere}>
              {busy === "office" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />} Set office to my current location
            </Button>
          ) : <p className="mt-1 text-warning/80">Ask an administrator to set the office in Settings.</p>}
        </div>
      )}
      {(verify || fix) && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border p-4 text-xs">
          {fix && <><dt className="text-muted-foreground">Your location</dt><dd className="text-right tabular-nums text-foreground">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</dd></>}
          {fix && <><dt className="text-muted-foreground">GPS accuracy</dt><dd className="text-right tabular-nums text-foreground">± {Math.round(fix.accuracy)} m</dd></>}
          {verify?.distance_m != null && <><dt className="text-muted-foreground">Distance from office</dt><dd className="text-right tabular-nums text-foreground">{Math.round(verify.distance_m)} m (allowed {verify.radius_m} m)</dd></>}
        </dl>
      )}
      {fix && office?.latitude != null && office.longitude != null && (
        <iframe
          title="Map of your location and the office"
          className="mt-4 h-48 w-full rounded-xl border"
          loading="lazy"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${Math.min(fix.lng, office.longitude) - 0.004},${Math.min(fix.lat, office.latitude) - 0.003},${Math.max(fix.lng, office.longitude) + 0.004},${Math.max(fix.lat, office.latitude) + 0.003}&layer=mapnik&marker=${office.latitude},${office.longitude}`}
        />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {done ? `Day complete — checked out at ${fmtTime(today?.check_out_time)}.` : checkedIn ? `Checked in at ${fmtTime(today?.check_in_time)}.` : "Your location is read once when you press Check in, and verified against the office area."}
      </p>
      {checkedIn && (
        <div className="mt-5 flex items-center justify-between rounded-xl border p-4">
          <div className="flex items-center gap-3">
            <Coffee className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">BreakGuard</p>
              <p className="text-xs text-muted-foreground">{data?.activeBreak ? `On break since ${fmtTime(data.activeBreak.break_start)}` : `${Math.round(data?.breakMinutes ?? 0)} min of breaks today`}</p>
            </div>
          </div>
          <Button size="sm" variant={data?.activeBreak ? "default" : "secondary"} disabled={busy === "break"} onClick={() => brk(!data?.activeBreak)}>
            {data?.activeBreak ? <><Play className="mr-1 h-3.5 w-3.5" /> End break</> : <><Coffee className="mr-1 h-3.5 w-3.5" /> Start break</>}
          </Button>
        </div>
      )}
    </Card>
  );
}

export function BreakReminder({ userId }: { userId: string }) {
  const { data } = useToday(userId);
  const { data: office } = useOfficeSettings();
  const t = data?.today;
  if (!t || t.check_out_time || data?.activeBreak || !office) return null;
  const minutesWorked = (Date.now() - new Date(t.check_in_time).getTime()) / 60000 - (data?.breakMinutes ?? 0);
  if (data && data.breakMinutes > 0 && minutesWorked < office.break_reminder_min * 2) return null;
  if (minutesWorked < office.break_reminder_min) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
      <Coffee className="h-4 w-4 shrink-0" /> You've worked {Math.floor(minutesWorked / 60)}h {Math.round(minutesWorked % 60)}m without a break. Consider taking one.
    </div>
  );
}

export function SyncShieldPanel() {
  const qc = useQueryClient();
  const { q, online } = useQueue();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    const r = await flushQueue();
    setBusy(false);
    if (r.synced) toast.success(`${r.synced} punch${r.synced > 1 ? "es" : ""} synced`);
    if (r.failed) toast.error(`${r.failed} punch${r.failed > 1 ? "es" : ""} could not be synced`);
    qc.invalidateQueries();
  }
  useEffect(() => {
    if (online && readQueue().some((i) => !i.error)) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return (
    <Card>
      <CardTitle icon={WifiOff} title="SyncShield" hint="Offline punches are kept on this device until synced" right={<span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${online ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{online ? "Online" : "Offline"}</span>} />
      {q.length === 0 ? (
        <p className="text-sm text-muted-foreground">No queued punches. If you lose connection while punching, it will be saved here and synced automatically.</p>
      ) : (
        <ul className="space-y-2">
          {q.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{i.kind === "check_in" ? "Check in" : "Check out"} · {new Date(i.capturedAt).toLocaleString()}</p>
                <p className={`truncate text-xs ${i.error ? "text-destructive" : "text-warning"}`}>{i.error ? `Requires review: ${i.error}` : "Pending sync"}</p>
              </div>
              <Button size="icon" variant="ghost" aria-label="Discard" onClick={() => writeQueue(readQueue().filter((x) => x.id !== i.id))}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      {q.length > 0 && (
        <Button className="mt-4 w-full" variant="secondary" disabled={!online || busy} onClick={sync}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Sync now
        </Button>
      )}
    </Card>
  );
}
