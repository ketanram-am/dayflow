/**
 * Typed client for Dayflow's engine endpoints: the resolution agent, overtime forecast and planner,
 * policy ruleset, pay derivations, audit chain and eval scorecard. Built on the session/CSRF
 * request helper in ./api. Every number shown by the UI must come from these responses.
 */
import { get, request } from "./api";

export type Interval = { start: string; end: string };
export type CardShift = {
  id: string; start: string | null; end: string | null; breaks: Interval[];
  first_waiver: boolean; second_waiver: boolean; work_approved: boolean;
};
export type PayrollEmployee = {
  id: string; name: string; department: string; title: string; employment: string;
  timezone: string; hourly_rate: string; weekly_salary: string; annual_salary: string;
};
export type ExceptionItem = {
  id: string; family: string; code: string; reference: string; title: string;
  clause: string; severity: string; blocking: boolean; facts: Record<string, unknown>;
};
export type CardRow = {
  id: string; employee: PayrollEmployee; period_start: string; period_end: string; revision: number;
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
  /** Proof attached to kind "fix_schedule": mode "reschedule" | "reassign", what moves, which checks passed. */
  detail?: { mode: "reschedule" | "reassign"; shift_id: string; when?: string; to_when?: string;
    to_employee_id: string; to_employee: string; checks?: string[]; cleared?: string[] } | null;
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
    id: string; employee: PayrollEmployee; period_start: string; revision: number; period_status: string;
    shifts: CardShift[]; schedules: (Interval & { id: string; planned_unpaid_break_minutes: number;
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


export type Lane = Resolution["lane"];
export type RunLanes = AgentRun["lanes"];

export type ForecastOption = {
  id: string; kind: "finish_early" | "hand_over"; title: string; minutes: number;
  overtime_minutes_avoided: number; saving: string | null; checks: string[]; date: string;
  new_end?: string; minutes_cut?: number; to_employee_id?: string; to_employee?: string; to_projected_after?: number;
};
export type ForecastPerson = {
  employee_id: string; employee: string; department: string; worked_minutes: number; remaining_minutes: number;
  projected_minutes: number; over_minutes: number; overtime_cost: string | null;
  days: { date: string; worked: number; remaining: number }[];
  options: ForecastOption[]; recommended: string | null; no_option_reason: string | null;
};
export type Forecast = {
  week_start: string; as_of: string; today: string; threshold_minutes: number; employees_checked: number;
  flagged: ForecastPerson[]; potential_saving: string; note: string;
};
export type PlannerSuggestion = {
  id: string; employee: string; employee_minutes: number; to: string | null; to_minutes: number | null;
  shift: string; overtime_minutes_avoided: number; saving: string | null; reason: string; sent: boolean;
  before: { employee: string; to: string } | null; after: { employee: string; to: string } | null;
};
export type LlmStatus = { enabled: boolean; configured: boolean; mode?: string; model?: string | null };
export type WhatIf = {
  status: "ok"; source: string; note: string; message: string; document: PolicyDocument;
  change: { field: string; label: string; unit: string; clause: string; old: string; new: string;
    clause_before: string; clause_after: string };
  replay: { period_start: string; active_version: string; candidate_version: string; cards: number;
    changed: number; incomplete: number; total_before: string; total_after: string; total_delta: string;
    by_component: Record<string, string>;
    rows: { card_id: string; employee: string; employment: string; before: string | null;
      after: string | null; delta: string | null; incomplete: boolean }[] };
} | { status: "blocked" | "not_understood" | "invalid"; message: string; source?: string };

export type Notification = {
  id: string; recipient_id: string; kind: "question" | "correction_approved"; card_id: string | null;
  proposal_id: string | null; subject: string; body: string; delivery: string; created_at: string; read_at: string | null;
};

export const dayflow = {
  notifications: () => get<{ notifications: Notification[] }>("/wf/notifications"),
  markRead: (id: string) => request("POST", `/wf/notifications/${id}/read`, {}),
  config: () => get<{ llm_mode: string; llm_enabled: boolean; llm_configured: boolean; model: string | null;
    licence: string; disclaimer: string; dataset: string; verifier: string }>("/config"),
  setAi: (enabled: boolean, model?: string) => request("POST", "/llm", { enabled, ...(model ? { model } : {}) }),

  cards: () => get<{ cards: CardRow[]; policy_signed: boolean; policy_version: string }>("/cards"),
  card: (id: string) => get<Detail>(`/cards/${id}`),
  explain: (id: string, question: string) => request<{ mode: string; cited_line_ids: string[]; text: string; source: string; status: string; notice: string | null }>(
    "POST", `/cards/${id}/explain`, { question }),

  // Resolution agent
  startRun: (useAi: boolean) => request<AgentRun>("POST", "/agent/runs", { use_ai: useAi }),
  latestRun: () => get<{ run: AgentRun | null }>("/agent/runs/latest"),
  resolutions: () => get<{ run: AgentRun | null; items: Resolution[] }>("/resolutions"),
  approve: (id: string) => request<{ status: string; verified: boolean; failures: string[] }>("POST", `/resolutions/${id}/approve`, {}),
  approveReady: () => request<{ approved: number; blocked: number; errors: unknown[] }>("POST", "/resolutions/approve-ready", {}),
  reject: (id: string, reason: string) => request("POST", `/resolutions/${id}/reject`, { reason }),
  answer: (id: string, reply: "yes" | "no" | "correct", time?: string) =>
    request("POST", `/resolutions/${id}/answer`, { reply, ...(time ? { time } : {}) }),

  // Overtime
  forecast: () => get<Forecast>("/wf/forecast"),
  applyForecast: (optionId: string) => request<{ status: string; option: ForecastOption }>("POST", "/wf/forecast/apply", { option_id: optionId }),
  planner: () => get<{ week: string; suggestions: PlannerSuggestion[] }>("/planner"),
  sendSwap: (id: string) => request("POST", `/planner/${id}/send`, {}),

  // Policy, audit, evidence
  policies: () => get<PolicyResponse>("/policies"),
  signPolicy: (id: string, hash: string) => request("POST", `/policies/${id}/sign`, { hash, reviewed: true }),
  whatIf: (p: { question?: string; field?: string; value?: number }) => request<WhatIf>("POST", "/policies/what-if", p),
  audit: () => get<{ events: AuditEvent[]; integrity: boolean; unverified_commits: number }>("/audit"),
  scorecard: () => get<Scorecard>("/scorecard"),
};
