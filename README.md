# Dayflow

**A timecard resolution agent that proves every fix before payroll sees it.**

**simplified mock policy, not legal advice**

Every pay period, timecards arrive with missed punches, duplicate punches, missed meal
breaks, schedule clashes and overtime. Employees usually explain the problem in their own
words ("Forgot to clock out, left at 6:15 after closing"), and a manager reads every note
and fixes every card by hand.

Dayflow's agent does that work. It reads each timecard and the employee's note, plans a
**compliant** fix for every exception, has a deterministic pay engine **prove** the fix,
and routes the card to whoever acts next:

| Lane | Meaning | Who acts |
|---|---|---|
| **Ready to approve** | Fix checked by the engine; nobody's hours change (duplicates removed, meal premium paid, approved extra shift paid) | Manager, one click or "approve all" |
| **Waiting on employee** | The fix changes worked time, so the employee confirms the exact proposal, or gives the right time, in one tap | Employee, then manager |
| **Needs your judgment** | Outside what a timecard edit can fix (schedule clash, sick leave to record in HR) or the note looked like an instruction to the system | Manager |

**The AI proposes. The engine verifies. A different human approves.** The model never
computes pay, never writes records and never approves anything.

This is a local-first challenge demonstrator on synthetic data, not a payroll service,
legal compliance product or production identity system. No surveillance data
(screenshots, location, biometrics, keystrokes) is collected.

## Results on the labelled data

Measured with `python -m app.agent_eval --ai` against labelled answers for all 155 seeded
exceptions (`evidence/agent_scorecard.json`). AI run: **qwen3:1.7b**, an open-weight
Apache-2.0 model running locally through Ollama.

| Measure | Rules only | With AI |
|---|---:|---:|
| Answers that depend on the employee's note (28) | 32.1% | **89.3%** |
| …of which the note is in Spanish, French or Portuguese (10) | 0% | **70.0%** |
| All 155 exceptions resolved correctly | 87.3% | **98.0%** |
| Cards routed to the right lane | 96.7% | **98.3%** |
| Right clock time proposed on the first ask | 0 | **10** |
| Times invented or misread from a note | 0 | **0** |
| Hostile notes sent to a manager (model never called) | 2/2 | 2/2 |
| Plans rejected by the pay engine before anyone saw them | 0 | 0 |

When the model got something wrong (for example it tried to read "21:00" from a note that
never said it), code refused the answer and the card fell back to the rules plan: 5 such
fallbacks, 0 bad answers shown. About half of the notes that state a time or a story are in Spanish,
French or Portuguese ("Olvidé marcar la salida; salí a las 18:05"): rules cannot read them at all, and the
small model gets 7 of 10 right (Spanish 2/3, French 3/5, Portuguese 2/2). The time must still appear word
for word in a sentence of the note, in any language. Estimated manager time: about 620 minutes by hand vs 25
minutes reviewing agent plans (stated assumption: 4 minutes per exception, 0.5 per plan).
All data is synthetic; this is not real-world accuracy.

## How the agent works

1. **Detect.** The pay engine finds every exception (`backend/app/engine.py`), scored
   against independently written labels (precision and recall 1.0 on a held-out seed).
2. **Plan.** `backend/app/resolver.py` picks one compliant resolution per exception from a
   whitelist per exception type. Examples: a missed meal break is **paid as a premium, never
   "fixed" by moving punches** (that would be time-shaving); a duplicate punch is removed;
   a schedule clash goes to a manager because a timecard edit cannot fix a schedule.
3. **Read the note (AI).** Only two decisions depend on free text: what time a missing punch
   really was, and whether a shift with no punches was worked or a sick day.
   `backend/app/ai_planner.py` asks the model for that reading only. Code then finds the
   sentence in the note that states the time; if no sentence says it, the answer is
   rejected. Code writes every sentence the user sees.
4. **Prove.** The engine applies the fix in memory and recomputes pay. A fix that leaves the
   problem or creates a new one is rejected before a human sees it.
5. **Route and approve.** Plans land in lanes. Approval creates the correction, binds the
   employee's recorded confirmation, re-verifies the full pay period and commits it in an
   audited transaction. The agent account can author but never approve.

Guardrails: strict JSON schemas with one retry that tells the model exactly what failed;
rate-limit backoff; a per-input answer cache; a kill switch; AI off by default. Notes that
try to give instructions skip the model entirely. With AI off, the whole product still
works on the rules plan.

## Other features

- **Overtime forecast (this week, live).** Adds the hours already punched to the shifts still scheduled,
  flags people who will pass the weekly threshold, and offers "finish early" or "hand over" options priced
  by the engine. Applying one edits the schedule and writes the audit chain (`/api/wf/forecast`).
- **Schedule clash fixes.** A clashing schedule is no longer handed to a manager: the agent proposes moving
  it to where the work was actually punched (or to a free teammate), and the engine proves it.
- **Overtime prevention (next week).** Finds people scheduled over 40 hours and proposes
  giving the extra shift to a teammate with room and no clash. The engine prices both
  people before and after; the Overview shows the total saving.
- **What if we changed a rule?** Ask "What if overtime started after 7 hours?". The AI (or a
  rule parser when AI is off) picks the rule and value; the engine replays last period and
  shows the dollar impact per employee.
- **Explain my paycheck.** Employees ask in plain English; every number in the answer must
  exist in the engine's derivation, otherwise the engine's own explanation is shown.
- **Signed ruleset, derivations, disputes, audit chain.** Pay rules come from a policy a
  human signs; every earnings line shows its formula and clause; disputes never change pay
  silently; every action is hash-chained.

## Workforce modules (web interface)

The Lovable-built web interface lives in [web/](web/README.md) and runs on this same
backend: **GeoPulse** (geofenced check-in with Inside / Outside / Uncertain), **ZenBreak** (breaks and net
time from saved timestamps), **SyncShield** (offline queue, idempotent replay, conflict centre),
**RotaFlow** (shifts and swaps checked against approved leave), **LeaveSync** (balances, overlap and
staffing rules, maker-checker approval) and **TaskForge**. Rules are enforced in
`backend/app/workforce.py`, routes are under `/api/wf`, and every action lands in the hash-chained audit.

## Run it

Requirements: Python 3.11+, Node 22+, npm.

```bash
git clone https://github.com/ketanram-am/dayflow.git
cd dayflow
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m pip install --no-deps -e './backend[dev]'
npm ci --prefix frontend
npm run build --prefix frontend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. The first start creates a SQLite database with 30
employees, two pay periods, 60 timecards and 155 labelled exceptions. Sign the ruleset in
Policy studio, then open **Resolution queue** and click **Run agent**.

| Account | Role |
|---|---|
| `avery@dayflow.demo` | Reviewer |
| `taylor@dayflow.demo` | Second reviewer |
| `e001@dayflow.demo` … `e030@dayflow.demo` | Employees (e004 Alex Rivera is a good demo) |

Local demo password: `Dayflow-demo-2026!`. Do not expose demo accounts publicly.

### Turning on the AI (open-weight models)

Verify the selected model's licence and acceptable-use terms before use.

```bash
ollama pull qwen3:1.7b                      # Apache-2.0, ~1.4 GB, light on a laptop
export DAYFLOW_LLM_MODE=ollama DAYFLOW_LLM_MODEL=qwen3:1.7b
export DAYFLOW_LLM_CACHE=evidence/llm-cache.json   # reuse recorded answers; no model calls for them
```

Then sign in as a reviewer and press **Turn AI on** on the Overview. Any OpenAI-compatible
endpoint also works (`DAYFLOW_LLM_MODE=openai`, `DAYFLOW_LLM_BASE_URL`,
`DAYFLOW_LLM_API_KEY`). Only send synthetic data to a provider you trust.

## Reproduce the evidence

```bash
.venv/bin/ruff check backend
.venv/bin/pytest backend/tests -q
cd backend && ../.venv/bin/python -m app.evals && ../.venv/bin/python -m app.agent_eval
# with a model configured:  ../.venv/bin/python -m app.agent_eval --ai
cd ../frontend && npx playwright install chromium && npm run test:e2e
```

## Architecture

```text
React + TypeScript (queue, lanes, drawer, derivations)
        | cookie session + CSRF
FastAPI ── /api/agent/runs, /api/resolutions/*, /api/planner, /api/policies/what-if ...
        |
        ├─ resolver.py     compliant plan per exception, lanes          (no AI)
        ├─ ai_planner.py   reads notes; code grounds quotes and times    (AI, optional)
        ├─ engine.py       pure Decimal pay engine, detectors, traces    (no AI)
        ├─ desk.py         runs, approvals, employee answers             (no AI)
        ├─ services.py     proposals, verification, atomic commit
        └─ db.py           SQLite, immutable plans/answers/approvals, hash-chained audit
```

| Location | Responsibility |
|---|---|
| `backend/app/engine.py` | Minute-based Decimal pay, detectors, derivation traces |
| `backend/app/resolver.py` | Allowed resolutions per exception code, simulation, lanes |
| `backend/app/ai_planner.py` | Note reading with grounded quotes and times |
| `backend/app/desk.py` | Agent runs, approve / approve all, employee answers |
| `backend/app/agent_eval.py` | Agent vs rules-only scorecard against labelled answers |
| `backend/app/planner.py` | Next-week overtime prevention |
| `backend/app/data.py` | Synthetic data, detector labels and expected resolutions |
| `frontend/src/Queue.tsx` | Resolution queue, plan drawer, employee questions |

### Payroll decisions

The fictional policy is [docs/mock-policy.md](docs/mock-policy.md): eleven clauses and 63
worked examples. The engine handles hourly non-exempt, salaried non-exempt and salaried
exempt employees: daily/weekly non-stacking overtime, double time, regular rate with
differentials, meal premiums, leave and exempt comp-off. Unknown earnings are `null`,
never zero. The UI only displays engine numbers.

## What is and is not new

Exception detection and approval routing already exist in workforce systems (Dayforce,
UKG and others). Dayflow's contribution is the resolution agent with proof: reading the
employee's own explanation into an exact, grounded correction, proving it with a
deterministic engine before anyone sees it, routing it to the right person, and
publishing a measured comparison against a rules-only baseline.

All code here is original. No GPL/AGPL code was copied. Direct dependencies: FastAPI,
Pydantic, HTTPX, Uvicorn, React, Vite, TypeScript, motion, Lucide.

## Deliverables

- [Five-slide presentation](docs/deck.html)
- [Demo runbook](docs/demo.md) and [word-for-word narration](docs/narration-script.md)
- **Demo video: pending recording.** Add the URL here before submission.

## Limits

Synthetic data and labels written by us; a 1.7B-parameter model tested on one seed; times
are matched only when the note states them; schedule and leave changes are out of scope
for a timecard edit; demo authentication, single workspace SQLite, and an audit chain that
is tamper-evident, not tamper-proof against a database administrator.
