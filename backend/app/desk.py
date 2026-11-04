"""Resolution desk: run the agent over the queue, approve plans, collect employee answers.

The agent (system user `dayflow-agent`) only writes plans. A proposal is created at approval
time from the stored plan, so the verifier always checks the current records, and the approver
is never the author.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import threading

from .db import audit, now, uid
from .domain import Correction, canonical, fingerprint
from .resolver import PlanItem, build_correction, headline, plan_card, simulate
from .services import AGENT_ID, fail, reviewer


def _row(row):
    plan = json.loads(row["plan"])
    return {"id": row["id"], "run_id": row["run_id"], "card_id": row["card_id"],
            "card_revision": row["card_revision"], "lane": row["lane"], "state": row["state"],
            "proposal_id": row["proposal_id"], "parent_id": row["parent_id"],
            "created_at": row["created_at"], **plan}


class Desk:
    def __init__(self, svc, planner=None):
        self.svc = svc
        self.planner = planner  # optional AI planner: (card, pay, items) -> (items|None, trace)

    # ------------------------------------------------------------------ runs
    def start_run(self, user, ai=None, background=True, model=None):
        reviewer(user)
        with self.svc.db.transaction() as cx:
            policy, _ = self.svc.policy(cx, require_signed=True)
            cards = [c for c in self.svc.all_cards(cx) if c.period_status == "open"]
            if cx.execute("SELECT 1 FROM agent_runs WHERE status='running'").fetchone():
                fail("An agent run is already in progress")
            run_id = uid("run-")
            cx.execute("INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?)", (
                run_id, user["id"], "ai" if ai else "rules", model, "running", len(cards), 0,
                now(), None))
            cx.execute("UPDATE resolutions SET state='superseded' WHERE state='open'")
            audit(cx, user["id"], "agent_run_started", run_id,
                  {"mode": "ai" if ai else "rules", "model": model, "cards": len(cards)})
        job = lambda: self._run(run_id, cards, policy, ai, user)  # noqa: E731
        if background:
            threading.Thread(target=job, daemon=True).start()
        else:
            job()
        return self.run(run_id)

    def _run(self, run_id, cards, policy, ai, user):
        by_employee = {}
        for card in cards:
            by_employee.setdefault(card.employee.id, []).append(card)

        def one(card):
            mine = by_employee[card.employee.id]
            pay = self.svc.pay(card, mine, policy["document"])
            plan = plan_card(self.svc, card, mine, policy["document"], pay, ai=ai)
            with self.svc.db.transaction() as cx:
                cx.execute("INSERT INTO resolutions VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                    uid("res-"), run_id, card.id, card.revision, canonical(plan),
                    fingerprint(plan), plan["lane"], "open", None, None, now()))
                cx.execute("UPDATE agent_runs SET done=done+1 WHERE id=?", (run_id,))

        try:
            with ThreadPoolExecutor(max_workers=4 if ai else 1) as pool:
                list(pool.map(one, cards))
            status = "finished"
        except Exception:  # noqa: BLE001 - a failed run must be visible, never silent
            status = "failed"
        with self.svc.db.transaction() as cx:
            cx.execute("UPDATE agent_runs SET status=?, finished_at=? WHERE id=?",
                       (status, now(), run_id))
            audit(cx, user["id"], "agent_run_finished", run_id, {"status": status})

    def run(self, run_id=None):
        with self.svc.db.connect() as cx:
            row = cx.execute(
                "SELECT * FROM agent_runs WHERE id=?" if run_id else
                "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 1",
                (run_id,) if run_id else ()).fetchone()
            if not row:
                return None
            lanes = {r["lane"]: r["n"] for r in cx.execute(
                "SELECT lane, COUNT(*) n FROM resolutions WHERE run_id=? AND state='open' "
                "GROUP BY lane", (row["id"],))}
            approved = cx.execute("SELECT COUNT(*) FROM resolutions WHERE run_id=? AND "
                                  "state='approved'", (row["id"],)).fetchone()[0]
        return {**dict(row), "lanes": lanes, "approved": approved}

    # ------------------------------------------------------------- listings
    def resolutions(self, user):
        latest = self.run()
        if not latest:
            return {"run": None, "items": []}
        with self.svc.db.connect() as cx:
            rows = cx.execute(
                "SELECT * FROM resolutions WHERE run_id=? AND state!='superseded' "
                "ORDER BY created_at", (latest["id"],)).fetchall()
        items = [_row(r) for r in rows]
        if user["role"] == "employee":
            items = [i for i in items if i["employee_id"] == user["employee_id"]
                     and i["lane"] == "waiting" and i["state"] == "open"]
        return {"run": latest, "items": items}

    def get(self, cx, resolution_id):
        row = cx.execute("SELECT * FROM resolutions WHERE id=?", (resolution_id,)).fetchone()
        if not row:
            fail("Resolution not found", 404)
        return row

    # ------------------------------------------------------------- answers
    def answer(self, resolution_id, user, reply, hhmm=None):
        """Subject employee confirms (yes), gives the right time (correct + time), or says no."""
        if reply == "correct" and not hhmm:
            fail("Give the correct time as HH:MM", 422)
        with self.svc.db.connect() as cx:
            row = self.get(cx, resolution_id)
            card = self.svc.card(cx, row["card_id"], user)
            policy, _ = self.svc.policy(cx, require_signed=True)
            cards = self.svc.all_cards(cx, card.employee.id)
        if user["employee_id"] != card.employee.id:
            fail("Only the employee on this timecard can answer", 403)
        if row["state"] != "open" or row["lane"] != "waiting":
            fail("This question is no longer open")
        plan = json.loads(row["plan"])
        items = [PlanItem.model_validate(i) for i in plan["items"]]
        if reply == "no" and hhmm is None:
            new_items, lane_override = items, "judgment"
        elif hhmm is not None:
            new_items = [i.model_copy(update={"time": hhmm, "source": "note"})
                         if i.kind == "fill_punch" else i for i in items]
            lane_override = None
        else:
            new_items = [i.model_copy(update={"kind": "add_shift"}) if i.kind == "ask_employee"
                         else i for i in items]
            lane_override = None
        correction = build_correction(card, new_items)
        sim = simulate(self.svc, card, cards, policy["document"], correction)
        lane = lane_override or ("judgment" if not sim["ok"] else "ready")
        new_plan = {**plan, "items": [i.model_dump() for i in new_items],
                    "correction": correction.model_dump(mode="json") if correction else None,
                    "simulation": sim, "lane": lane,
                    "headline": "Employee said no. A manager should decide." if reply == "no"
                    and hhmm is None else headline(new_items, False, sim),
                    "trace": plan["trace"] + [{"step": "employee", "reply": reply, "time": hhmm}]}
        digest = fingerprint(new_plan)
        new_id = uid("res-")
        with self.svc.db.transaction() as cx:
            cx.execute("UPDATE resolutions SET state='superseded' WHERE id=?", (resolution_id,))
            cx.execute("INSERT INTO resolutions VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                new_id, row["run_id"], row["card_id"], card.revision, canonical(new_plan), digest,
                lane, "open", None, resolution_id, now()))
            answer_id = uid("ans-")
            cx.execute("INSERT INTO resolution_answers VALUES(?,?,?,?,?,?)", (
                answer_id, new_id, user["id"], canonical({"reply": reply, "time": hhmm}),
                digest, now()))
            audit(cx, user["id"], "employee_answered", new_id,
                  {"reply": reply, "time": hhmm, "lane": lane, "previous": resolution_id})
        with self.svc.db.connect() as cx:
            return _row(self.get(cx, new_id))

    # ------------------------------------------------------------ decisions
    def approve(self, resolution_id, user):
        """Human approval: create the proposal from the plan, attest, verify, commit."""
        reviewer(user)
        if user["id"] == AGENT_ID:
            fail("The agent can propose but never approve", 403)
        with self.svc.db.connect() as cx:
            row = self.get(cx, resolution_id)
            card = self.svc.card(cx, row["card_id"], user)
            answer = cx.execute("SELECT * FROM resolution_answers WHERE resolution_id=? AND "
                                "plan_hash=?", (resolution_id, row["plan_hash"])).fetchone()
        if row["state"] != "open":
            fail("This plan is already decided")
        if row["lane"] != "ready":
            fail("Only plans in the ready lane can be approved")
        if card.revision != row["card_revision"]:
            fail("The timecard changed after the agent planned it; run the agent again")
        plan = json.loads(row["plan"])
        proposal_id, outcome = None, {"verified": True, "failures": []}
        if plan["correction"]:
            agent = self.svc.user(AGENT_ID)
            proposal = self.svc.propose(card.id, Correction.model_validate(plan["correction"]),
                                        card.revision, agent)
            proposal_id = proposal["id"]
            if answer:
                self.svc.attest_recorded_answer(proposal_id, self.svc.user(answer["actor"]),
                                                answer["id"])
            self.svc.attest(proposal_id, "manager_attestation",
                            "Approved the agent plan after reviewing its evidence.", user)
            proof = self.svc.verify(proposal_id, user)
            outcome = {"verified": proof["verified"], "failures": proof["failures"]}
            if not proof["verified"]:
                with self.svc.db.transaction() as cx:
                    cx.execute("UPDATE resolutions SET lane='judgment', proposal_id=? WHERE id=?",
                               (proposal_id, resolution_id))
                    audit(cx, user["id"], "resolution_blocked", resolution_id,
                          {"failures": proof["failures"]})
                return {"status": "blocked", **outcome, "proposal_id": proposal_id}
            self.svc.approve(proposal_id, proof["hash"], user)
        with self.svc.db.transaction() as cx:
            cx.execute("UPDATE resolutions SET state='approved', proposal_id=? WHERE id=?",
                       (proposal_id, resolution_id))
            audit(cx, user["id"], "resolution_approved", resolution_id, {
                "card_id": card.id, "proposal_id": proposal_id,
                "kinds": sorted({i["kind"] for i in plan["items"]}),
            })
        return {"status": "approved", **outcome, "proposal_id": proposal_id}

    def approve_ready(self, user):
        reviewer(user)
        latest = self.run()
        with self.svc.db.connect() as cx:
            ids = [r["id"] for r in cx.execute(
                "SELECT id FROM resolutions WHERE run_id=? AND state='open' AND lane='ready' "
                "ORDER BY created_at", (latest["id"],))] if latest else []
        results = {"approved": 0, "blocked": 0, "errors": []}
        for identity in ids:
            try:
                outcome = self.approve(identity, user)
                results["approved" if outcome["status"] == "approved" else "blocked"] += 1
            except Exception as exc:  # noqa: BLE001 - report per plan, keep going
                results["errors"].append({"id": identity, "detail": getattr(exc, "detail", str(exc))})
        return results

    def reject(self, resolution_id, reason, user):
        reviewer(user)
        with self.svc.db.transaction() as cx:
            row = self.get(cx, resolution_id)
            if row["state"] != "open":
                fail("This plan is already decided")
            cx.execute("UPDATE resolutions SET state='rejected' WHERE id=?", (resolution_id,))
            audit(cx, user["id"], "resolution_rejected", resolution_id, {"reason": reason})
        return {"status": "rejected"}

