# Building the Dayflow screens in Lovable

The backend already does the work. What is missing is the screens that show it, in the same look as
the rest of the web app (`web/`). Paste the prompts below into Lovable **in order**, one at a time,
and check each result before sending the next.

## Before you start (5 minutes, once)

1. Copy this repo's `web/` folder over the root of the Lovable project's GitHub repo (keep her `.lovable/`
   folder if present). It has no Supabase: everything goes through `src/lib/api.ts`, and the typed
   Dayflow client is `src/lib/dayflow.ts`.
2. In the repo run `npm install`, start the backend (`uvicorn app.main:app --app-dir backend --port 8000`
   from the Dayflow repo) and `npm run dev` in `web/`. Sign in as `avery@dayflow.demo` /
   `Dayflow-demo-2026!`. Lovable's preview cannot reach a backend on your laptop, so build in Lovable and
   verify locally.
3. If Lovable's preview shows a blank page, that is expected: it has no backend. Ask it to keep every
   page type-safe and to show a clear empty or error state when `/api` is unreachable.

---

## Prompt 0: Foundation (send first)

```
This app is Dayflow, a timecard resolution product. It is NOT called WorkSync anywhere. Keep the
existing visual language (dark sidebar, blue gradient accents, rounded cards, Poppins, the Logo
component) and reuse the existing components in src/components and src/components/ui. Do not add new
UI libraries and do not touch Supabase (there is none): all data comes from src/lib/api.ts
(auth + wf.*) and src/lib/dayflow.ts (the Dayflow engine endpoints). Read both files first and use
their types; never invent fields.

Do these three things only:
1. In AppShell add a second sidebar group named "Resolve" under the existing "Workspace" group, visible
   to administrators only, with these links and lucide icons: Resolution queue (/queue, ListChecks),
   Overtime (/overtime, TrendingUp), Policy studio (/policy, ScrollText), Pay explorer (/pay, Receipt),
   Audit ledger (/audit, ShieldCheck), Scorecard (/scorecard, BarChart3).
   For employees, add a single link "My pay" (/pay) and a "Questions for you" badge on it when
   dayflow.resolutions() returns open items waiting on that employee.
2. Create empty routes for those six pages under src/routes/_authenticated/ using the same pattern as
   dashboard.tsx (AppShell with a title, head() meta with "— Dayflow" titles, Route.useRouteContext for
   the user, useMe for isAdmin). Non-admins who open an admin-only page see a friendly "Administrators
   only" Empty state.
3. Add a small shared component src/components/dayflow/Money.tsx that formats engine strings such as
   "1824.80" as currency using Intl.NumberFormat, and returns "Not computed" for null. The UI must
   never do arithmetic on money; it only displays strings the backend sent.

Keep everything type-safe (npx tsc --noEmit must pass) and respect prefers-reduced-motion.
```

## Prompt 1: Resolution queue (the headline feature)

```
Build /queue (src/routes/_authenticated/queue.tsx) using dayflow.* from src/lib/dayflow.ts.

Purpose: an AI agent has already planned a compliant fix for every timecard exception. The manager sees
three lanes and approves what is proven. Nothing is approved by the agent.

Layout, top to bottom:
- Header row: title "Resolution queue", subtitle "Every fix is proven by the pay engine before you see
  it." On the right: a switch "Use AI to read employee notes" (disabled with a tooltip when
  dayflow.config().llm_configured is false) and a primary button "Run agent" calling
  dayflow.startRun(useAi). While status is "running" poll dayflow.latestRun() every 900 ms and show an
  animated progress bar (done / total) and the lane counters filling in live. Toast on finish.
- KPI strip (4 tiles using KpiTile): Ready to approve, Waiting on employee, Needs your judgment, Approved
  this run. Numbers come from run.lanes and run.approved.
- Three lanes as three columns (stacked on mobile), each a Card with a coloured top border:
  Ready to approve (success), Waiting on the employee (warning), Needs your judgment (destructive).
  Only the Ready lane has a button "Approve all" calling dayflow.approveReady() with a confirm dialog;
  show a toast with approved/blocked counts afterwards and refetch.
- Each plan card (framer-motion layout animations on enter/exit): employee name + card id, a one-line
  headline, small chips for each item kind (humanise: fill_punch → "Add missing punch", remove_duplicate →
  "Remove duplicate", pay_premium → "Pay meal premium", accept_as_recorded → "Pay as recorded",
  ask_employee → "Ask employee", fix_schedule → "Fix schedule", needs_manager → "Manager decides",
  record_leave → "Record leave"), an engine badge ("AI read the note" or "Rules"), and pay before →
  after from simulation (Money component). Clicking a card opens a right-side Sheet.
- The Sheet (plan drawer) shows: the items list, each with its reason; for items with source "note" show
  the employee's quote highlighted like a blockquote with the proposed time; for kind "fix_schedule"
  show detail.when → detail.to_when (or "give to {to_employee}") and the checks list with green ticks;
  an "Engine check" section from simulation (ok / failures, cleared exception ids, new_blocking);
  an "Agent steps" timeline from trace[] (step names humanised; show rejected AI answers with their
  error text in amber, e.g. "AI answer rejected: the note does not state 21:00"); and buttons Approve
  (only when lane === "ready", calls dayflow.approve(id)) and Reject (needs a reason of 8+ characters,
  calls dayflow.reject). For lane "waiting" show "Waiting for {employee} to confirm" and no approve
  button. For lane "judgment" show why a person must decide. If hostile is true show a clear banner:
  "This note tried to give instructions to the system. It was not sent to the AI."
- Empty state before the first run: an illustration-less card with the sentence "Run the agent to plan
  fixes for every exception" and the Run agent button.

Errors from the API arrive as ApiError.message; show them in toasts. Approve must be disabled while a
request is in flight. Add aria-labels on icon buttons and make the lanes keyboard navigable.
```

## Prompt 2: Employee "Questions for you" (inside /pay for employees)

```
On /pay, when the signed-in user is an employee, show a card "Questions for you" above their pay. Use
dayflow.resolutions() and keep only items whose lane is "waiting", state "open" and employee_id equals
the user's employee id. For each item show the question text from the first PlanItem that has `question`,
and the employee's own note quote if present. Three actions: "Yes, that's right"
(dayflow.answer(id, "yes")), "No" (dayflow.answer(id, "no")), and a time input (HH:MM, 24h) with the
button "Use this time" (dayflow.answer(id, "correct", time)). After answering, show a thank-you state
("Your manager will approve it next") and refetch. Keep the tone friendly, one question per card, no
jargon.
```

## Prompt 3: Overtime (forecast + next-week planner)

```
Build /overtime using dayflow.forecast(), dayflow.applyForecast(optionId), dayflow.planner() and
dayflow.sendSwap(id). Two tabs: "This week (live)" and "Next week (planned)".

This week: header "Overtime you can still stop" with sub text "Worked hours so far plus the shifts still
scheduled. Updated {as_of}." A summary tile with potential_saving (Money) and the count of flagged
people. For each flagged person a card: name, department, a segmented bar of the week's days (worked in
blue, still scheduled in light blue, a vertical marker at threshold_minutes / 5 per day, text
"{projected} h projected, {over} min over the {threshold} h line"), then their options as radio cards
(title, saving in Money, overtime minutes avoided, the checks list as small ticks). The recommended option
is preselected and badged "Recommended". Button "Apply" opens a confirm dialog that restates what will
change ("End Maya's Saturday shift at 11:45 instead of 15:00. This updates RotaFlow and is recorded in
the audit ledger.") then calls applyForecast(option.id), toasts, and refetches. If options is empty show
no_option_reason in an amber note. Respect 409 errors with "The forecast changed, refreshed".

Next week: list planner().suggestions as cards (employee → to, shift, saving in Money, before/after
totals, reason). Each has "Send to scheduling" (sendSwap) which turns into a "Sent" badge once sent.
Suggestions with to === null show the reason and "No safe swap" without a button.
```

## Prompt 4: Policy, Pay, Audit, Scorecard

```
Build the remaining four pages with the Dayflow client.

/policy: list dayflow.policies().versions. Show the active (signed) ruleset with its clauses (DF-001...)
as an accordion; each rule value shows the clause id and source sentence from `mappings`. For an unsigned
ruleset show a review checkbox ("I reviewed every source sentence and its mapped rule") and the primary
button "Sign and activate" (dayflow.signPolicy(id, content_hash)); disabled until ticked. Below, a "What
if we changed a rule?" box: a text input ("What if overtime started after 7 hours?"), a suggestion
chips row, calls dayflow.whatIf({question}); render the result generically: status, the rule and value
it understood, and any per-employee dollar changes as a table with Money cells. Show `source`
("model" or "rules") as a small badge.

/pay: admins pick a card from dayflow.cards() (searchable table: employee, period, status, total, open
exceptions). Opening one shows dayflow.card(id): the note ("Employee note: for context only, not proof of
time worked"), shifts vs schedule timeline, the pay lines table (label, quantity unit, rate, amount,
clause chip) and an expandable formula row from each line's `formula` and `sources`. An "Ask about this
paycheck" input calls dayflow.explain and shows text with its `source` badge and `notice`. Employees land
here directly on their own card(s).

/audit: dayflow.audit(): a banner "The chain is intact" (green) or "Chain broken" (red) from integrity;
a vertical timeline of events (action humanised, actor, entity, time, a collapsible details JSON and a
shortened event_hash). Filter chips by action type and a text search.

/scorecard: dayflow.scorecard(). A hero section "Measured, not claimed" comparing agent.rules_only and
agent.ai side by side (item_accuracy_pct, note_dependent_accuracy_pct, lane_accuracy_pct,
invented_or_wrong_from_note, verifier_rejected_plans, fallbacks_to_rules, manager minutes manual vs with
agent) as animated count-up numbers and paired bars. If ai is null say "No model run recorded". Then a
Detection table (precision / recall / tp / fp / fn per exception family). Footer: the disclaimer string
and the provenance text, always visible.
```

---

## Where this can still improve (be upfront about these)

**Product**
1. **Resolution queue is the demo.** If time is short, polish Prompts 0 to 2 and skip 4; judges remember
   the queue and the one-tap employee answer.
2. **Geofence evidence feeds payroll.** A verified GeoPulse check-out near the office is strong
   evidence for a missing clock-out. Today GeoPulse and the resolution agent are separate; wiring a
   "verified punch near the missing time" into the plan would close the loop between the two halves.
3. **Overtime applies to schedule edits only.** "Finish early" and "hand over" change the RotaFlow
   schedule, not payroll cards. Payroll cards are historical (October); the forecast works on the live
   week. Say this out loud in the demo.
4. **Salaried exempt staff are excluded** from the forecast and from reassignment targets; their rules
   differ (comp-off). Worth one honest slide line.
5. **Clash fixes are recommendations.** "Fix schedule" is recorded for the scheduling team; Dayflow does
   not rewrite payroll-period schedules. If time allows, connect it to RotaFlow's save-shift.

**Engineering**
6. **No accounts or password reset flow.** Accounts are seeded; add an admin "invite employee" screen and
   forced password change on first login before any real use.
7. **Demo auth only.** Session cookie plus CSRF is sound for a demo; add SSO and per-tenant isolation
   before production.
8. **Single SQLite database.** Fine for a hackathon, swap for Postgres behind the same `Database` class if
   it continues.
9. **Location privacy.** Store distance and status, not raw coordinates, after verification; add a
   retention period and a consent screen. The brief forbids surveillance data, so say that explicitly.
10. **Model quality is small-model quality.** The 1.7B model is graded on synthetic notes in four
    languages. A bigger open-weight model (verify its licence and acceptable-use terms) would raise the
    non-English score; the grounding checks make that a safe swap.
11. **Mobile.** The employee flows (check-in, one-tap answers) should be designed phone-first; the
    admin queue can stay desktop-first.
12. **Notifications.** Employees currently discover questions when they open the app. A push or email
    nudge is the obvious next step, and PR #8/#9 from the team already starts that backend.

## Rules to repeat in every prompt if Lovable drifts

- The product name is **Dayflow**. Never write WorkSync.
- The browser never computes money, hours, overtime or geofence results. It displays what the API returns.
- The AI proposes, the engine verifies, a person approves. Do not add buttons that skip approval.
- No new dependencies, no Supabase, no hard-coded demo data.
