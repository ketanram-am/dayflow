export type User = {
  id: string; email: string; name: string; role: "reviewer" | "employee";
  employee_id: string | null; csrf: string;
};
export type Interval = { start: string; end: string };
export type Shift = {
  id: string; start: string | null; end: string | null; breaks: Interval[];
  first_waiver: boolean; second_waiver: boolean; work_approved: boolean;
};
export type Employee = {
  id: string; name: string; department: string; title: string; employment: string;
  timezone: string; hourly_rate: string; weekly_salary: string; annual_salary: string;
};
export type ExceptionItem = {
  id: string; family: string; code: string; reference: string; title: string;
  clause: string; severity: string; blocking: boolean; facts: Record<string, unknown>;
};
export type CardRow = {
  id: string; employee: Employee; period_start: string; period_end: string; revision: number;
  period_status: string; pay_status: string; total: string | null; work_minutes: number;
  overtime_minutes: number; exceptions: ExceptionItem[]; reasons: string[]; workflow: string;
};
export type Trace = {
  id: string; week: string; component: string; label: string; quantity: string; unit: string;
  rate: string; unrounded: string; amount: string; formula: string; clause: string; sources: string[];
};
export type Pay = {
  status: string; total: string | null; lines: Trace[]; exceptions: ExceptionItem[];
  regular_rates: Record<string, string>; work_minutes: number; night_minutes: number;
  overtime_minutes: number; projected_minutes: Record<string, number | null>;
  comp_events: { at: string; minutes: number; balance?: number; source: string; kind: string }[];
  closing_comp_minutes: number | null; reasons: string[]; policy_version: string;
};
export type Edit = {
  operation: "add" | "replace" | "remove"; shift_id: string;
  start: string | null; end: string | null; breaks: Interval[];
};
export type Correction = { edits: Edit[]; clauses: string[]; evidence: string[]; reason: string };
export type Proof = {
  verified: boolean; verifier: string; hash: string; policy_hash: string;
  employee_confirmation_required: boolean; failures: string[];
  periods: { card_id: string; before: Pay; after: Pay; delta: string | null; delta_reason: string | null }[];
};
export type Proposal = {
  id: string; author: string; state: string; created_at: string; correction: Correction;
  proof: Proof | null; attestations: { actor: string; kind: string; reason: string; at: string }[];
  approval: { id: string; actor: string; at: string; proof_hash: string } | null;
};
export type PlanItem = {
  exception_id: string; code: string; kind: string; field: "start" | "end" | null; time: string | null;
  source: "note" | "schedule" | "records"; quote: string | null; reason: string; question: string | null;
};
export type TraceStep = { step: string; attempt?: number; ok?: boolean; error?: string; cached?: boolean;
  failures?: string[]; reason?: string; reply?: string; time?: string | null };
export type Resolution = {
  id: string; run_id: string; card_id: string; employee_id: string; employee: string; card_revision: number;
  lane: "ready" | "waiting" | "judgment" | "clear"; state: "open" | "approved" | "rejected" | "superseded";
  engine: "ai" | "rules"; hostile: boolean; headline: string; items: PlanItem[];
  correction: Correction | null; proposal_id: string | null; parent_id: string | null;
  simulation: { ok: boolean; failures: string[]; before_total: string | null; after_total: string | null;
    cleared: string[]; new_blocking: string[] };
  trace: TraceStep[]; created_at: string;
};
export type AgentScore = {
  cards: number; exceptions: number; item_accuracy_pct: number; note_dependent_items: number;
  note_dependent_accuracy_pct: number; right_time_on_first_ask: number; invented_or_wrong_from_note: number;
  lane_accuracy_pct: number; verifier_rejected_plans: number; hostile_notes_routed_to_manager: string;
  model_attempts: number; fallbacks_to_rules: number; seconds: number;
  manager_minutes_manual_estimate: number; manager_minutes_with_agent_estimate: number;
};
export type AgentRun = {
  id: string; started_by: string; mode: "ai" | "rules"; model: string | null; status: "running" | "finished" | "failed";
  total: number; done: number; started_at: string; finished_at: string | null;
  lanes: Partial<Record<Resolution["lane"], number>>; approved: number;
};
export type Dispute = {
  id: string; line_id: string | null; reason: string; revision: number; created_at: string;
  resolution: string | null; resolved_by: string | null;
};
export type Detail = {
  card: {
    id: string; employee: Employee; period_start: string; revision: number; period_status: string;
    shifts: Shift[]; schedules: (Interval & { id: string; planned_unpaid_break_minutes: number;
      absence_confirmed: boolean })[];
    leave: (Interval & { id: string; kind: string; approved: boolean })[];
    opening_comp_minutes: number; note: string; as_of: string;
  };
  pay: Pay; policy_signed: boolean; policy_hash: string; proposals: Proposal[]; disputes: Dispute[];
};
export type PolicyDocument = {
  version: string; disclaimer: string; clauses: Record<string, string>;
  rules: Record<string, string | number>;
};
export type PolicyVersion = {
  id: string; version: string; content_hash: string; source_hash: string;
  signer: string | null; signed_at: string | null; document: PolicyDocument;
  mappings: { field: string; value: string; clause: string; source: string }[];
};
export type PolicyResponse = { active_id: string | null; versions: PolicyVersion[] };
export type AuditEvent = {
  sequence: number; at: string; actor: string; action: string; entity: string;
  details: Record<string, unknown>; previous_hash: string; event_hash: string;
};
export type Scorecard = {
  seed: number; held_out_seed: number; employees: number; periods: number; labelled_exceptions: number;
  detection: Record<string, { precision: number; recall: number; tp: number; fp: number; fn: number }>;
  model_evaluation: string; release_gates: Record<string, unknown> | null;
  agent?: { rules_only: AgentScore; ai: (AgentScore & { model: string; licence: string }) | null;
    assumptions?: string; scope?: string; generated_at?: string };
  provenance: string; disclaimer: string;
};

let csrf = "";
export function setSession(user: User | null) { csrf = user?.csrf || ""; }
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    const text = await response.text();
    try {
      const error: { detail?: unknown } = JSON.parse(text);
      message = typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail);
    } catch { message = text || message; }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
