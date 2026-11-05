"""Next-week overtime prevention: reassign an extra shift before it turns into overtime.

Uses a synthetic next-week schedule (separate from the payroll timecards and labels). For every
hourly employee projected over the weekly overtime threshold, it looks for a teammate with
room under the threshold and no clash, and the pay engine prices both weeks before and after.
No schedule is changed: an accepted swap is recorded for the scheduling team.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from .data import generate
from .domain import Employment, Interval, Schedule, Timecard, WorkShift
from .engine import calculate, money

WEEK = date(2026, 11, 2)  # the Monday after the last payroll period
ZONE = ZoneInfo("America/New_York")


def _shift(sid, day, start_hour, hours, break_after=4):
    begin = datetime.combine(day, time(start_hour), ZONE)
    end = begin + timedelta(hours=hours, minutes=30)
    br = Interval(start=begin + timedelta(hours=break_after),
                  end=begin + timedelta(hours=break_after, minutes=30))
    return sid, begin, end, [br]


def next_week():
    """Synthetic schedules: most hourly staff 5×8h, some part-time 4×8h, some with a Saturday."""
    cards, _, _ = generate()
    employees = {c.employee.id: c.employee for c in cards}
    hourly = [e for e in employees.values() if e.employment == Employment.hourly]
    plan = {}
    for n, employee in enumerate(hourly):
        days = 4 if n % 3 == 1 else 5  # every third person is part-time with Friday off
        shifts = [_shift(f"{employee.id}-nw-{d}", WEEK + timedelta(days=d), 9, 8) for d in range(days)]
        if n % 3 == 0:  # some full-timers also picked up a Saturday
            shifts.append(_shift(f"{employee.id}-nw-sat", WEEK + timedelta(days=5), 8, 6, 3))
        plan[employee.id] = (employee, shifts)
    return plan


def _card(employee, shifts):
    return Timecard(
        id=f"{employee.id}-{WEEK}-plan", employee=employee, period_start=WEEK,
        shifts=[WorkShift(id=s, start=a, end=b, breaks=br, work_approved=True) for s, a, b, br in shifts],
        schedules=[Schedule(id=s, start=a, end=b, planned_breaks=br) for s, a, b, br in shifts],
        as_of=datetime.combine(WEEK + timedelta(days=14), time(0), ZONE),
        note="Projected from next week's schedule.")


def _minutes(shifts):
    return sum(int((b - a).total_seconds() // 60) - 30 for _, a, b, _ in shifts)


def _overlaps(shifts, extra):
    _, a, b, _ = extra
    return any(a < end and start < b for _, start, end, _ in shifts)


def suggestions(rules=None, weekly_minutes=2400):
    """One swap per employee over the weekly threshold, priced by the engine."""
    plan = next_week()
    result = []
    for employee_id, (employee, shifts) in plan.items():
        if _minutes(shifts) <= weekly_minutes:
            continue
        extra = shifts[-1]
        peers = []
        for other_id, (other, other_shifts) in plan.items():
            if other_id == employee_id or other.department != employee.department:
                continue
            if _minutes(other_shifts) + _minutes([extra]) > weekly_minutes:
                continue
            if _overlaps(other_shifts, extra):
                continue
            moved = (extra[0].replace(employee_id, other_id), *extra[1:])
            before = [calculate(_card(employee, shifts), rules), calculate(_card(other, other_shifts), rules)]
            after = [calculate(_card(employee, shifts[:-1]), rules),
                     calculate(_card(other, other_shifts + [moved]), rules)]
            if any(r.status != "complete" for r in before + after):
                continue
            new_blocking = [e.title for e in after[1].exceptions if e.blocking]
            if new_blocking:
                continue
            cost_before = sum(Decimal(r.total) for r in before)
            cost_after = sum(Decimal(r.total) for r in after)
            peers.append((cost_before - cost_after, other, other_shifts, before, after))
        _, a, b, _ = extra
        if not peers or max(p[0] for p in peers) <= 0:
            result.append({
                "id": f"swap-{employee_id}-none", "employee": employee.name,
                "employee_minutes": _minutes(shifts), "to": None, "to_minutes": None,
                "shift": f"{a:%a %b %d} {a:%H:%M}\u2013{b:%H:%M}", "overtime_minutes_avoided": 0,
                "saving": None, "before": None, "after": None,
                "reason": f"{employee.name.split()[0]} is scheduled for {_minutes(shifts) / 60:g} "
                          "hours and no teammate has room without overtime or a clash. "
                          "Approve the overtime or find cover.",
            })
            continue
        saving, other, other_shifts, before, after = max(peers, key=lambda p: p[0])
        moved = (extra[0].replace(employee_id, other.id), *extra[1:])
        plan[other.id] = (other, other_shifts + [moved])  # capacity is used up for later swaps
        result.append({
            "id": f"swap-{employee_id}-{other.id}", "employee": employee.name,
            "employee_minutes": _minutes(shifts), "to": other.name,
            "to_minutes": _minutes(other_shifts),
            "shift": f"{a:%a %b %d} {a:%H:%M}–{b:%H:%M}",
            "overtime_minutes_avoided": before[0].overtime_minutes - after[0].overtime_minutes,
            "saving": str(money(saving)),
            "before": {"employee": before[0].total, "to": before[1].total},
            "after": {"employee": after[0].total, "to": after[1].total},
            "reason": f"{employee.name.split()[0]} is scheduled for {_minutes(shifts) / 60:g} hours. "
                      f"Giving the Saturday shift to {other.name.split()[0]} "
                      f"({_minutes(other_shifts) / 60:g} hours) avoids overtime with no clash.",
        })
    return sorted(result, key=lambda s: Decimal(s["saving"] or 0), reverse=True)
