<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture (merged with Dayflow)

- The UI (this folder) talks only to the Dayflow FastAPI backend in `../backend` through `src/lib/api.ts`. There is no Supabase client, database or hosted-model call in this app.
- Auth is Dayflow's cookie session plus a CSRF token. Route guards live in `src/lib/session.ts`; `/login` is the only public page. Roles: reviewer = admin, employee.
- Every rule is enforced on the server in `backend/app/workforce.py`: the geofence (`classify`: inside / outside / uncertain / low_accuracy / unconfigured), idempotent punches by event id with a 12-hour replay window, break and net-time maths from saved timestamps, leave balance / overlap / staffing checks, shift conflicts with approved leave, swap approval, and the task field guard. Do not re-implement these in the browser.
- Offline punches (SyncShield) queue in IndexedDB (`src/lib/attendance.ts`), carry the signed-in user id, and replay through `/api/wf/punch` with their original timestamp.
- The AI assistant (`/api/wf/assistant`) computes facts in code. The optional open-weight model only words an answer, and every number must appear in the facts; with the model off the rule-based findings are shown.
- Add new screens under `src/routes/_authenticated/`, new endpoints in `backend/app/workforce_api.py`, and a typed wrapper in `src/lib/api.ts`.
