/** Row shapes returned by the Dayflow API (/api/wf/*). Field names match the original table names. */
export type Employee = {
  id: string; employee_id: string | null; full_name: string; email: string; profile_image: string | null;
  role: "admin" | "employee"; is_active: boolean; department: string | null; created_at: string;
};
export type EmployeeOverview = Employee & { attendance: Attendance | null; on_leave: boolean; shift_start: string | null };
export type OfficeSettings = {
  id: 1; office_name: string; latitude: number | null; longitude: number | null;
  radius_m: number; max_accuracy_m: number; break_reminder_min: number;
};
export type Attendance = {
  id: string; employee_id: string; attendance_date: string; check_in_time: string; check_out_time: string | null;
  latitude: number | null; longitude: number | null; location_status: "inside" | "outside";
  check_out_latitude: number | null; check_out_longitude: number | null; total_working_hours: number | null;
  synced_offline: number | boolean; check_in_event_id: string | null; check_out_event_id: string | null;
  server_received_at: string; created_at: string;
};
export type Break = { id: string; attendance_id: string; employee_id: string; break_start: string; break_end: string | null };
export type LocationLog = {
  id: string; employee_id: string; latitude: number; longitude: number; accuracy: number | null; distance_m: number | null;
  purpose: string; geofence_status: "inside" | "outside" | "uncertain" | "unconfigured" | "low_accuracy"; recorded_at: string;
};
export type TodayStatus = {
  today: Attendance | null; active_break: Break | null; break_minutes: number; net_minutes: number;
  continuous_minutes: number; reminder_due: boolean; breaks: Break[];
};
export type Shift = {
  id: string; employee_id: string; assigned_date: string; shift_start: string; shift_end: string; created_at: string;
  employee?: { full_name: string };
};
export type Swap = {
  id: string; shift_id: string; requester_id: string; target_employee_id: string | null; reason: string;
  status: "pending" | "approved" | "rejected"; created_at: string;
  shift: { assigned_date: string; shift_start: string; shift_end: string };
  requester: { full_name: string }; target: { full_name: string } | null;
};
export type LeaveType = "annual" | "sick" | "personal" | "unpaid" | "other";
export type LeaveRequest = {
  id: string; employee_id: string; leave_type: LeaveType; start_date: string; end_date: string; reason: string;
  duration: "full" | "half" | "hourly"; hours: number | null; emergency: boolean;
  approval_status: "pending" | "approved" | "rejected"; reviewed_by: string | null; reviewed_at: string | null;
  manager_comment: string | null; created_at: string;
  employee: { full_name: string; employee_id: string | null; profile_image: string | null };
};
export type LeavePolicy = {
  id: 1; annual_days: number; casual_days: number; sick_days: number; unpaid_days: number;
  max_consecutive_days: number; min_staff_pct: number; updated_at: string | null;
};
export type Holiday = { id: string; holiday_date: string; name: string };
export type Balances = Record<"annual" | "personal" | "sick" | "unpaid", { allowance: number; used: number; pending: number; remaining: number }>;
export type CalendarEntry = {
  employee_id: string; full_name: string; start_date: string; end_date: string;
  approval_status: "pending" | "approved"; leave_type: LeaveType;
};
export type Task = {
  id: string; title: string; project: string; tag: string; priority: "low" | "medium" | "high";
  status: "todo" | "in_progress" | "review" | "completed"; progress: number; assignee_id: string | null;
  due_date: string | null; completed_at: string | null; created_by: string; created_at: string;
};
export type SyncLogRow = {
  id: string; event_id: string | null; employee_id: string; kind: "check_in" | "check_out"; captured_at: string | null;
  synced_at: string; attempt: number; result: "success" | "failed" | "retry" | "conflict" | "correction";
  error: string | null; device_info: string | null; full_name: string; employee_code: string | null;
};
export type SyncConflict = {
  id: string; employee_id: string; conflict_type: "duplicate_punch" | "missing_checkout" | "leave_overlap" | "location_mismatch" | "sync_failure";
  conflict_date: string | null; details: string | null; severity: "low" | "medium" | "high";
  status: "open" | "resolved" | "rejected"; resolved_by: string | null; resolved_at: string | null; created_at: string;
  full_name: string; employee_code: string | null;
};
export type OrgKpis = {
  total_employees: number; present_today: number; present_last_week: number; on_leave: number; on_leave_yesterday: number;
  pending_leave: number; pending_swaps: number; open_conflicts: number;
};
export type TrendRow = { day: string; present: number; rate: number };
export type VerifyResult = {
  status: "inside" | "outside" | "uncertain" | "unconfigured" | "low_accuracy"; distance_m: number | null;
  radius_m: number; office_name: string; max_accuracy_m: number; accuracy_m: number | null;
};
export type PunchResult = Partial<VerifyResult> & { ok: boolean; code: string; message: string; attendance?: Attendance };
export type AssistantReply =
  | { ok: true; text: string; source: "rules" | "model"; notice?: string; counts: Record<string, number> }
  | { ok: false; error: string };
export type SessionUser = { id: string; email: string; name: string; role: "reviewer" | "employee"; employee_id: string | null; csrf: string };
