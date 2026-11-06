# Dayflow

**A timecard resolution agent that proves every fix before payroll sees it.**

**simplified mock policy, not legal advice**

> **AI Innovation Challenge entry, use case 5: Time & Attendance.** A timecard exception resolution agent
> that detects missed punches, overtime risks, schedule conflicts and policy breaches, then proposes
> compliant corrections.

| Deliverable | Where |
|---|---|
| **Demo video (10 min)** | [Watch on Google Drive](https://drive.google.com/file/d/1ZUyggTfgtVX3SJ1MmCKhniDZ1v1T3zFo/view?usp=sharing) |
| **Five-slide final presentation** | [docs/Dayflow_Final_Presentation.pptx](docs/Dayflow_Final_Presentation.pptx) |
| Source, setup and run instructions | This README ([Run it](#run-it)) |
| Safety, testing and evaluation evidence | [Results](#results-on-the-labelled-data), [Reproduce the evidence](#reproduce-the-evidence), [CI](.github/workflows/quality.yml) |
| API contract (OpenAPI) | Run the backend, then open `/docs` (and `/openapi.json`) |

## The problem and the user

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

## User journey (what the demo video shows)

1. **Reviewer (manager)** signs the pay ruleset in Policy Studio, then opens **Resolution Queue** and clicks **Run agent**.
   Every exception on 60 timecards gets a compliant, engine-verified plan in one of three lanes.
2. **Employee (Alex Rivera)** sees "Questions for You": the agent read "I finished at 17:50" in Alex's own note and
   asks one tap, **Yes, that's right**.
3. **Approver (a different person)** approves the verified fix; the commit, the employee's answer and the agent's proof
   land in the hash-chained **Audit Ledger**. The agent can author but never approve.
4. **Also shown:** this-week **Overtime** forecast with priced "finish early" / "hand over" options, **Pay Explorer**
   (explain my paycheck), **What-if** on a rule, and the workforce modules below (geofenced check-in, offline sync,
   rota swaps, leave, tasks) running on the same backend and audit chain.

## Harness engineering (how the AI is governed)

| Judging area | What Dayflow does | Where |
|---|---|---|
| Structured contracts | Strict JSON schemas (Pydantic) for every model call; typed API; OpenAPI at `/docs` | `backend/app/ai_planner.py`, `backend/app/agent.py` |
| Validation and guardrails | One retry that names what failed; answer must quote a sentence of the note that states the time; the pay engine re-computes the fix and rejects any that leaves or creates a problem | `ai_planner.py`, `resolver.py`, `engine.py` |
| Prompt-injection defence | Notes that try to give orders skip the model entirely and go to a manager | `agent.py` (`has_instructions`) |
| Fallback design | Provider down, rate limited, key rejected or bad output: the card falls back to the rules plan; AI is off by default; runtime kill switch | `agent.py`, `/api/llm` |
| Human oversight | Maker-checker: the agent account cannot approve; the employee confirms any change to worked time; a different human approves | `desk.py`, `services.py` |
| Traceability | Every plan, answer and approval is immutable and hash-chained; each plan shows the model attempts and engine checks | `db.py`, Audit Ledger |
| Grounding | Pay figures come only from the deterministic engine; the model reads free text and never computes money | `engine.py` |
| Open-weight model | `qwen3` (Apache-2.0) through Ollama, local-first; any OpenAI-compatible endpoint also works. Verify the licence of any model you swap in | `agent.py` (`LICENCES`) |
| Testing | Backend unit, golden, integration and API tests; labelled agent evaluation; web type-check, unit tests and build; browser end-to-end tests; all in CI | `backend/tests`, `web`, `frontend/tests` |

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

The web interface lives in [web/](web/README.md) and runs on this same
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

# terminal 1: backend (a new DAYFLOW_DB path gives a clean demo database)
DAYFLOW_DB=/tmp/dayflow.sqlite3 DAYFLOW_DEMO_SWITCH=1 \
  .venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000

# terminal 2: web app
cd web && npm ci && npm run dev      # open the URL Vite prints; /api is proxied to :8000
```

The first start creates a SQLite database with 30 employees, two pay periods, 60 timecards
and 155 labelled exceptions, plus a believable "today" (check-ins, breaks, leave, two pending shift swaps).
Then: **Policy Studio** → sign the ruleset → **Resolution Queue** → **Run agent**. With
`DAYFLOW_DEMO_SWITCH=1` a **View as** toggle (Manager / Approver / Employee) in the top bar lets one person
play all three roles; leave it off for normal use. Another backend port: `DAYFLOW_API=http://127.0.0.1:8001 npm run dev`.

The engine-only screens in `frontend/` (served by the backend at `/` after `npm ci && npm run build --prefix frontend`)
are kept for the browser end-to-end tests in CI.

| Account | Role |
|---|---|
| `avery@dayflow.demo` | Reviewer |
| `taylor@dayflow.demo` | Second reviewer |
| `e001@dayflow.demo` … `e030@dayflow.demo` | Employees (e004 Alex Rivera is a good demo) |

Local demo password: `Dayflow-demo-2026!`. Do not expose demo accounts publicly.

### Turning on the AI (open-weight models)

Verify the selected model's licence and acceptable-use terms before use.

```bash
ollama pull qwen3:8b                        # Apache-2.0, ~5 GB; used for the demo video
# qwen3:1.7b (~1.4 GB) also works and produced the recorded scorecard above, but reads notes less well
export DAYFLOW_LLM_MODE=ollama DAYFLOW_LLM_MODEL=qwen3:8b
export DAYFLOW_LLM_CACHE=evidence/llm-cache.json   # reuse recorded answers; no model calls for them
```

Then sign in as a reviewer and switch on **Use AI to read employee notes** in the Resolution Queue before **Run agent**. Any OpenAI-compatible
endpoint also works (`DAYFLOW_LLM_MODE=openai`, `DAYFLOW_LLM_BASE_URL`,
`DAYFLOW_LLM_API_KEY`). Only send synthetic data to a provider you trust.

## Reproduce the evidence

```bash
.venv/bin/ruff check backend
.venv/bin/pytest backend/tests -q
cd backend && ../.venv/bin/python -m app.evals && ../.venv/bin/python -m app.agent_eval
# with a model configured:  ../.venv/bin/python -m app.agent_eval --ai
cd ../web && npx tsc --noEmit && npx vitest run && npx vite build
cd ../frontend && npx playwright install chromium && npm run test:e2e
```

## Architecture

```text
web/        Dayflow web app (React + TanStack): attendance, shifts, leave, tasks, queue, policy, pay, audit
frontend/   Engine-only screens kept for the browser end-to-end tests in CI
        | cookie session + CSRF
FastAPI ── /api/agent/*, /api/resolutions/*, /api/planner, /api/policies/*, /api/wf/*
        |
        ├─ resolver.py     compliant plan per exception, lanes             (no AI)
        ├─ reassign.py     proves a fix for schedule clashes                (no AI)
        ├─ ai_planner.py   reads notes in 4 languages; code grounds them    (AI, optional)
        ├─ engine.py       pure Decimal pay engine, detectors, traces       (no AI)
        ├─ desk.py         runs, approvals, employee answers                (no AI)
        ├─ workforce.py    geofenced punches, breaks, sync, shifts, leave, tasks
        ├─ forecast.py     mid-week overtime forecast and one-click apply
        ├─ notify.py       in-app notifications, optional email
        ├─ services.py     proposals, verification, atomic commit
        └─ db.py           SQLite, immutable plans/answers/approvals, hash-chained audit
```

### Payroll decisions

The fictional policy is [docs/mock-policy.md](docs/mock-policy.md): eleven clauses and 63
worked examples. The engine handles hourly non-exempt, salaried non-exempt and salaried
exempt employees: daily/weekly non-stacking overtime, double time, regular rate with
differentials, meal premiums, leave and exempt comp-off. Unknown earnings are `null`,
never zero. The UI only displays engine numbers.

## What is new

Exception detection and approval routing already exist in workforce systems; Dayflow's contribution is the resolution agent with proof: grounded reading of the employee's own explanation, deterministic verification before anyone sees it, and a measured comparison against a rules-only baseline. All code is original; no GPL/AGPL code was copied.

## Team

| Contributor | Work |
|---|---|
| [Ketan Ram Amara](https://github.com/ketanram-am) | Pay engine, resolution agent, grounded AI, backend, workforce modules, evaluation, integration |
| [Harshitha S](https://github.com/harshitha792) | Web app design and front end: all screens, including the resolution queue, overtime, policy, pay, audit and scorecard |
| [Mohammed Raqheebuddin](https://github.com/raqheeb) | Twelve detection edge cases, aggregate metrics, provider error tests |
| [Praveen Raj S](https://github.com/Praveenraj2206) | Approval notifications |

## More documents

[Demo runbook](docs/demo.md) · [Feature walkthrough](docs/demo-walkthrough.md) · [Narration script](docs/narration-script.md) · [Mock pay policy](docs/mock-policy.md) · [Future improvements](docs/improvements.md) · [Web app notes](web/README.md)

## Limits

Synthetic data and labels written by us; a 1.7B-parameter model tested on one seed; times
are matched only when the note states them; schedule and leave changes are out of scope
for a timecard edit; demo authentication, single workspace SQLite, and an audit chain that
is tamper-evident, not tamper-proof against a database administrator.
