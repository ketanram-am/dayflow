# Frontend handoff

Everything the web app needs is already built in the backend. This page is the starting point for
whoever builds the remaining screens. Product name everywhere: **Dayflow**.

## Run it (10 minutes)

```bash
# repo root, once
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m pip install --no-deps -e './backend[dev]'

# terminal 1: backend (a fresh DAYFLOW_DB gives you a clean demo)
DAYFLOW_DB=/tmp/dayflow.sqlite3 .venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000

# terminal 2: web app
cd web && npm ci && npm run dev          # open the URL Vite prints; /api is proxied to :8000
```

Sign in at `/login`: `avery@dayflow.demo` (administrator) or `e004@dayflow.demo` (employee, any of
`e001` to `e030`). Password `Dayflow-demo-2026!`. Demo data is synthetic. In Settings an administrator
sets the office location once; until then nobody can check in.

To see the finished Dayflow engine screens that exist today, open the backend directly at
`http://127.0.0.1:8000` (the old `frontend/` build). It shows what each new page should do.

## What exists and what is missing

| Area | Backend | Web app (`web/`) |
|---|---|---|
| GeoPulse, ZenBreak, SyncShield, RotaFlow, LeaveSync, TaskForge, people, reports | done (`/api/wf/*`) | done |
| Resolution queue, plan drawer, "Questions for you" | done (`/api/agent/*`, `/api/resolutions/*`) | **missing** |
| Overtime forecast (live week) and next-week planner | done (`/api/wf/forecast`, `/api/planner`) | **missing** |
| Policy studio, what-if | done (`/api/policies*`) | **missing** |
| Pay explorer and paycheck explainer | done (`/api/cards*`) | **missing** |
| Audit ledger, eval scorecard | done (`/api/audit`, `/api/scorecard`) | **missing** |
| Notifications bell | done (`/api/wf/notifications`) | **missing** (bell shows counts only) |

The five ready-to-paste Lovable prompts for the missing screens are in
[lovable-prompt.md](lovable-prompt.md), with the improvement list.

## Rules for the UI code

- All data goes through `src/lib/api.ts` (`auth`, `wf.*`) and `src/lib/dayflow.ts` (engine endpoints).
  Do not add Supabase or direct `fetch` calls, and do not invent response fields; the types are the contract.
  The live schema is also at `http://127.0.0.1:8000/openapi.json` (inputs are typed; read the TS types for outputs).
- The browser never calculates money, hours, overtime or geofence results; it formats strings the API sends.
- AI proposes, the engine verifies, a person approves. No button may skip an approval.
- Errors arrive as `ApiError.message`; show them as toasts. Roles: `reviewer` is the administrator.
- Keep the existing look (tokens in `src/styles.css`, components in `src/components/ui`). Name is **Dayflow**.

## Checks before every push

```bash
cd web && npx tsc --noEmit && npx vitest run && npx vite build
```

The CI workflow (`.github/workflows/quality.yml`) runs these plus the backend suite.
