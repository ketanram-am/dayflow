# Frontend notes

The web app is in `web/` and has every screen: attendance, shifts, breaks, sync, tasks, leave, people,
reports and the Dayflow engine screens (resolution queue, questions for you, overtime, policy studio with
what-if, pay explorer, audit ledger, scorecard). Product name everywhere: **Dayflow**.

## Run it

```bash
# repo root, once
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock
.venv/bin/python -m pip install --no-deps -e './backend[dev]'

# terminal 1: backend (a new DAYFLOW_DB path gives a clean demo)
DAYFLOW_DB=/tmp/dayflow.sqlite3 .venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000

# terminal 2: web app
cd web && npm ci && npm run dev          # open the URL Vite prints; /api is proxied to :8000
```

Another backend port: `DAYFLOW_API=http://127.0.0.1:8001 npm run dev`.

Sign in at `/login`: `avery@dayflow.demo` (administrator) or `e004@dayflow.demo` (employee, any of `e001` to
`e030`). Password `Dayflow-demo-2026!`. In Settings an administrator sets the office location once; until then
nobody can check in. For the agent demo: Policy studio, sign the ruleset, then Resolution queue, Run agent.

## Rules for UI code

- All data goes through `web/src/lib/api.ts` (`auth`, `wf.*`) and `web/src/lib/dayflow.ts` (engine endpoints).
  The TypeScript types are the contract. Live endpoint list: `http://127.0.0.1:8000/docs`.
- The browser never calculates money, hours, overtime or location results; it formats strings the API sends.
- AI proposes, the engine verifies, a person approves. No button may skip an approval.
- Errors arrive as `ApiError.message`; show them as toasts. `reviewer` means administrator.
- Keep the look: tokens in `src/styles.css`, components in `src/components/ui`.

## Checks before every push

```bash
cd web && npx tsc --noEmit && npx vitest run && npx vite build
```

CI (`.github/workflows/quality.yml`) runs these plus the backend suite and the old UI's browser tests.
