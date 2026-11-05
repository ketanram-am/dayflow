"""Mid-week overtime forecast from real punches.

Takes the hours each hourly employee has actually worked so far this week (check-ins, check-outs and
recorded breaks), adds the shifts still scheduled, and flags anyone who will pass the weekly overtime
threshold. For each one it offers options that can still stop it, priced by the pay engine:

* finish early: end the last remaining shift sooner by exactly the overtime minutes;
* hand over: give the last remaining shift to a colleague who is free, not on leave, and stays under
  the threshold themselves.

Nothing changes until a manager applies an option. Applying edits the schedule (RotaFlow) and writes
the audit chain; the forecast itself never writes.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from math import ceil
from zoneinfo import ZoneInfo

from .data import generate
from .domain import Employment, Interval, PolicyDocument, Schedule, Timecard, WorkShift
from .engine import calculate, money
from .services import AGENT_ID, fail, reviewer

ZONE = ZoneInfo("America/New_York")
UNPAID_BREAK = 30  # minutes taken off every scheduled shift longer than five hours


def _net(gross_minutes):
    return max(0, gross_minutes - UNPAID_BREAK) if gross_minutes > 300 else gross_minutes


def _utc(day, hhmm):
    hh, mm = map(int, hhmm.split(":"))
    return datetime.combine(day, time(hh, mm), timezone.utc)


def _minutes(start, end):
    return int((end - start).total_seconds() // 60)


def _card(employee, monday, day_minutes):
    """A timecard for one week built from net minutes per day, for the engine to price."""
    shifts, schedules = [], []
    for day, net in sorted(day_minutes.items()):
        if net <= 0:
            continue
        begin = datetime.combine(day, time(9), ZONE)
        breaks = []
        gross = net
        if net > 300:
            gross = net + UNPAID_BREAK
            breaks = [Interval(start=begin + timedelta(hours=4), end=begin + timedelta(hours=4, minutes=UNPAID_BREAK))]
        sid = f"{employee.id}-{day}"
        end = begin + timedelta(minutes=gross)
        shifts.append(WorkShift(id=sid, start=begin, end=end, breaks=breaks, work_approved=True))
        schedules.append(Schedule(id=sid, start=begin, end=end, planned_breaks=breaks,
                                  planned_unpaid_break_minutes=UNPAID_BREAK if breaks else 0))
    return Timecard(id=f"{employee.id}-{monday}-forecast", employee=employee, period_start=monday,
                    shifts=shifts, schedules=schedules,
                    as_of=datetime.combine(monday + timedelta(days=14), time(0), ZONE),
                    note="Projected from this week's punches and remaining schedule.")


def _price(employee, monday, day_minutes, rules):
    result = calculate(_card(employee, monday, day_minutes), rules)
    return (Decimal(result.total) if result.status == "complete" and result.total is not None else None,
            result.overtime_minutes)


class Forecast:
    def __init__(self, workforce):
        self.w = workforce

    # ---------------------------------------------------------------- facts
    def _rules(self):
        with self.w.db.connect() as cx:
            policy, _ = self.w.svc.policy(cx)
        return PolicyDocument.model_validate_json(policy["document"]).rules

    def _roster(self):
        cards, _, _ = generate()
        return {c.employee.id: c.employee for c in cards
                if c.employee.employment != Employment.salaried_exempt}

    def _week(self):
        today = self.w.clock().date()
        monday = today - timedelta(days=today.weekday())
        return monday, today

    def _projection(self, cx, employee_id, monday, now):
        """Net minutes worked so far and still scheduled, per day of this week."""
        days = {}
        end_of_week = (monday + timedelta(days=6)).isoformat()
        for att in cx.execute(
                "SELECT * FROM attendance WHERE employee_id=? AND attendance_date BETWEEN ? AND ?",
                (employee_id, monday.isoformat(), end_of_week)):
            stop = att["check_out_time"] or now.isoformat()
            net = round(self.w._net_minutes(cx, att["id"], att["check_in_time"], stop))
            days[date.fromisoformat(att["attendance_date"])] = {"worked": net, "remaining": 0, "open": att["check_out_time"] is None}
        for shift in cx.execute(
                "SELECT * FROM shift_schedules WHERE employee_id=? AND assigned_date BETWEEN ? AND ?",
                (employee_id, monday.isoformat(), end_of_week)):
            day = date.fromisoformat(shift["assigned_date"])
            entry = days.setdefault(day, {"worked": 0, "remaining": 0, "open": False})
            start, end = _utc(day, shift["shift_start"]), _utc(day, shift["shift_end"])
            if day > now.date():
                entry["remaining"] = _net(_minutes(start, end))
            elif day == now.date() and now < end and (entry["open"] or not entry["worked"]):
                entry["remaining"] = max(0, _minutes(max(now, start), end) - (UNPAID_BREAK if entry["open"] is False and now < start + timedelta(hours=4) else 0))
            entry["shift"] = (shift["id"], shift["shift_start"], shift["shift_end"])
        return days

    def _on_leave(self, cx, employee_id, day):
        return self.w._leave_on(cx, employee_id, day.isoformat())

    # ------------------------------------------------------------- the forecast
    def build(self, user):
        reviewer(user)
        rules, roster = self._rules(), self._roster()
        limit = rules.weekly_minutes
        monday, today = self._week()
        now = self.w.clock()
        projections, names = {}, {}
        with self.w.db.connect() as cx:
            active = {r["id"]: r["name"] for r in cx.execute(
                "SELECT u.id,u.name FROM users u LEFT JOIN profiles p ON p.user_id=u.id "
                "WHERE u.id!=? AND COALESCE(p.is_active,1)=1", (AGENT_ID,))}
            for eid in roster:
                if eid in active:
                    days = self._projection(cx, eid, monday, now)
                    worked = sum(d["worked"] for d in days.values())
                    remaining = sum(d["remaining"] for d in days.values())
                    projections[eid] = {"days": days, "worked": worked, "remaining": remaining,
                                        "projected": worked + remaining}
                    names[eid] = active[eid]
            flagged = []
            for eid, proj in projections.items():
                over = proj["projected"] - limit
                if over <= 0:
                    continue
                employee = roster[eid]
                last = max((d for d, v in proj["days"].items() if v["remaining"] > 0 and "shift" in v), default=None)
                before_minutes = {d: v["worked"] + v["remaining"] for d, v in proj["days"].items()}
                cost_before, ot_before = _price(employee, monday, before_minutes, rules)
                options = []
                if last:
                    last_info = proj["days"][last]
                    cut = ceil(over / 15) * 15
                    if last_info["remaining"] - cut >= 60:
                        after = dict(before_minutes)
                        after[last] = after[last] - cut
                        cost_after, ot_after = _price(employee, monday, after, rules)
                        old_end = last_info["shift"][2]
                        new_end = (_utc(last, old_end) - timedelta(minutes=cut)).strftime("%H:%M")
                        options.append(self._option(
                            f"finish_early:{eid}:{last}", "finish_early", employee, cost_before, cost_after,
                            ot_before, ot_after, cut, limit,
                            f"End {employee.name.split()[0]}'s {last:%a} shift at {new_end} instead of {old_end}",
                            {"date": last.isoformat(), "new_end": new_end, "minutes_cut": cut}))
                    for peer_id, peer in sorted(projections.items(),
                                                key=lambda kv: (roster[kv[0]].department != employee.department,
                                                                kv[1]["projected"])):
                        if peer_id == eid:
                            continue
                        moved = last_info["remaining"]
                        if peer["projected"] + moved > limit:
                            continue
                        if last in peer["days"] and (peer["days"][last]["worked"] or "shift" in peer["days"][last]):
                            continue
                        if self._on_leave(cx, peer_id, last):
                            continue
                        peer_before = {d: v["worked"] + v["remaining"] for d, v in peer["days"].items()}
                        peer_after = {**peer_before, last: peer_before.get(last, 0) + moved}
                        mine_after = {**before_minutes, last: before_minutes[last] - moved}
                        pb, _ = _price(roster[peer_id], monday, peer_before, rules)
                        pa, ot_peer = _price(roster[peer_id], monday, peer_after, rules)
                        ma, ot_after = _price(employee, monday, mine_after, rules)
                        if None in (pb, pa, ma, cost_before):
                            continue
                        options.append(self._option(
                            f"hand_over:{eid}:{last}:{peer_id}", "hand_over", employee,
                            cost_before + pb, ma + pa, ot_before, ot_after + ot_peer, over, limit,
                            f"Give {employee.name.split()[0]}'s {last:%a} shift to {names[peer_id]}",
                            {"date": last.isoformat(), "to_employee_id": peer_id, "to_employee": names[peer_id],
                             "to_projected_after": peer["projected"] + moved}))
                        break
                options = [o for o in options if o["saving"] is not None]
                options.sort(key=lambda o: Decimal(o["saving"]), reverse=True)
                flagged.append({
                    "employee_id": eid, "employee": names[eid], "department": employee.department,
                    "worked_minutes": proj["worked"], "remaining_minutes": proj["remaining"],
                    "projected_minutes": proj["projected"], "over_minutes": over,
                    "overtime_cost": str(money((cost_before or Decimal(0)))) if cost_before is not None else None,
                    "days": [{"date": d.isoformat(), "worked": v["worked"], "remaining": v["remaining"]}
                             for d, v in sorted(proj["days"].items())],
                    "options": options, "recommended": options[0]["id"] if options else None,
                    "no_option_reason": None if options else (
                        "The pay engine could not price a safe option for this person "
                        "(incomplete timecard data or no colleague with room). Decide manually."),
                })
        flagged.sort(key=lambda f: f["over_minutes"], reverse=True)
        potential = sum((Decimal(f["options"][0]["saving"]) for f in flagged if f["options"]), Decimal(0))
        return {"week_start": monday.isoformat(), "as_of": now.isoformat(), "today": today.isoformat(),
                "threshold_minutes": limit, "employees_checked": len(projections),
                "flagged": flagged, "potential_saving": str(money(potential)),
                "note": "Non-exempt employees only. Worked time comes from recorded punches and breaks; "
                        "remaining time comes from the published schedule."}

    @staticmethod
    def _option(identity, kind, employee, before, after, ot_before, ot_after, minutes, limit, title, detail):
        saving = None if before is None or after is None else str(money(before - after))
        return {"id": identity, "kind": kind, "title": title, "minutes": minutes,
                "overtime_minutes_avoided": max(0, ot_before - ot_after), "saving": saving,
                "checks": ["pay engine priced the week before and after",
                           f"stays at or under {limit // 60} hours",
                           "no one is on approved leave on that day"], **detail}

    # --------------------------------------------------------------------- apply
    def apply(self, user, option_id):
        """A manager applies one option. Recomputed server-side; the client only names it."""
        reviewer(user)
        report = self.build(user)
        option = next((o for f in report["flagged"] for o in f["options"] if o["id"] == option_id), None)
        if not option:
            fail("That option is no longer available; the forecast has changed", 409)
        _, eid, _day, *rest = option_id.split(":")
        with self.w.db.transaction() as cx:
            shift = cx.execute("SELECT * FROM shift_schedules WHERE employee_id=? AND assigned_date=?",
                               (eid, option["date"])).fetchone()
            if not shift:
                fail("The shift no longer exists", 409)
            if option["kind"] == "finish_early":
                cx.execute("UPDATE shift_schedules SET shift_end=? WHERE id=?", (option["new_end"], shift["id"]))
                from .db import audit
                audit(cx, user["id"], "overtime_prevented", shift["id"], {
                    "kind": "finish_early", "employee": eid, "date": option["date"],
                    "new_end": option["new_end"], "saving": option["saving"]})
            else:
                target = option["to_employee_id"]
                self.w._check_target(cx, target, shift, eid)
                cx.execute("UPDATE shift_schedules SET employee_id=? WHERE id=?", (target, shift["id"]))
                from .db import audit, now as stamp, uid
                cx.execute("INSERT INTO shift_swap_requests VALUES(?,?,?,?,?,'approved',?,?)",
                           (uid("swp-"), shift["id"], eid, target,
                            "Dayflow overtime prevention", user["id"], stamp()))
                audit(cx, user["id"], "overtime_prevented", shift["id"], {
                    "kind": "hand_over", "employee": eid, "to": target, "date": option["date"],
                    "saving": option["saving"]})
        return {"status": "applied", "option": option}
