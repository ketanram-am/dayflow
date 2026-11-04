# Dayflow: ten-minute demo runbook

**simplified mock policy, not legal advice**

Use synthetic data only. Build the frontend, run the evals, and start the backend
against a fresh `DAYFLOW_DB` path before recording. Verify the video capture tool
is recording; this runbook is not itself a recording.

| Time | Show | Explain |
|---|---|---|
| 0:00-1:00 | Problem and stakes | Payroll errors start as timecard errors. Existing tools detect exceptions; ours makes every correction provable. Say the mock-policy disclaimer. |
| 1:00-2:30 | Policy studio: show a clause behind a rule, then sign as Avery | Every number links to its source sentence. Show the sign-off and the content hash: nothing can be verified or committed until a human signs. |
| 2:30-4:30 | Exception desk, Maya (Oct 19): draft correction, then *Propose an unsafe fix* | The engine shows full-period before/after. The unsafe overlapping fix is rejected by the verifier with the exact reason. Then `e001` confirms and Taylor approves the safe fix. |
| 4:30-5:30 | AI summary tab on Maya's card: *Explain this timecard* | Her seeded note tries to give the AI orders. The app skips the AI, shows "Needs a person", and still lists the rules engine's findings. |
| 5:30-7:00 | Sign in as `e001`: Pay derivation, *Explain my paycheck* | Ask "Why is my overtime pay this amount?" Wording from the model; numbers checked against the trace. Toggle AI off to show the engine-only explanation. |
| 7:00-8:30 | Policy studio: *What if we changed a rule?* ("overtime after 7 hours") | The AI picks the rule and value; the engine replays last period and shows the dollar impact per employee. Draft only; saving needs a human sign-off. |
| 8:30-9:30 | Audit ledger and Eval scorecard | Hash chain, zero unverified commits, injection and invented-number gates, exact denominators. Real-model evaluation is not run. |
| 9:30-10:00 | Close | Three employee classes; no surveillance; no net pay or legal guarantee. "LLM proposes. Engine verifies. Human approves." |

Accounts: `avery@dayflow.demo`, `taylor@dayflow.demo`, `e001@dayflow.demo`.
Default local password: `Dayflow-demo-2026!`.

For a benign no-LLM segment, select a card with an ordinary employee note and run
investigation. Show the explicitly labelled offline evidence brief, not an
invented assistant response. A live-provider segment is optional and requires
genuine configuration and rehearsal. Neither local patterns nor stub tests
establish general model robustness.

Use `docs/deck.html` as the five-slide companion. Upload the real recording and
replace the pending-video notice in the README with its actual URL before submission.
