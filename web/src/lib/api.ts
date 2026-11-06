/**
 * Client for the Dayflow FastAPI backend. Replaces the Supabase client: the browser holds only a
 * session cookie plus a CSRF token, and every rule (geofence, leave balance, conflicts) is enforced
 * on the server.
 */
import type * as T from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let csrf = "";
let session: T.SessionUser | null | undefined;
const listeners = new Set<(user: T.SessionUser | null) => void>();

function emit(user: T.SessionUser | null) {
  session = user;
  csrf = user?.csrf ?? "";
  listeners.forEach((fn) => fn(user));
}

export function onAuthChange(fn: (user: T.SessionUser | null) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export async function request<R>(method: string, path: string, body?: unknown): Promise<R> {
  let res: Response;
  try { res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" && csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }); } catch {
    throw new ApiError("Could not reach the Dayflow server. Check your connection and backend address.", 0);
  }
  if (res.status === 401 && session) emit(null);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (res.ok && data === null && res.status !== 204) {
    throw new ApiError("Dayflow returned an invalid response. Check that /api points to the FastAPI backend.", res.status);
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const message = typeof detail === "string" ? detail
      : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ")
      : text.trimStart().startsWith("<") ? "Could not reach the Dayflow server. Is the backend running?" : text.slice(0, 200) || res.statusText;
    throw new ApiError(message || "Request failed", res.status);
  }
  return data as R;
}

export const get = <R,>(path: string, params?: Record<string, string | number | boolean | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return request<R>("GET", path + (s ? `?${s}` : ""));
};

/** Auth: cookie session opened by /api/demo/start. */
export const auth = {
  /** The signed-in user if the session has already been loaded (no network). */
  current: (): T.SessionUser | null => session ?? null,
  /** Current session user, or null when signed out. Caches after the first call. */
  async getSession(): Promise<T.SessionUser | null> {
    if (session !== undefined) return session;
    try {
      emit(await request<T.SessionUser>("GET", "/me"));
    } catch {
      emit(null);
    }
    return session ?? null;
  },
  /** Opens as the manager; there is no sign-in page. Needs the backend to run with DAYFLOW_DEMO_SWITCH=1. */
  async start() {
    const user = await request<T.SessionUser>("POST", "/demo/start", {});
    emit(user);
    return user;
  },
  /** Demo only: the accounts one click away (empty unless the backend sets DAYFLOW_DEMO_SWITCH=1). */
  demoAccounts: () => get<{ enabled: boolean; accounts: { id: string; name: string; role: "reviewer" | "employee"; label: string; current: boolean }[] }>("/demo/accounts"),
  /** Demo only: forget my own attendance for today so check-in can be shown again. */
  demoResetDay: () => request<{ status: string; records: number }>("POST", "/demo/reset-day", {}),
  async switchTo(userId: string) {
    emit(await request<T.SessionUser>("POST", "/demo/switch", { user_id: userId }));
    return session!;
  },
  async logout() {
    try { await request("POST", "/logout", {}); } finally { emit(null); }
  },
  changePassword: (current: string, next: string) => request("POST", "/wf/password", { current, new: next }),
};

export const wf = {
  me: () => get<{ employee: T.Employee | null; isAdmin: boolean }>("/wf/me"),
  employees: () => get<T.Employee[]>("/wf/employees"),
  overview: (date?: string) => get<T.EmployeeOverview[]>("/wf/employees/overview", { date }),
  colleagues: () => get<{ id: string; full_name: string }[]>("/wf/colleagues"),
  updateEmployee: (id: string, patch: Partial<{ full_name: string; employee_id: string; is_active: boolean; role: "admin" | "employee" }>) =>
    request<T.Employee>("PATCH", `/wf/employees/${id}`, patch),

  office: () => get<T.OfficeSettings>("/wf/office"),
  setOffice: (patch: Partial<Omit<T.OfficeSettings, "id">>) => request<T.OfficeSettings>("PUT", "/wf/office", patch),
  verify: (fix: { lat: number; lng: number; accuracy: number }, purpose = "verify") =>
    request<T.VerifyResult>("POST", "/wf/location/verify", { ...fix, purpose }),
  locationLogs: () => get<T.LocationLog[]>("/wf/location/logs"),
  punch: (p: { kind: "check_in" | "check_out"; lat: number; lng: number; accuracy: number; captured_at?: string; event_id?: string }) =>
    request<T.PunchResult>("POST", "/wf/punch", p),

  today: () => get<T.TodayStatus>("/wf/attendance/today"),
  attendance: (p?: { employee_id?: string; start?: string; end?: string; limit?: number }) => get<T.Attendance[]>("/wf/attendance", p),
  report: (start: string, end: string) => get<T.Attendance[]>("/wf/attendance/report", { start, end }),
  week: () => get<Pick<T.Attendance, "attendance_date" | "total_working_hours">[]>("/wf/attendance/week"),
  breaks: (since?: string) => get<T.Break[]>("/wf/breaks", { since }),
  startBreak: () => request<T.Break>("POST", "/wf/breaks/start", {}),
  endBreak: () => request<T.Break>("POST", "/wf/breaks/end", {}),

  logSync: (e: { event_id?: string; kind: "check_in" | "check_out"; captured_at?: string; attempt: number; result: "success" | "failed" | "retry"; error?: string; device?: string }) =>
    request("POST", "/wf/sync/log", e),
  syncLog: () => get<T.SyncLogRow[]>("/wf/sync/log"),
  conflicts: () => get<T.SyncConflict[]>("/wf/sync/conflicts"),
  scan: () => request<{ ok: boolean; new_conflicts: number }>("POST", "/wf/sync/scan", {}),
  resolveConflict: (id: string, action: "resolved" | "rejected") =>
    request<{ ok: boolean; message: string }>("POST", `/wf/sync/conflicts/${id}`, { action }),

  shifts: (p?: { start?: string; end?: string; mine?: boolean }) => get<T.Shift[]>("/wf/shifts", p),
  saveShift: (s: { employee_id: string; date: string; start: string; end: string }) => request<T.Shift>("PUT", "/wf/shifts", s),
  deleteShift: (id: string) => request("DELETE", `/wf/shifts/${id}`),
  swaps: () => get<T.Swap[]>("/wf/swaps"),
  requestSwap: (s: { shift_id: string; target_employee_id: string | null; reason: string }) => request("POST", "/wf/swaps", s),
  decideSwap: (id: string, status: "approved" | "rejected") => request("POST", `/wf/swaps/${id}/decision`, { status }),
  setSwapTarget: (id: string, target_employee_id: string) => request("PUT", `/wf/swaps/${id}/target`, { target_employee_id }),
  cancelSwap: (id: string) => request("DELETE", `/wf/swaps/${id}`),

  leave: (status?: string) => get<T.LeaveRequest[]>("/wf/leave", { status }),
  requestLeave: (r: { leave_type: T.LeaveType; start_date: string; end_date?: string; reason?: string; duration?: "full" | "half" | "hourly"; hours?: number; emergency?: boolean }) =>
    request<{ id: string; days: number }>("POST", "/wf/leave", r),
  decideLeave: (id: string, status: "approved" | "rejected", comment = "") =>
    request<{ status: string; warnings: string[] }>("POST", `/wf/leave/${id}/decision`, { status, comment }),
  cancelLeave: (id: string) => request("DELETE", `/wf/leave/${id}`),
  balances: (employee_id?: string) => get<T.Balances>("/wf/leave/balances", { employee_id }),
  calendar: (start: string, end: string) => get<T.CalendarEntry[]>("/wf/leave/calendar", { start, end }),
  policy: () => get<T.LeavePolicy>("/wf/leave/policy"),
  updatePolicy: (p: Partial<Omit<T.LeavePolicy, "id" | "updated_at">>) => request<T.LeavePolicy>("PUT", "/wf/leave/policy", p),
  holidays: () => get<T.Holiday[]>("/wf/holidays"),
  addHoliday: (date: string, name: string) => request<T.Holiday>("POST", "/wf/holidays", { date, name }),
  deleteHoliday: (id: string) => request("DELETE", `/wf/holidays/${id}`),

  tasks: () => get<T.Task[]>("/wf/tasks"),
  createTask: (t: Partial<Task> & { title: string }) => request<T.Task>("POST", "/wf/tasks", t),
  updateTask: (id: string, patch: Partial<Task>) => request<T.Task>("PATCH", `/wf/tasks/${id}`, patch),
  deleteTask: (id: string) => request("DELETE", `/wf/tasks/${id}`),

  kpis: () => get<T.OrgKpis>("/wf/dashboard/kpis"),
  trend: (days = 7) => get<T.TrendRow[]>("/wf/dashboard/trend", { days }),
  departments: () => get<{ department: string; n: number }[]>("/wf/dashboard/departments"),
  ask: (module: "geopulse" | "shifts" | "wellness" | "sync" | "tasks" | "leave", question?: string) =>
    request<T.AssistantReply>("POST", "/wf/assistant", { module, question }),
};
type Task = T.Task;
export type { T };
