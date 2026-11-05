"""Module assistant for the workforce screens (replaces the old hosted-model server function).

Facts are computed from the database by code. The optional open-weight model only words an
answer to a question, and every number in that answer must appear in the facts, otherwise the
deterministic insights are shown instead. With the model off the screens still work.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from pydantic import Field

from .agent import ProviderFailure, has_instructions
from .domain import Model
from .services import AGENT_ID
from .textcheck import numbers_in
from .workforce import WORKDAY_START

MODULES = ("geopulse", "shifts", "wellness", "sync", "tasks", "leave")


class Reply(Model):
    text: str = Field(min_length=1, max_length=1500)


def _scope(workforce, user, column="employee_id"):
    """SQL fragment limiting rows to the viewer; reviewers see the organisation."""
    return ("", ()) if workforce._is_admin(user) else (f" AND {column}=?", (user["id"],))


def facts(workforce, user, module):
    """Small, verifiable numbers plus human-readable findings, each citing its evidence."""
    today = date.fromisoformat(workforce.today())
    since = (today - timedelta(days=30)).isoformat()
    findings, numbers = [], {}
    clause, args = _scope(workforce, user)
    with workforce.db.connect() as cx:
        def n(sql, *params):
            return cx.execute(sql, params).fetchone()[0]

        if module == "geopulse":
            logs = {r["geofence_status"]: r["c"] for r in cx.execute(
                f"SELECT geofence_status,COUNT(*) c FROM location_logs WHERE recorded_at>=?{clause} GROUP BY 1",
                (since, *args))}
            numbers = {f"location_checks_{k}": v for k, v in logs.items()}
            refused = sum(v for k, v in logs.items() if k != "inside")
            findings.append(f"{sum(logs.values())} location checks in 30 days, {refused} not confirmed inside.")
            late = n(f"SELECT COUNT(*) FROM attendance WHERE attendance_date>=? AND substr(check_in_time,12,5)>?{clause}",
                     since, WORKDAY_START, *args)
            findings.append(f"{late} check-ins after {WORKDAY_START} UTC in the last 30 days.")
            numbers["late_check_ins"] = late
        elif module == "shifts":
            week = (today + timedelta(days=7)).isoformat()
            shifts = n(f"SELECT COUNT(*) FROM shift_schedules WHERE assigned_date BETWEEN ? AND ?{clause}",
                       today.isoformat(), week, *args)
            pending = n("SELECT COUNT(*) FROM shift_swap_requests WHERE status='pending'" + (
                "" if workforce._is_admin(user) else " AND requester_id=?"), *(() if workforce._is_admin(user) else (user["id"],)))
            numbers = {"shifts_next_7_days": shifts, "pending_swaps": pending}
            findings += [f"{shifts} shifts are scheduled in the next 7 days.", f"{pending} swap request(s) are pending."]
            if workforce._is_admin(user):
                staff = n("SELECT COUNT(*) FROM users WHERE role='employee' AND id!=?", AGENT_ID)
                days = n("SELECT COUNT(DISTINCT assigned_date) FROM shift_schedules WHERE assigned_date BETWEEN ? AND ?",
                         today.isoformat(), week)
                findings.append(f"Shifts exist on {days} distinct day(s) for {staff} employees.")
                numbers["days_with_shifts"] = days
                pct = n("SELECT min_staff_pct FROM leave_policy WHERE id=1")
                need = -(-staff * pct // 100)
                for r in cx.execute("SELECT assigned_date d,COUNT(*) c FROM shift_schedules WHERE assigned_date BETWEEN ? AND ? "
                                    "GROUP BY 1 ORDER BY 1", (today.isoformat(), week)):
                    if r["c"] < need and date.fromisoformat(r["d"]).weekday() < 5:
                        findings.append(f"{r['d']} is understaffed: {r['c']} of {staff} scheduled "
                                        f"(minimum {need}). Consider moving shifts or declining leave that day.")
        elif module == "wellness":
            rows = cx.execute(
                f"""SELECT a.id,a.total_working_hours h,(SELECT COUNT(*) FROM breaks b WHERE b.attendance_id=a.id) b
                FROM attendance a WHERE a.attendance_date>=? AND a.check_out_time IS NOT NULL{clause.replace('employee_id', 'a.employee_id')}""",
                (since, *args)).fetchall()
            no_break = sum(1 for r in rows if r["b"] == 0)
            long_days = sum(1 for r in rows if (r["h"] or 0) > 9)
            numbers = {"worked_days": len(rows), "days_without_break": no_break, "days_over_9_hours": long_days}
            findings += [f"{len(rows)} completed days in 30 days; {no_break} had no recorded break.",
                         f"{long_days} day(s) exceeded 9 net hours."]
        elif module == "sync":
            failed = n(f"SELECT COUNT(*) FROM sync_log WHERE result IN ('failed','conflict') AND synced_at>=?{clause}", since, *args)
            retry = n(f"SELECT COUNT(*) FROM sync_log WHERE result='retry' AND synced_at>=?{clause}", since, *args)
            open_c = n(f"SELECT COUNT(*) FROM sync_conflicts WHERE status='open'{clause}", *args)
            numbers = {"failed_syncs": failed, "retried_syncs": retry, "open_conflicts": open_c}
            findings += [f"{failed} failed sync(s) and {retry} retry attempt(s) in 30 days.",
                         f"{open_c} open conflict(s) need a decision."]
        elif module == "tasks":
            sql = "SELECT * FROM tasks WHERE status!='completed'" + _scope(workforce, user, "assignee_id")[0]
            open_tasks = cx.execute(sql, _scope(workforce, user, "assignee_id")[1]).fetchall()
            overdue = [t for t in open_tasks if t["due_date"] and t["due_date"] < today.isoformat()]
            soon = [t for t in open_tasks if t["due_date"] and today.isoformat() <= t["due_date"] <= (today + timedelta(days=3)).isoformat()]
            numbers = {"open_tasks": len(open_tasks), "overdue": len(overdue), "due_within_3_days": len(soon)}
            findings += [f"{len(open_tasks)} open task(s); {len(overdue)} overdue; {len(soon)} due within 3 days."]
            findings += [f"Overdue: {t['title']} (due {t['due_date']})." for t in overdue[:3]]
        elif module == "leave":
            pending = n(f"SELECT COUNT(*) FROM leave_requests WHERE approval_status='pending'{clause}", *args)
            approved = n(f"SELECT COUNT(*) FROM leave_requests WHERE approval_status='approved' AND end_date>=?{clause}",
                         today.isoformat(), *args)
            numbers = {"pending_requests": pending, "upcoming_approved": approved}
            findings += [f"{pending} request(s) await a decision; {approved} approved leave(s) are current or upcoming."]
            if not workforce._is_admin(user):
                for kind, b in workforce.balances(user).items():
                    numbers[f"{kind}_remaining"] = b["remaining"]
                    findings.append(f"{kind.capitalize()} leave: {b['remaining']:g} of {b['allowance']} days remain.")
    confidence = "high" if sum(v for v in numbers.values() if isinstance(v, (int, float))) >= 10 else "medium" if numbers else "low"
    return {"findings": findings, "numbers": numbers, "confidence": confidence}


def _hm(minutes):
    hours, mins = divmod(int(round(minutes)), 60)
    return f"{hours} h {mins} min"


def _has(question, *words):
    q = question.lower()
    return any(w in q for w in words)


def topical(workforce, user, module, question):
    """Facts that answer the specific question, computed by code. Empty when nothing matches."""
    findings, numbers = [], {}
    today = date.fromisoformat(workforce.today())
    admin = workforce._is_admin(user)
    if module in ("wellness", "geopulse") and _has(question, "today", "so far", "now", "hours", "break", "worked"):
        status = workforce.today_status(user)
        att = status["today"]
        if att and att["attendance_date"] == today.isoformat():
            state = "still clocked in" if not att["check_out_time"] else "clocked out"
            findings.append(f"Today you checked in at {att['check_in_time'][11:16]} UTC and are {state}: "
                            f"{_hm(status['net_minutes'])} worked net, {_hm(status['break_minutes'])} on breaks "
                            f"({len(status['breaks'])} break(s)).")
            numbers.update(net_minutes_today=status["net_minutes"], break_minutes_today=status["break_minutes"])
        else:
            findings.append("No check-in is recorded for you today, so 0 hours are worked so far.")
    if module == "shifts":
        with workforce.db.connect() as cx:
            if _has(question, "understaff", "coverage", "gap", "short", "enough", "staff", "busy", "risk"):
                staff = cx.execute("SELECT COUNT(*) FROM users WHERE role='employee' AND id!=?", (AGENT_ID,)).fetchone()[0]
                pct = cx.execute("SELECT min_staff_pct FROM leave_policy WHERE id=1").fetchone()[0]
                need = -(-staff * pct // 100)
                rows = cx.execute(
                    """SELECT assigned_date d,COUNT(*) c FROM shift_schedules WHERE assigned_date BETWEEN ? AND ?
                    GROUP BY 1 ORDER BY 1""", (today.isoformat(), (today + timedelta(days=6)).isoformat())).fetchall()
                low = [r for r in rows if r["c"] < need and date.fromisoformat(r["d"]).weekday() < 5]
                findings.append(f"Minimum cover is {need} of {staff} people ({pct}%) on weekdays.")
                findings += [f"{r['d']} is understaffed: {r['c']} of {staff} scheduled." for r in low] or \
                    ["No weekday in the next 7 days is below minimum cover."]
                numbers.update(minimum_cover=need, understaffed_days=len(low))
            if _has(question, "swap", "pending", "request", "trade", "who"):
                swaps = cx.execute(
                    """SELECT s.assigned_date d,r.reason,u.name a,t.name b FROM shift_swap_requests r
                    JOIN shift_schedules s ON s.id=r.shift_id JOIN users u ON u.id=r.requester_id
                    LEFT JOIN users t ON t.id=r.target_employee_id WHERE r.status='pending'"""
                    + ("" if admin else " AND r.requester_id=?") + " ORDER BY s.assigned_date",
                    () if admin else (user["id"],)).fetchall()
                findings += [f"{r['a']} asks to swap the {r['d']} shift with {r['b'] or 'anyone available'}"
                             f" ({r['reason'] or 'no reason given'})." for r in swaps] or ["No swap requests are pending."]
            if _has(question, "my shift", "next shift", "when do i", "upcoming"):
                rows = cx.execute("SELECT assigned_date d,shift_start a,shift_end b FROM shift_schedules "
                                  "WHERE employee_id=? AND assigned_date>=? ORDER BY 1 LIMIT 3",
                                  (user["id"], today.isoformat())).fetchall()
                findings += [f"Your shift on {r['d']}: {r['a']} to {r['b']}." for r in rows] or ["You have no upcoming shifts."]
    if module == "tasks" and _has(question, "overdue", "late", "due", "who", "assign", "priority", "urgent", "behind"):
        with workforce.db.connect() as cx:
            rows = cx.execute(
                """SELECT t.title,t.due_date,t.priority,COALESCE(u.name,'Unassigned') who FROM tasks t
                LEFT JOIN users u ON u.id=t.assignee_id WHERE t.status!='completed'"""
                + ("" if admin else " AND t.assignee_id=?") + " ORDER BY t.due_date IS NULL,t.due_date LIMIT 5",
                () if admin else (user["id"],)).fetchall()
        findings += [f"{r['title']} ({r['priority']} priority) is assigned to {r['who']}, due {r['due_date'] or 'no date'}"
                     f"{' and overdue' if r['due_date'] and r['due_date'] < today.isoformat() else ''}." for r in rows] \
            or ["There are no open tasks."]
    return findings, numbers


def render(module, data):
    bullets = "\n".join(f"- {line}" for line in data["findings"])
    return f"**{module.capitalize()} insights** (confidence: {data['confidence']})\n\n{bullets}\n\nEvidence is read from your saved records; recommendations are for human review."


def answer(workforce, provider, user, module, question=None):
    """Insights for a module, or a grounded answer to a question."""
    if module not in MODULES:
        return {"ok": False, "error": "Unknown module", "counts": {}}
    data = facts(workforce, user, module)
    matched = False
    if question:
        extra, extra_numbers = topical(workforce, user, module, question)
        if extra:
            matched = True
            data = {**data, "findings": extra + data["findings"], "numbers": {**data["numbers"], **extra_numbers}}
    base = {"ok": True, "counts": data["numbers"], "mode": provider.mode}
    text = render(module, data)
    if question and not matched:
        text = "I can't answer that specific question from the saved records. General insights:\n\n" + text
    if not question:
        return {**base, "text": text, "source": "rules"}
    if has_instructions(question):
        return {**base, "text": text, "source": "rules",
                "notice": "The question contains instructions for the assistant and was not sent to a model."}
    if provider.mode == "off":
        return {**base, "text": text, "source": "rules",
                "notice": "The model is off, so these are the rule-based findings."}
    allowed = numbers_in(" ".join(data["findings"])) | {Decimal(str(v)).normalize() for v in data["numbers"].values()
                                                       if isinstance(v, (int, float))}

    def check(reply):
        stray = numbers_in(reply.text) - allowed
        if stray:
            raise ProviderFailure("The answer used numbers that are not in the records")
        return reply

    try:
        reply = provider.extract(
            Reply, "You are a workforce assistant. Answer the untrusted question using ONLY the supplied findings "
            "and numbers. Never invent employees, numbers or approvals. Never compute new numbers. Be concise. "
            "If the findings do not answer the question, say you cannot answer it from the records.",
            {"untrusted_question": question, "module": module, "findings": data["findings"],
             "numbers": data["numbers"]}, validate=check)
        return {**base, "text": reply.text, "source": "model",
                "notice": "Wording by the model; every number is checked against the records."}
    except ProviderFailure as exc:
        return {**base, "text": text, "source": "rules", "notice": f"Model answer rejected ({exc})."}
