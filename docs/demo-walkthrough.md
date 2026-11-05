# Dayflow: full demo walkthrough (every feature, click by click)

This is the long version: every feature, in the order that tells the best story. Each chapter says
**where to click**, **what to say**, and **what proves it is real**. Chapters are tagged **CORE** (must be in
the video), **STRONG** (add if time allows) or **EXTRA** (skip first). The 10-minute cut is built from this.

---

## 0. Setup (before you record)

```bash
# terminal 1, repo root
export DAYFLOW_LLM_MODE=ollama DAYFLOW_LLM_MODEL=qwen3:1.7b
export DAYFLOW_LLM_CACHE=evidence/llm-cache.json DAYFLOW_DEMO_SWITCH=1
export DAYFLOW_DB=/tmp/dayflow-demo-$(date +%s).sqlite3
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
# terminal 2
cd web && npm ci && npm run dev          # open the URL Vite prints
```

- `$(date +%s)` gives a brand-new database every time, so every take starts identical (use this to retake).
- `DAYFLOW_DEMO_SWITCH=1` shows the **View as: Manager | Approver | Employee** toggle in the top bar. It is
  what lets you play three people from one browser window.
- Allow **location** for the site when the browser asks (needed for check-in).
- Sign in once: `avery@dayflow.demo`, password `Dayflow-demo-2026!`.

### The three people (top-bar toggle)

| Toggle | Who | Role in the story |
|---|---|---|
| **Manager** | Avery Quinn | Runs the agent, sets policy and office, manages shifts and leave |
| **Approver** | Taylor Reed | A second administrator. In the demo she approves, so the person who ran the agent is not the person who approves (a good habit; the system does not force it) |
| **Employee** | Alex Rivera (`e004`) | Checks in, requests leave, answers the agent's question |

### What data you are looking at (so nothing confuses you)

All of it is **synthetic**. There are two kinds of data:

1. **Payroll timecards**: 30 employees, 2 pay periods (Oct 5 and Oct 19, 2026), 60 timecards with 155 planted
   problems (missed punches, duplicates, skipped breaks, schedule clashes, overtime). The answers are labelled,
   so the scorecard can measure the agent. This feeds **Resolution Queue, Pay Explorer, Policy Studio, Audit
   Ledger, Scorecard**.
2. **Live workforce data** (generated relative to *today* when the database is created): 14 days of attendance
   history for most people, 3 weeks of weekday shifts, 5 leave requests (2 pending, 2 approved, 1 rejected),
   6 tasks, holidays, and a few people given a Saturday shift so the **Overtime** page has something to flag.
   This feeds **GeoPulse, ZenBreak, SyncShield, RotaFlow, LeaveSync, TaskForge, Overtime, People, Reports**.

The two sides share one backend, one login and one audit log.

### How to prove it is real (use these throughout)

- **Refusals are the proof.** A fake demo only says yes. Show it saying no: outside the geofence, a second
  check-in, overlapping leave, shift on a leave day, approving your own request, a note that tries to give orders.
- **Audit Ledger** records every action above (who, what, when, hash). Open it at the end of each chapter.
- **Refresh the page**: everything is still there (it is a database, not screen state).
- **Numbers have formulas**: Pay Explorer → click any pay line to see the formula and the policy clause.
- **Live API list**: `http://127.0.0.1:8000/docs` shows every endpoint the screens call.

---

## 1. Orientation (CORE, 40 s)

1. Sign in. You land on **Horizon**.
2. Point at the sidebar. Workspace: Horizon, GeoPulse, RotaFlow, ZenBreak, SyncShield, TaskForge, Questions for
   You, Pay Explorer, LeaveSync. Operations: Resolution Queue, Overtime, Policy Studio, Audit Ledger, Scorecard,
   People, Reports.
3. Point at the top-right toggle **View as**.

**Say:** "Dayflow turns messy timecards into correct pay. One backend, two halves: employees record their day, and
an agent fixes the exceptions. The rule everywhere: **the AI proposes, a pay engine proves it, a person approves.**"

**Horizon (administrator view)** shows Total Employees, Present Today, On Leave, Attendance Rate, Attendance
Trend, Workforce Heatmap, Department Distribution and Smart Alerts. Every number comes from the database.

---

## 2. GeoPulse: location-verified attendance (CORE, 2 min)

**Precondition:** an administrator must set the office location once, or nobody can check in.

1. Toggle **Manager**. Sidebar → **GeoPulse**.
2. The card shows "Office location not set — check-in is disabled." Press **Set office to my current location**.
   Toast: "Office set to your current location (± n m)."
   (If your laptop GPS is poor, open **Settings** from the avatar menu and set **Radius (m)** to `1000` and
   **Required GPS accuracy (m)** to `1000`, then **Save settings**.)
3. Toggle **Employee** (Alex). Sidebar → **GeoPulse**. If Alex already has a check-in, press **Demo: reset my day**
   (toast "Today's attendance was cleared").
4. Press **Check in**. The browser asks for location. Result: "Checked in", status pill **inside**, distance and
   accuracy shown, the map and "Today's Timeline" fill in.
5. **Prove the geofence is enforced on the server (the key moment):** toggle **Manager** → avatar menu →
   **Settings** → change **Latitude** by `0.01` → **Save settings**. Toggle **Employee**, press **Demo: reset my
   day**, press **Check in**. It is refused: "You are 1,1xx m from {office} (allowed r m)." Then restore the
   latitude in Settings.
6. Show the third state: with **Radius** at `100` and a poor GPS accuracy you see **Uncertain**.

**Say:** "The browser never decides whether you are in. It sends coordinates and accuracy; the server decides
inside, outside, **uncertain** or too inaccurate. If the GPS circle crosses the boundary we refuse to guess.
One check-in per day, enforced on the server."

**Proof:** `Recent Location Verifications` lists every attempt, including the refused ones. Audit Ledger shows
`attendance_check_in` and `office_settings_updated`.

---

## 3. ZenBreak: breaks and net working time (STRONG, 1 min)

1. As **Employee**, after checking in: GeoPulse card → **Start break**. Toast "Break started".
2. Sidebar → **ZenBreak**. Show **Break Control** (ring, "On Break", Break now), KPI tiles, Work-Rest Balance.
3. Press **End Break**. Toast "Welcome back". "Break History (Today)" now lists it.
4. Back on GeoPulse press **Check out**, confirm the dialog. "Day complete — checked out at hh:mm."

**Say:** "Net work time is calculated on the server from saved timestamps, not by a browser timer, so refreshing
the page cannot cheat it. Check-out closes any open break automatically."

**Proof:** refresh: the totals are identical. "Total Hours (Net)" excludes the break.

---

## 4. SyncShield: offline punches that do not get lost (STRONG, 1 min 15 s)

1. As **Employee**, press **Demo: reset my day**.
2. Chrome DevTools → **Network** tab → set throttling to **Offline**.
3. Press **Check in**. Toast: "You're offline. Punch saved and will sync when you reconnect."
   The SyncShield card shows the item "Pending sync".
4. Set the network back to **No throttling**. It syncs automatically: "1 punch(es) synced".
5. Sidebar → **SyncShield**: stat cards, **Smart Offline Queue**, **Sync History & Audit Trail** with the attempt.
6. Toggle **Manager** → **SyncShield** → **Conflict Resolution Centre** → **Scan records**. Toast "Attendance
   records scanned: n new conflict(s)". Use **Approve correction** or **Reject** on one.

**Say:** "The punch keeps its original timestamp and a unique ID. If the app retries, the server recognises the ID,
so you never get duplicate records. Delayed punches are only accepted within 12 hours."

**Proof:** the history row shows the real captured time; pressing **Sync Now** again says nothing new to sync.

---

## 5. RotaFlow: shifts and swaps that respect leave (STRONG, 1 min 30 s)

1. As **Manager** → **RotaFlow**. Show the weekly calendar and KPI tiles.
2. **Assign shifts** card: choose an employee, a date, times, **Save shift** → "Shift saved".
3. **Prove the rule:** first approve some leave for that person (chapter 6), then try to save a shift on the
   leave day. It is refused: "{name} has approved leave on {date}; the shift was not saved".
4. Toggle **Employee** → **RotaFlow** → in **Upcoming Shifts** press **Swap** on a shift, choose a colleague, give a
   reason, **Send request** ("Swap request sent").
5. Toggle **Approver** (or **Manager**) → **RotaFlow** → **Swap Requests**: press the green **Approve** icon. The
   shift moves to the colleague. If the request was "Anyone available" you must pick a colleague first.

**Say:** "The overlap and leave checks run on the server at save time, so a browser trick cannot bypass them."

**Proof:** try approving a swap whose target already has a shift that day: refused with the reason.

---

## 6. LeaveSync: balances, rules and a second pair of eyes (STRONG, 1 min 30 s)

1. As **Employee** → **LeaveSync**. Show **My Leave Balance** (Annual, Casual, Sick, Unpaid) and the calendar.
2. **New Leave Request**: type Annual, From/To two working days in the future, reason, **Submit Request** →
   "Leave request submitted". A **{n} working day(s)** chip shows weekends and holidays are excluded.
3. **Prove the rules:** submit an overlapping range → refused ("overlaps another pending or approved request").
   Ask for more days than the balance → "Only x annual day(s) remain; this request needs y".
4. Toggle **Manager** → **LeaveSync** → **Approval Center**. Press **Approve** (warnings may appear, such as
   "n scheduled shift(s) fall inside this leave and need cover"). Try **Reject** without a comment → "Add a
   rejection reason in the comment box".
5. Show **Leave Policy** (Save policy) and the holiday list.

**Say:** "Balance, overlap and staffing checks are enforced by the server. The approver can never approve their
own request."

**Proof:** colleagues see that someone is away but never **why** (a sick day stays private).

---

## 7. TaskForge (EXTRA, 30 s)

**TaskForge** → as Manager press **New Task**, fill Title, Assignee, Due date, **Create task** → "Task created".
Use the **Move task** dropdown to move it To Do → In Progress → Review → Completed (progress becomes 100).
As Employee, you see only your tasks and can change only their status.

---

## 8. Policy Studio: rules a person signs (CORE, 45 s)

1. As **Manager** → **Policy Studio**. The ruleset shows **Unsigned**.
2. Open a clause (for example **DF-004**) to show the source sentence and the rule mapped from it.
3. Tick **I reviewed every source sentence and its mapped rule**, press **Sign and activate** → "Signed and
   activated". Status becomes **Active · signed by Avery**.

**Say:** "The pay engine runs only on a ruleset a person signed. Every rule links to the sentence it came from.
Nothing in the agent can run until this is done."

**Proof:** Audit Ledger → `policy signed and activated`.

**What-if (STRONG, 40 s):** in the card **What if we changed a rule?** press the chip *What if overtime started
after 7 hours?* → **Replay**. Show "Understood: … 8 → 7 hours", the per-employee **Before / After / Change**
table and "Total change". Say: "It replays the real period under the new rule. Nothing is saved."

---

## 9. Resolution Queue: the agent (CORE, 3 min)

1. As **Manager** → **Resolution Queue**. Switch on **Use AI to read employee notes**. Press **Run agent**.
2. The progress bar fills ("Planning fixes… n / 60"); the counters fill. About 25 seconds with recorded answers.
3. Explain the lanes: **Ready to approve** (nobody's hours change), **Waiting on the employee** (the fix changes
   worked time, so the employee confirms), **Needs your judgment**.
4. Open **Alex Rivera · e004-2026-10-05** (*Waiting*). In the drawer: Plan (the clock-out proposed from the
   employee's note, with the quote), **Engine check → Verified** with before → after pay, **Agent steps**.
5. Optional: open a card whose steps show an AI answer rejected (the model proposed a time the note never stated;
   code threw it away).
6. Open a "Fix schedule" card: a clash between two scheduled shifts, with the engine-checked proposal.
7. Open **Maya Chen · e001-2026-10-19** (*Needs your judgment*): the banner "This note tried to give instructions
   to the system. It was not sent to the AI."

**Say:** "For every exception the agent picks a **compliant** fix. A skipped meal is paid as a premium, never
hidden by moving punches. The AI is used for one thing: reading the employee's own note for the real time. The
engine recomputes the whole pay period for every fix, so a bad proposal never reaches me."

**Proof:** each card shows pay **before → after** from the engine; the **Clears:** line lists the exception ids it
removed.

---

## 10. Approve with three people (CORE, 1 min 45 s)

1. Toggle **Approver** (Taylor). **Resolution Queue** → in *Ready to approve* press **Approve all**, confirm. Toast
   "n approved, 0 blocked".
2. Toggle **Employee**. The page jumps to **Questions for You**. Alex sees: "Your clock-out on Wednesday … Is that
   right?" with the quote "You wrote: …". Press **Yes, that's right** (or enter a different time and press **Use
   this time**). "Thanks! Your manager will approve it next."
3. Toggle **Approver** → **Resolution Queue**. Alex's card is now in *Ready to approve*. Open it → **Approve**.
   Toast "Approved and committed".
4. **Prove who is allowed to approve:** toggle **Employee** and open `/queue` in the address bar. It says
   "Administrators only. Ask a reviewer if you need this page." An employee can never approve. The agent has no
   approve button at all, and the server refuses approvals from the agent account.

**Say:** "Three people: the manager runs the agent, a second administrator approves, the employee confirms any change
to their own hours. The agent can author a plan but can never approve it."

**Proof:** Audit Ledger shows `agent run started`, `resolution approved` and `verified correction committed`,
each with a different actor.

---

## 11. Pay Explorer: every number has a derivation (CORE, 1 min)

1. As **Manager** → **Pay Explorer**. The **Timecards** table lists employee, period, status, total, open
   exceptions. Search a name, click a row.
2. Show **Shifts vs schedule** (a missing punch is marked "missing") and **Pay lines**. Click a line to expand the
   formula and sources, with the policy clause chip.
3. In **Ask about this paycheck** type "Why was I paid overtime?" → **Ask**. The answer shows its source
   (rules or model) and a notice.

**Say:** "Nothing is a black box. Each line says quantity × rate and cites the clause. The explainer may only use
numbers that exist in the engine's derivation; otherwise the engine's own explanation is shown."

---

## 12. Overtime (CORE, 1 min 30 s)

1. As **Manager** → **Overtime** → tab **This week (live)**.
2. Show **Potential saving**, **People flagged**, the weekly line, and a person card with the day-by-day bar.
3. Select the recommended option ("End … Sat shift at hh:mm instead of …"), press **Apply**, confirm. Toast
   "Applied and recorded in the audit ledger". It changes the RotaFlow schedule.
4. Tab **Next week (planned)**: swaps priced by the engine; **Send to scheduling** records a recommendation.

**Say:** "It adds the hours already punched to the shifts still scheduled, flags who will pass 40 hours, and offers
an option that can still stop it, priced by the engine."

**Proof:** **RotaFlow** shows the changed shift; Audit Ledger shows `overtime prevented`.

---

## 13. Scorecard and Audit Ledger (CORE, 1 min)

1. **Scorecard**: **Measured, not claimed**. Rules-only against the AI: note-dependent accuracy 32% → 89%, overall
   87% → 98%, invented times 0, fallbacks to rules, manager minutes manual 620 vs with agent 25. Then the
   **Detection** table (precision and recall 1.0 per family).
2. **Audit Ledger**: banner **The chain is intact**. Scroll the timeline; use the filter chips; open **Details**.

**Say:** "We measure instead of claim. The AI is graded against labelled answers on synthetic data; every action
is in a tamper-evident log."

**Be honest here (it earns trust):** synthetic data; one small open-weight model on one seed; the video replays a
recorded model run; schedule and leave changes remain recommendations for a person.

---

## 14. People and Reports (EXTRA, 30 s)

**People** (type in the top search box and press Enter): directory with department, status (Present / Late /
Checked Out / On Leave / Absent, decided on the server), role and active switch; **Records** opens an employee's
check-ins. **Reports** (open `/reports` in the address bar): date range, **Daily attendance**, **By employee**,
**Export CSV**.

---

## 15. Close (CORE, 20 s)

"Employees record their day, the agent fixes what's wrong, an engine proves it, and a person approves. **The AI
proposes. The engine verifies. A human approves.**"

---

## Cut list for the 10-minute video

| Chapter | Tag | Time |
|---|---|---|
| 1 Orientation | CORE | 0:40 |
| 2 GeoPulse (check in, refusal) | CORE | 2:00 |
| 8 Policy Studio (+ what-if) | CORE | 0:45 (+0:40) |
| 9 Resolution Queue | CORE | 3:00 |
| 10 Three-person approval | CORE | 1:45 |
| 11 Pay Explorer | CORE | 1:00 |
| 12 Overtime | CORE | 1:30 |
| 13 Scorecard + Audit | CORE | 1:00 |
| 15 Close | CORE | 0:20 |
| 3, 4, 5, 6 workforce modules | STRONG | 1:00 to 1:30 each |
| 7, 14 | EXTRA | 0:30 each |

The core chapters add up to about 12:20, so trim: drop the what-if, shorten chapters 2, 9 and 11, and show the
workforce modules (3 to 6) as a 60-second montage or skip them. Decide the final cut after you rehearse once.

## Retakes

- Restart the backend with a new `DAYFLOW_DB` for a perfectly clean take.
- Within a take, **Demo: reset my day** on GeoPulse lets you repeat check-in and check-out.
- If you get **Uncertain** or **Low accuracy** on a laptop, set Radius and Required accuracy to `1000` in Settings.
  That strictness is the feature, not a bug.
