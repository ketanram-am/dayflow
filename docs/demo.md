# Dayflow: ten-minute demo runbook

**simplified mock policy, not legal advice**

Synthetic data only. Start with a fresh `DAYFLOW_DB` path, `DAYFLOW_LLM_MODE=ollama`,
`DAYFLOW_LLM_MODEL=qwen3:1.7b` and `DAYFLOW_LLM_CACHE=evidence/llm-cache.json`, then turn AI
on from the Overview. The full spoken script is [narration-script.md](narration-script.md).

| Time | Show | Point to make |
|---|---|---|
| 0:00-1:00 | Overview | 155 exceptions; employees already explain them in notes; AI proposes, engine proves, human approves. |
| 1:00-1:45 | Policy studio: open DF-004, sign | Rules are signed by a person; nothing commits before. |
| 1:45-3:00 | Resolution queue: **Run agent** | Compliant fix per exception (meal breach is paid, never moved); engine checks every fix; three lanes. |
| 3:00-4:30 | Open Alex Rivera (e004-2026-10-05) | AI reads "I finished at 17:50"; code finds that sentence; engine re-checks. Optional: Rohan Blake shows a rejected AI guess. |
| 4:30-5:15 | **Approve all** in Ready | One click; each is re-verified and committed; the agent cannot approve. |
| 5:15-6:30 | As e004: Questions for you → **Yes**; as Avery: **Approve** | One-tap confirmation; verified commit with the employee's answer attached. |
| 6:30-7:00 | Needs judgment: Maya Chen (e001-2026-10-19) | Hostile note never reaches the AI. |
| 7:00-7:45 | Overview: next-week overtime card | Swaps priced by the engine; one case honestly has no safe swap. |
| 7:45-9:00 | Eval scorecard, Audit ledger | Note-dependent accuracy 32% → 93%; 98.7% overall; 0 invented times; chain intact. |
| 9:00-10:00 | Close | Limits: synthetic data, one small model, schedule/leave stay human. |

Accounts: `avery@dayflow.demo`, `taylor@dayflow.demo`, `e004@dayflow.demo` (Alex),
`e001@dayflow.demo` (Maya). Password `Dayflow-demo-2026!`.
