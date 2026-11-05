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

Screens: attendance (GeoPulse), shifts (RotaFlow), breaks (ZenBreak), sync (SyncShield), tasks, leave, people,
reports, plus the Dayflow engine screens: resolution queue, questions for you, overtime, policy studio (with
what-if), pay explorer, audit ledger and scorecard.
