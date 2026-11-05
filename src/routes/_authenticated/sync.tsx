import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CloudUpload, Download, Eye, Loader2,
  RefreshCw, Search, ShieldCheck, Trash2, Wifi, WifiOff, XCircle,
} from "lucide-react";
import { wf } from "@/lib/api";
import { AppShell, Card, CardTitle } from "@/components/AppShell";
import { useQueue } from "@/components/PunchPanel";
import { AIAssistant, AIInsightsCard } from "@/components/ModuleUI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { flushQueue, lastSuccessfulSync, readQueue, useMe, writeQueue, type QueuedPunch } from "@/lib/attendance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/sync")({
  head: () => ({
    meta: [
      { title: "SyncShield — Dayflow" },
      { name: "description", content: "Offline attendance synchronization and recovery centre." },
      { property: "og:title", content: "SyncShield — Dayflow" },
      { property: "og:description", content: "Offline punches, conflict resolution and sync audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SyncPage,
});

type SyncLogRow = {
  id: string; event_id: string | null; employee_id: string; kind: string; captured_at: string | null;
  synced_at: string; attempt: number; result: string; error: string | null; device_info: string | null;
  full_name: string; employee_code: string | null;
};
type ConflictRow = {
  id: string; employee_id: string; conflict_type: string; conflict_date: string | null;
  details: string | null; severity: string; status: string; created_at: string;
  full_name: string; employee_code: string | null;
};

const CONFLICT_LABEL: Record<string, string> = {
  duplicate_punch: "Duplicate punches", missing_checkout: "Missing check-out", leave_overlap: "Leave overlap",
  location_mismatch: "Location mismatch", sync_failure: "Sync failure",
};
const SEVERITY_CLS: Record<string, string> = {
  high: "bg-destructive/15 text-destructive", medium: "bg-warning/15 text-warning", low: "bg-muted text-muted-foreground",
};

const nameMap = (rows: { employee_id: string; full_name: string; employee_code: string | null }[]) =>
  Object.fromEntries(rows.map((r) => [r.employee_id, r.full_name || r.employee_code || "Unknown"]));

function useSyncLog(_isAdmin: boolean) {
  return useQuery({
    queryKey: ["sync-log"],
    queryFn: async () => {
      const rows = (await wf.syncLog()) as SyncLogRow[];
      return { rows, names: nameMap(rows) };
    },
  });
}

function useConflicts() {
  return useQuery({
    queryKey: ["sync-conflicts"],
    queryFn: async () => {
      const rows = (await wf.conflicts()) as ConflictRow[];
      return { rows, names: nameMap(rows) };
    },
  });
}

function Stat({ label, value, sub, icon: Icon, tone }: { label: string; value: string | number; sub?: string; icon: typeof Wifi; tone: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tone)}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-xl font-semibold tabular-nums text-foreground">{value}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

function SyncPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { q, online } = useQueue();
  const { data: me } = useMe(user.id);
  const isAdmin = !!me?.isAdmin;
  const { data: logData, refetch: refetchLog, isFetching } = useSyncLog(isAdmin);
  const { data: conflictData, refetch: refetchConflicts } = useConflicts();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [connType, setConnType] = useState<string>("unknown");
  const [lastOnline, setLastOnline] = useState<string>(new Date().toISOString());

  useEffect(() => {
    setLastSync(lastSuccessfulSync());
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    if (conn?.effectiveType) setConnType(conn.effectiveType);
    const onOnline = () => setLastOnline(new Date().toISOString());
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const logs = logData?.rows ?? [];
  const names = logData?.names ?? {};
  const syncedCount = logs.filter((l) => l.result === "success").length;
  const failedLogs = logs.filter((l) => l.result === "failed").length;
  const failedQueue = q.filter((i) => i.error).length;
  const attempts = logs.length;
  const successRate = attempts ? Math.round((syncedCount / attempts) * 100) : null;
  const lastLogSync = logs.find((l) => l.result === "success")?.synced_at ?? null;
  const openConflicts = (conflictData?.rows ?? []).filter((c) => c.status === "open");

  async function syncNow() {
    setBusy(true);
    setProgress(null);
    const t0 = performance.now();
    const r = await flushQueue((done, total) => setProgress({ done, total }));
    setLatency(Math.round(performance.now() - t0));
    setBusy(false);
    setProgress(null);
    setLastSync(lastSuccessfulSync());
    if (r.synced) toast.success(`${r.synced} record${r.synced > 1 ? "s" : ""} synchronized`);
    if (r.failed) toast.error(`${r.failed} record${r.failed > 1 ? "s" : ""} could not be synced`);
    if (!r.synced && !r.failed) toast.info("Queue is empty — nothing to sync.");
    qc.invalidateQueries();
  }

  useEffect(() => {
    if (online && readQueue().some((i) => !i.error)) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const clientData = JSON.stringify({
    online, queue: q.map((i) => ({ kind: i.kind, capturedAt: i.capturedAt, attempts: i.attempts ?? 0, accuracy: Math.round(i.fix.accuracy), error: i.error ?? null })),
    recentSyncLog: logs.slice(0, 50).map((l) => ({ kind: l.kind, result: l.result, attempt: l.attempt, error: l.error, synced_at: l.synced_at })),
    openConflicts: openConflicts.map((c) => ({ type: c.conflict_type, date: c.conflict_date, severity: c.severity })),
  });

  return (
    <AppShell user={user} title="SyncShield">
      {/* 1 — Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground md:text-2xl">SyncShield</h2>
          <p className="text-sm text-muted-foreground">Offline Attendance Synchronization and Recovery</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", online ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{online ? "Online" : "Offline"}
          </span>
          <span className="text-xs text-muted-foreground">Last sync: {lastLogSync || lastSync ? new Date(lastLogSync ?? lastSync!).toLocaleString() : "never"}</span>
          <Button size="sm" onClick={syncNow} disabled={busy || !online}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="mr-1.5 h-3.5 w-3.5" />} Sync Now
          </Button>
          <Button size="sm" variant="outline" disabled={isFetching} onClick={() => { void refetchLog(); void refetchConflicts(); }}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* 2 — Statistics */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pending Records" value={q.length} sub="waiting on this device" icon={CloudUpload} tone="bg-primary/15 text-primary" />
        <Stat label="Successfully Synced" value={syncedCount} sub="confirmed by server" icon={CheckCircle2} tone="bg-success/15 text-success" />
        <Stat label="Failed Records" value={failedQueue + failedLogs} sub={failedQueue ? `${failedQueue} queued with errors` : "from sync log"} icon={XCircle} tone="bg-destructive/15 text-destructive" />
        <Stat label="Sync Success Rate" value={successRate == null ? "—" : `${successRate}%`} sub={attempts ? `${attempts} attempts logged` : "no attempts yet"} icon={Activity} tone="bg-accent text-accent-foreground" />
      </section>

      {/* 3 — Monitoring: queue + network */}
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><QueueTable q={q} isAdmin={isAdmin} employeeName={me?.employee?.full_name ?? "You"} employeeCode={me?.employee?.employee_id ?? "—"} onSync={syncNow} busy={busy} /></div>
        <div className="lg:col-span-2"><NetworkMonitor online={online} connType={connType} lastOnline={lastOnline} lastSync={lastLogSync ?? lastSync} latency={latency} progress={progress} busy={busy} /></div>
      </section>

      {/* 4 — Intelligence: conflicts + recovery */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ConflictCentre data={conflictData} isAdmin={isAdmin} onChanged={() => { void refetchConflicts(); void refetchLog(); }} />
        <RecoveryEngine q={q} busy={busy} progress={progress} lastSync={lastLogSync ?? lastSync} onSync={syncNow} />
      </section>

      {/* 5 — History */}
      <SyncHistory logs={logs} names={names} isAdmin={isAdmin} />

      {/* 6 — AI */}
      <section className="grid gap-4 lg:grid-cols-2">
        <AIInsightsCard module="sync" title="AI Sync Intelligence" clientData={clientData} />
        <AIAssistant module="sync" title="AI Sync Assistant" clientData={clientData}
          suggestions={["Why did synchronization fail?", "Are there any duplicate attendance records?", "Summarize today's synchronization issues.", "Which records require administrator attention?"]} />
      </section>
    </AppShell>
  );
}

/* ---------- Smart Offline Queue ---------- */
function QueueTable({ q, isAdmin, employeeName, employeeCode, onSync, busy }: {
  q: QueuedPunch[]; isAdmin: boolean; employeeName: string; employeeCode: string; onSync: () => void; busy: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "failed">("all");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<QueuedPunch | null>(null);
  const PER_PAGE = 6;

  const rows = useMemo(() => {
    let r = q.filter((i) => (status === "all" ? true : status === "failed" ? !!i.error : !i.error));
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((i) => employeeName.toLowerCase().includes(s) || employeeCode.toLowerCase().includes(s) || i.kind.includes(s));
    }
    r = [...r].sort((a, b) => (sortDesc ? b.capturedAt.localeCompare(a.capturedAt) : a.capturedAt.localeCompare(b.capturedAt)));
    return r;
  }, [q, search, status, sortDesc, employeeName, employeeCode]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const pageRows = rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  function retryOne(item: QueuedPunch) {
    writeQueue(readQueue().map((x) => {
      if (x.id !== item.id) return x;
      const { error: _drop, ...rest } = x;
      return { ...rest, attempts: 0, lastTry: 0 };
    }));
    onSync();
  }

  return (
    <Card className="p-4">
      <CardTitle icon={CloudUpload} title="Smart Offline Queue" hint="Punches stored on this device until the server confirms them"
        right={q.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={onSync}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Sync All</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search employee or type…" className="h-8 pl-8 text-xs" />
        </div>
        <div className="flex gap-1">
          {(["all", "pending", "failed"] as const).map((s) => (
            <button key={s} onClick={() => { setStatus(s); setPage(0); }}
              className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium capitalize", status === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>{s}</button>
          ))}
        </div>
      </div>
      {pageRows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {q.length === 0 ? "No queued records. Punches taken without a connection appear here and sync automatically." : "No records match your filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Employee</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="cursor-pointer py-2 pr-3 font-medium" onClick={() => setSortDesc(!sortDesc)}>Recorded {sortDesc ? "↓" : "↑"}</th>
                <th className="py-2 pr-3 font-medium">GPS</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Tries</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3"><p className="font-medium text-foreground">{employeeName}</p><p className="text-[11px] text-muted-foreground">{employeeCode}</p></td>
                  <td className="py-2.5 pr-3 text-foreground">{i.kind === "check_in" ? "Check-in" : "Check-out"}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{new Date(i.capturedAt).toLocaleString()}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{i.fix.lat.toFixed(4)}, {i.fix.lng.toFixed(4)}</td>
                  <td className="py-2.5 pr-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", i.error ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning")}>{i.error ? "Failed" : "Pending"}</span>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{i.attempts ?? 0}</td>
                  <td className="py-2.5">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="View details" onClick={() => setDetail(i)}><Eye className="h-3.5 w-3.5" /></Button>
                      {i.error && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Retry" onClick={() => retryOne(i)}><RefreshCw className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Discard" onClick={() => writeQueue(readQueue().filter((x) => x.id !== i.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {pages} · {rows.length} records</span>
          <div className="flex gap-1">
            <Button size="icon" variant="outline" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}
      {detail && (
        <div className="mt-3 rounded-lg border bg-secondary/50 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <p className="font-medium text-foreground">Record details</p>
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Close details" onClick={() => setDetail(null)}><XCircle className="h-3.5 w-3.5" /></Button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
            <dt>Event ID</dt><dd className="truncate font-mono text-foreground">{detail.id}</dd>
            <dt>Type</dt><dd className="text-foreground">{detail.kind === "check_in" ? "Check-in" : "Check-out"}</dd>
            <dt>Captured</dt><dd className="text-foreground">{new Date(detail.capturedAt).toLocaleString()}</dd>
            <dt>Coordinates</dt><dd className="tabular-nums text-foreground">{detail.fix.lat.toFixed(5)}, {detail.fix.lng.toFixed(5)} (±{Math.round(detail.fix.accuracy)} m)</dd>
            <dt>Device</dt><dd className="truncate text-foreground">{detail.device ?? "this browser"}</dd>
            {detail.error && <><dt>Error</dt><dd className="text-destructive">{detail.error}</dd></>}
          </dl>
        </div>
      )}
      {isAdmin && <p className="mt-2 text-[11px] text-muted-foreground">The queue lives in each employee's own browser (IndexedDB) — administrators see and sync their own device queue here.</p>}
    </Card>
  );
}

/* ---------- Live Network Monitor ---------- */
function NetworkMonitor({ online, connType, lastOnline, lastSync, latency, progress, busy }: {
  online: boolean; connType: string; lastOnline: string; lastSync: string | null; latency: number | null;
  progress: { done: number; total: number } | null; busy: boolean;
}) {
  return (
    <Card className="p-4">
      <CardTitle icon={online ? Wifi : WifiOff} title="Live Network Monitor" right={
        <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium", online ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", online ? "animate-pulse bg-success" : "bg-warning")} />{online ? "Online" : "Offline"}
        </span>} />
      <dl className="space-y-2.5 text-xs">
        {[
          ["Connection type", connType === "unknown" ? "not reported by browser" : connType],
          ["Last online", new Date(lastOnline).toLocaleString()],
          ["Last successful sync", lastSync ? new Date(lastSync).toLocaleString() : "never"],
          ["Last sync duration", latency == null ? "—" : `${(latency / 1000).toFixed(1)} s`],
          ["Auto-reconnect", "Enabled — syncs when connection returns"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
            <dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      {busy && progress && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] text-muted-foreground">Synchronizing {progress.done} of {progress.total}…</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Conflict Resolution Centre ---------- */
function ConflictCentre({ data, isAdmin, onChanged }: { data: { rows: ConflictRow[]; names: Record<string, string> } | undefined; isAdmin: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const rows = data?.rows ?? [];
  const names = data?.names ?? {};
  const open = rows.filter((c) => c.status === "open");

  async function scan() {
    setScanning(true);
    try {
      const r = await wf.scan();
      toast.success(`Attendance records scanned: ${r.new_conflicts} new conflict${r.new_conflicts === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    }
    setScanning(false);
    onChanged();
  }
  async function resolve(id: string, action: "resolved" | "rejected") {
    setBusy(id);
    try {
      const r = await wf.resolveConflict(id, action);
      if (!r.ok) toast.error(r.message ?? "Could not update conflict");
      else toast.success(`Conflict marked as ${action}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update conflict");
    }
    setBusy(null);
    onChanged();
  }

  return (
    <Card className="p-4">
      <CardTitle icon={AlertTriangle} title="Conflict Resolution Centre" hint="Attendance issues flagged for review"
        right={isAdmin && <Button size="sm" variant="outline" disabled={scanning} onClick={scan}>{scanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />} Scan records</Button>} />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No conflicts detected. {isAdmin ? "Run a scan to check attendance records for duplicates, missing check-outs and leave overlaps." : ""}
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg border p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SEVERITY_CLS[c.severity])}>{c.severity}</span>
                  <p className="font-medium text-foreground">{CONFLICT_LABEL[c.conflict_type] ?? c.conflict_type}</p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", c.status === "open" ? "bg-warning/15 text-warning" : c.status === "resolved" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{c.status}</span>
              </div>
              <p className="mt-1.5 text-muted-foreground">{names[c.employee_id] ?? "Employee"} · {c.conflict_date ?? "—"}</p>
              {c.details && <p className="mt-1 text-muted-foreground">{c.details}</p>}
              {isAdmin && c.status === "open" && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" className="h-7 text-[11px]" disabled={busy === c.id} onClick={() => resolve(c.id, "resolved")}>
                    {busy === c.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />} Approve correction
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={busy === c.id} onClick={() => resolve(c.id, "rejected")}>
                    <XCircle className="mr-1 h-3 w-3" /> Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{open.length} open conflict{open.length > 1 ? "s" : ""} · every decision is written to the audit trail below.</p>}
    </Card>
  );
}

/* ---------- Automatic Recovery Engine ---------- */
function RecoveryEngine({ q, busy, progress, lastSync, onSync }: {
  q: QueuedPunch[]; busy: boolean; progress: { done: number; total: number } | null; lastSync: string | null; onSync: () => void;
}) {
  const waiting = q.filter((i) => !i.error && !(i.attempts ?? 0)).length;
  const retrying = q.filter((i) => !i.error && (i.attempts ?? 0) > 0).length;
  const failed = q.filter((i) => i.error).length;
  const items = [
    { label: "Waiting for recovery", value: waiting, cls: "text-primary" },
    { label: "Retrying with backoff", value: retrying, cls: "text-warning" },
    { label: "Processing now", value: busy && progress ? progress.total - progress.done : 0, cls: "text-primary" },
    { label: "Permanently failed", value: failed, cls: "text-destructive" },
  ];
  return (
    <Card className="p-4">
      <CardTitle icon={ShieldCheck} title="Automatic Recovery Engine" hint="Reconnects, retries and prevents duplicates" />
      <div className="grid grid-cols-2 gap-2">
        {items.map((i) => (
          <div key={i.label} className="rounded-lg border p-3">
            <p className={cn("font-display text-2xl font-semibold tabular-nums", i.cls)}>{i.value}</p>
            <p className="text-[11px] text-muted-foreground">{i.label}</p>
          </div>
        ))}
      </div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Queued records carry a unique event ID — the server records each event only once, even on double submission.</li>
        <li>Failed network attempts retry automatically with exponential backoff (1 min up to 30 min).</li>
        <li>Records stay on this device until the server confirms them.</li>
        <li>Last recovery activity: {lastSync ? new Date(lastSync).toLocaleString() : "none yet"}.</li>
      </ul>
      {q.length > 0 && <Button size="sm" className="mt-3 w-full" disabled={busy} onClick={onSync}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Recover now</Button>}
    </Card>
  );
}

/* ---------- Sync History & Audit Trail ---------- */
function SyncHistory({ logs, names, isAdmin }: { logs: SyncLogRow[]; names: Record<string, string>; isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState("all");
  const [page, setPage] = useState(0);
  const PER_PAGE = 8;

  const rows = useMemo(() => {
    let r = logs.filter((l) => (result === "all" ? true : l.result === result));
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((l) => (names[l.employee_id] ?? "").toLowerCase().includes(s) || l.kind.includes(s) || (l.error ?? "").toLowerCase().includes(s));
    }
    return r;
  }, [logs, search, result, names]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const pageRows = rows.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  function exportCsv() {
    const header = "record_id,employee,type,captured_at,synced_at,attempt,result,error,device";
    const lines = rows.map((l) => [l.id, names[l.employee_id] ?? l.employee_id, l.kind, l.captured_at ?? "", l.synced_at, l.attempt, l.result, (l.error ?? "").replaceAll(",", ";"), (l.device_info ?? "").replaceAll(",", ";")].join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `syncshield-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card className="p-4">
      <CardTitle icon={Activity} title="Sync History & Audit Trail" hint="Every sync attempt, retry and admin correction"
        right={<Button size="sm" variant="outline" disabled={!rows.length} onClick={exportCsv}><Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV</Button>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search employee or error…" className="h-8 pl-8 text-xs" />
        </div>
        <div className="flex flex-wrap gap-1">
          {["all", "success", "failed", "retry", "correction"].map((s) => (
            <button key={s} onClick={() => { setResult(s); setPage(0); }}
              className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium capitalize", result === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}>{s}</button>
          ))}
        </div>
      </div>
      {pageRows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No sync activity recorded yet. Synced offline punches and admin corrections will appear here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {isAdmin && <th className="py-2 pr-3 font-medium">Employee</th>}
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Captured</th>
                <th className="py-2 pr-3 font-medium">Synced</th>
                <th className="py-2 pr-3 font-medium">Try</th>
                <th className="py-2 pr-3 font-medium">Result</th>
                <th className="py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  {isAdmin && <td className="py-2.5 pr-3 font-medium text-foreground">{names[l.employee_id] ?? "—"}</td>}
                  <td className="py-2.5 pr-3 text-foreground">{l.kind === "check_in" ? "Check-in" : l.kind === "check_out" ? "Check-out" : l.kind}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{l.captured_at ? new Date(l.captured_at).toLocaleString() : "—"}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{new Date(l.synced_at).toLocaleString()}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{l.attempt}</td>
                  <td className="py-2.5 pr-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                      l.result === "success" ? "bg-success/15 text-success" : l.result === "failed" ? "bg-destructive/15 text-destructive" : l.result === "correction" ? "bg-accent text-accent-foreground" : "bg-warning/15 text-warning")}>{l.result}</span>
                  </td>
                  <td className="max-w-52 truncate py-2.5 text-muted-foreground" title={l.error ?? ""}>{l.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {pages} · {rows.length} entries</span>
          <div className="flex gap-1">
            <Button size="icon" variant="outline" className="h-7 w-7" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}
    </Card>
  );
}
