# Dayflow web app

The Lovable-built web interface (GeoPulse, RotaFlow, ZenBreak, SyncShield, TaskForge, LeaveSync)
running on Dayflow's FastAPI backend. One backend, one database, one audit chain.

```bash
# terminal 1: backend (from the repo root, see the main README for setup)
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000

# terminal 2: this UI
cd web && npm ci && npm run dev      # open the URL Vite prints; /api is proxied to :8000
DAYFLOW_API=http://127.0.0.1:8020 npm run dev    # point the proxy at another backend port
```

Sign in with `avery@dayflow.demo` (administrator) or `e004@dayflow.demo` (employee); password
`Dayflow-demo-2026!`. Set the office location once in Settings (admin) before anyone can check in.

Not yet in this UI (the Dayflow screens still live in `../frontend`): resolution queue, policy studio,
pay explorer, overtime planner, what-if, audit ledger and eval scorecard.
