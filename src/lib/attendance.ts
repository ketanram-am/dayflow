import { useQuery } from "@tanstack/react-query";
import { auth, wf } from "@/lib/api";
import type { Attendance as AttendanceRow, Employee as EmployeeRow, VerifyResult } from "@/lib/types";

export type Employee = EmployeeRow;
export type Attendance = AttendanceRow;
export type { VerifyResult };

export function useMe(userId: string) {
  return useQuery({
    queryKey: ["me", userId],
    queryFn: () => wf.me(),
  });
}

export function useOfficeSettings() {
  return useQuery({ queryKey: ["office"], queryFn: () => wf.office() });
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Today's session, active break and totals. Every total is computed on the server from saved timestamps. */
export function useToday(userId: string) {
  return useQuery({
    queryKey: ["today", userId],
    refetchInterval: 30000,
    queryFn: async () => {
      const s = await wf.today();
      const latest = s.today;
      const open = latest && !latest.check_out_time ? latest : null;
      const today = latest && latest.attendance_date === todayUTC() ? latest : open;
      return {
        today,
        activeBreak: today ? s.active_break : null,
        breakMinutes: today ? s.break_minutes : 0,
        netMinutes: today ? s.net_minutes : 0,
        continuousMinutes: today ? s.continuous_minutes : 0,
        reminderDue: today ? s.reminder_due : false,
        breaks: today ? s.breaks : [],
      };
    },
  });
}

export type GeoFix = { lat: number; lng: number; accuracy: number; at: number };

export function getPosition(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This device does not support location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }),
      (e) => reject(Object.assign(new Error(e.code === 1 ? "Location permission was denied." : e.code === 3 ? "Getting your location timed out." : "Your location could not be determined."), { code: e.code })),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export async function permissionState(): Promise<PermissionState | "unsupported"> {
  try {
    const r = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return r.state;
  } catch {
    return "unsupported";
  }
}


export async function verifyLocation(fix: GeoFix, purpose = "verify") {
  const r = await wf.verify({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }, purpose);
  sessionStorage.setItem("df_last_verify", JSON.stringify({ fix, result: r }));
  return r;
}

export function lastVerify(): { fix: GeoFix; result: VerifyResult } | null {
  try {
    return JSON.parse(sessionStorage.getItem("df_last_verify") ?? "null");
  } catch {
    return null;
  }
}

/* ---------- SyncShield: offline punch queue (IndexedDB-backed) ---------- */
export type QueuedPunch = { userId?: string | undefined; id: string; kind: "check_in" | "check_out"; fix: GeoFix; capturedAt: string; error?: string; attempts?: number; device?: string; lastTry?: number };
const QKEY = "df_offline_queue";
const IDB_NAME = "df_syncshield";
const IDB_STORE = "queue";

let queueCache: QueuedPunch[] | null = null;

function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistQueue(q: QueuedPunch[]) {
  try {
    const db = await openQueueDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).clear();
      for (const item of q) tx.objectStore(IDB_STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* localStorage mirror still holds the queue */
  }
}

function deviceInfo() {
  return typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : "";
}

// Hydrate the in-memory cache from IndexedDB once, migrating any legacy localStorage queue.
if (typeof window !== "undefined" && "indexedDB" in window) {
  void openQueueDb()
    .then(
      (db) =>
        new Promise<QueuedPunch[]>((resolve) => {
          const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAll();
          req.onsuccess = () => resolve((req.result as QueuedPunch[]) ?? []);
          req.onerror = () => resolve([]);
        }),
    )
    .then((rows) => {
      let legacy: QueuedPunch[] = [];
      try {
        legacy = JSON.parse(localStorage.getItem(QKEY) ?? "[]");
      } catch {
        legacy = [];
      }
      queueCache = rows.length ? rows : legacy;
      if (!rows.length && legacy.length) void persistQueue(legacy);
      window.dispatchEvent(new Event("df-queue"));
    })
    .catch(() => {});
}

export function readQueue(): QueuedPunch[] {
  if (queueCache) return queueCache;
  try {
    return JSON.parse(localStorage.getItem(QKEY) ?? "[]");
  } catch {
    return [];
  }
}
export function writeQueue(q: QueuedPunch[]) {
  queueCache = q;
  localStorage.setItem(QKEY, JSON.stringify(q));
  void persistQueue(q);
  window.dispatchEvent(new Event("df-queue"));
}
export function enqueuePunch(kind: QueuedPunch["kind"], fix: GeoFix) {
  writeQueue([...readQueue(), { id: crypto.randomUUID(), userId: auth.current()?.id, kind, fix, capturedAt: new Date().toISOString(), attempts: 0, device: deviceInfo() }]);
}

function logSyncEvent(item: QueuedPunch, attempt: number, result: "success" | "failed" | "retry", error?: string) {
  void wf
    .logSync({
      event_id: item.id, kind: item.kind, captured_at: item.capturedAt, attempt, result,
      error: error ?? "", device: item.device ?? deviceInfo(),
    })
    .then(() => {}, () => {});
  if (result === "success") localStorage.setItem("df_last_sync", new Date().toISOString());
}

export function lastSuccessfulSync(): string | null {
  try {
    return localStorage.getItem("df_last_sync");
  } catch {
    return null;
  }
}

export type PunchResult = Partial<VerifyResult> & { ok: boolean; code: string; message: string; attendance?: Attendance };

export class PunchError extends Error {
  constructor(public result: PunchResult) {
    super(result.message);
  }
}

export async function punch(kind: QueuedPunch["kind"], fix: GeoFix, capturedAt?: string, eventId?: string) {
  const r = (await wf.punch({
    kind, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy,
    ...(capturedAt ? { captured_at: capturedAt } : {}),
    event_id: eventId ?? crypto.randomUUID(),
  })) as PunchResult;
  if (r.status) sessionStorage.setItem("df_last_verify", JSON.stringify({ fix, result: r }));
  if (!r.ok) throw new PunchError(r);
  return r;
}

export async function flushQueue(onProgress?: (done: number, total: number) => void) {
  // A shared device must never replay one employee's punches under another employee's session.
  const me = auth.current()?.id;
  const all = readQueue();
  const q = all.filter((i) => !i.userId || i.userId === me);
  const left: QueuedPunch[] = all.filter((i) => i.userId && i.userId !== me);
  let synced = 0;
  let done = 0;
  for (const item of q) {
    const attempt = (item.attempts ?? 0) + 1;
    // Exponential backoff: skip items retried too recently (1m, 2m, 4m … capped at 30m).
    const waitMs = Math.min(30 * 60000, 60000 * 2 ** Math.max(0, (item.attempts ?? 0) - 1));
    if ((item.attempts ?? 0) > 0 && item.error === undefined && Date.now() - (item.lastTry ?? 0) < waitMs) {
      left.push(item);
      onProgress?.(++done, q.length);
      continue;
    }
    try {
      await punch(item.kind, item.fix, item.capturedAt, item.id);
      synced++;
      logSyncEvent(item, attempt, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/fetch|network/i.test(msg)) {
        left.push({ ...item, attempts: attempt, lastTry: Date.now() });
        logSyncEvent(item, attempt, "retry", msg);
      } else {
        left.push({ ...item, attempts: attempt, lastTry: Date.now(), error: msg });
        logSyncEvent(item, attempt, "failed", msg);
      }
    }
    onProgress?.(++done, q.length);
  }
  writeQueue(left);
  return { synced, failed: left.length };
}

export function fmtTime(t?: string | null) {
  return t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}
export function fmtHours(h?: number | null) {
  if (h == null) return "—";
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
