# Where Dayflow can still improve

Be upfront about these in the demo and Q&A. None of them blocks the demo.

**Product**
1. **The queue and the one-tap employee answer are the demo.** Polish those before anything else.
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
11. **Office timezone.** Punch dates and "late after 09:30" use UTC. Store the office timezone and derive the
    attendance day from it before real use; a 01:00 local punch can land on the previous UTC day.
12. **Approval is two steps.** Approving a resolution commits the correction and then marks the plan approved in a
    second transaction. If the second step failed, the plan would stay open although the correction is committed;
    merge both into one transaction.
13. **Mobile.** The employee flows (check-in, one-tap answers) should be designed phone-first; the
    admin queue can stay desktop-first.
14. **Notifications.** Employees currently discover questions when they open the app. A push or email
    nudge is the obvious next step, and PR #8/#9 from the team already starts that backend.
