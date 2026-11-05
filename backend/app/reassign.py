"""Schedule clashes: propose a fix the pay engine can prove, instead of handing the card over.

A timecard edit cannot fix a schedule, so nothing is changed here. Two proposals, tried in order:
1. reschedule: the clashing shift was actually worked at another time, so move the schedule to
   where the punches are. The clash and the punch-versus-schedule variance both disappear.
2. reassign: move the later shift to a teammate who is free, stays under the weekly overtime
   threshold, and whose own timecard stays clean when the shift is added.
The manager approves the recommendation; it is recorded for the scheduling team.
"""

from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from .domain import Employment, PolicyDocument, Schedule

HOURLY = Employment.hourly


def _minutes(schedule):
    return int((schedule.end - schedule.start).total_seconds() // 60) - schedule.planned_unpaid_break_minutes


def _week(card, schedule):
    local = schedule.start.astimezone(ZoneInfo(card.employee.timezone))
    monday = local.date() - timedelta(days=local.weekday())
    return monday


def _scheduled_that_week(card, schedule):
    zone = ZoneInfo(card.employee.timezone)
    monday = _week(card, schedule)
    return sum(_minutes(s) for s in card.schedules
               if monday <= s.start.astimezone(zone).date() < monday + timedelta(days=7))


def _chain(cards, employee_id, replacing=None):
    """One employee's cards, optionally with one card swapped for an in-memory candidate."""
    return [replacing if replacing is not None and c.id == replacing.id else c
            for c in cards if c.employee.id == employee_id]


def _blocking(pay):
    return {e["id"] for e in pay["exceptions"] if e["blocking"]}


def _label(schedule, zone):
    start, end = schedule.start.astimezone(zone), schedule.end.astimezone(zone)
    return f"{start:%a %b} {start.day} {start:%H:%M}\u2013{end:%H:%M}"


def _reschedule(svc, card, cards, policy_json, exception, pair):
    """The work was recorded elsewhere: move the clashing schedule to where it was actually worked."""
    zone = ZoneInfo(card.employee.timezone)
    for move in sorted(pair, key=lambda s: s.start, reverse=True):
        worked = next((w for w in card.shifts if w.id == move.id and w.start and w.end), None)
        if not worked or (worked.start == move.start and worked.end == move.end):
            continue
        shifted = worked.start - move.start
        candidate = card.model_copy(deep=True)
        for sched in candidate.schedules:
            if sched.id == move.id:
                sched.start, sched.end = worked.start, worked.end
                sched.planned_breaks = [b.model_copy(update={"start": b.start + shifted, "end": b.end + shifted})
                                        for b in sched.planned_breaks]
        before = svc.pay(card, _chain(cards, card.employee.id), policy_json)
        after = svc.pay(candidate, _chain(cards, card.employee.id, candidate), policy_json)
        remaining = {e["id"] for e in after["exceptions"]}
        if exception["id"] in remaining or f"schedule_conflict:variance:{move.id}" in remaining:
            continue
        if _blocking(after) - _blocking(before):
            continue
        cleared = sorted({e["id"] for e in before["exceptions"]} - remaining)
        return {
            "mode": "reschedule", "cleared": cleared, "shift_id": move.id, "when": _label(move, zone),
            "to_when": _label(candidate.schedules[[x.id for x in candidate.schedules].index(move.id)], zone),
            "from_employee": card.employee.name, "to_employee_id": card.employee.id,
            "to_employee": card.employee.name,
            "checks": ["the clash is cleared on the same timecard",
                       "the schedule now matches the punches that were actually recorded",
                       "the pay engine finds no new blocking exception"],
        }
    return None


def propose(svc, card, cards, policy_json, exception) -> dict | None:
    """Return a verified schedule fix for one schedule_overlap exception, or None."""
    ids = exception["reference"].split(":")
    pair = [s for s in card.schedules if s.id in ids]
    if len(pair) != 2:
        return None
    found = _reschedule(svc, card, cards, policy_json, exception, pair)
    if found:
        return found
    move = max(pair, key=lambda s: s.start)  # otherwise the later shift moves to a free teammate
    limit = PolicyDocument.model_validate_json(policy_json).rules.weekly_minutes
    zone = ZoneInfo(card.employee.timezone)

    # The clash must disappear from this employee's card without creating a new blocking problem.
    own = card.model_copy(deep=True)
    own.schedules = [s for s in own.schedules if s.id != move.id]
    before = svc.pay(card, _chain(cards, card.employee.id), policy_json)
    after = svc.pay(own, _chain(cards, card.employee.id, own), policy_json)
    if exception["id"] in {e["id"] for e in after["exceptions"]}:
        return None
    if _blocking(after) - _blocking(before):
        return None

    peers = [c for c in cards if c.period_start == card.period_start and c.id != card.id
             and c.employee.employment == HOURLY and c.employee.id != card.employee.id]
    peers.sort(key=lambda c: (c.employee.department != card.employee.department,
                              _scheduled_that_week(c, move), c.employee.name))
    for peer in peers[:12]:
        if any(s.start < move.end and move.start < s.end for s in peer.schedules):
            continue
        if any(s.start and s.end and s.start < move.end and move.start < s.end for s in peer.shifts):
            continue
        have = _scheduled_that_week(peer, move)
        if have + _minutes(move) > limit:
            continue
        candidate = peer.model_copy(deep=True)
        candidate.schedules.append(Schedule(
            id=f"{move.id}@{peer.employee.id}", start=move.start, end=move.end,
            planned_unpaid_break_minutes=move.planned_unpaid_break_minutes,
            planned_breaks=[b.model_copy() for b in move.planned_breaks]))
        base = svc.pay(peer, _chain(cards, peer.employee.id), policy_json)
        result = svc.pay(candidate, _chain(cards, peer.employee.id, candidate), policy_json)
        if _blocking(result) - _blocking(base):
            continue
        when = f"{move.start.astimezone(zone):%a %b} {move.start.astimezone(zone).day} " \
               f"{move.start.astimezone(zone):%H:%M}–{move.end.astimezone(zone):%H:%M}"
        return {
            "mode": "reassign", "shift_id": move.id, "when": when, "from_employee": card.employee.name,
            "to_employee_id": peer.employee.id, "to_employee": peer.employee.name,
            "to_week_minutes_before": have, "to_week_minutes_after": have + _minutes(move),
            "weekly_limit_minutes": limit,
            "checks": ["clash cleared on the original timecard", "teammate free at that time",
                       "teammate stays under the weekly overtime threshold",
                       "teammate's timecard has no new blocking exception"],
        }
    return None
