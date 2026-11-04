"""Timecard resolution agent: plan a compliant fix per exception, prove it, route it.

Every card gets a plan. Each detected exception gets exactly one resolution kind; edits to
shifts become one Correction that the pay engine simulates before anyone sees it. The lane
says who acts next: a manager can approve, the employee must confirm, or a manager decides.
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from pydantic import Field

from .agent import has_instructions
from .domain import Correction, Employment, Model

Kind = Literal["fill_punch", "remove_duplicate", "add_shift", "pay_premium",
               "accept_as_recorded", "ask_employee", "record_leave", "needs_manager"]
Lane = Literal["ready", "waiting", "judgment", "clear"]

# Which resolutions are compliant for each exception code. Anything else is rejected.
ALLOWED: dict[str, set[str]] = {
    "missing_endpoint": {"fill_punch", "ask_employee", "needs_manager"},
    "duplicate": {"remove_duplicate"},
    "actual_overlap": {"remove_duplicate", "needs_manager"},
    "meal": {"pay_premium"},  # never move punches to dodge a premium
    "variance": {"accept_as_recorded"},
    "unscheduled": {"accept_as_recorded", "needs_manager"},
    "absence": {"accept_as_recorded"},
    "forecast": {"accept_as_recorded"},
    "long_shift": {"accept_as_recorded"},
    "missed_shift": {"ask_employee", "add_shift", "record_leave"},
}
EMPLOYEE_KINDS = {"fill_punch", "add_shift", "ask_employee"}
MANAGER_KINDS = {"needs_manager", "record_leave"}


class PlanItem(Model):
    exception_id: str
    code: str
    kind: Kind
    field: Literal["start", "end"] | None = None
    time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    source: Literal["note", "schedule", "records"] = "records"
    quote: str | None = None
    reason: str
    question: str | None = None


def code_of(exception_id: str) -> str:
    return exception_id.split(":")[1]


def _local(value, zone):
    return value.astimezone(zone)


def _day(value, zone):
    return _local(value, zone).strftime("%A %b %d").replace(" 0", " ")


def _schedule(card, shift_id):
    return next((s for s in card.schedules if s.id == shift_id), None)


def _shift(card, shift_id):
    return next((s for s in card.shifts if s.id == shift_id), None)


def rules_item(card, exception) -> PlanItem:
    """Deterministic resolution for one exception, used when AI is off or not needed."""
    zone = ZoneInfo(card.employee.timezone)
    code, ref, eid = exception["code"], exception["reference"], exception["id"]
    first = card.employee.name.split()[0]
    if code == "missing_endpoint":
        shift, planned = _shift(card, ref), _schedule(card, ref)
        if not shift or not planned:
            return PlanItem(exception_id=eid, code=code, kind="needs_manager",
                            reason="A punch is missing and there is no schedule to compare with.")
        field = "end" if shift.end is None else "start"
        value = planned.end if field == "end" else planned.start
        hhmm = _local(value, zone).strftime("%H:%M")
        word = "out" if field == "end" else "in"
        return PlanItem(
            exception_id=eid, code=code, kind="fill_punch", field=field, time=hhmm,
            source="schedule",
            reason=f"Clock-{word} missing on {_day(planned.start, zone)}. "
                   f"Proposed {hhmm} from the schedule; {first} confirms.",
            question=f"Your clock-{word} on {_day(planned.start, zone)} is missing. "
                     f"We used your scheduled time, {hhmm}. Is that right?")
    if code in ("duplicate", "actual_overlap"):
        return PlanItem(exception_id=eid, code=code, kind="remove_duplicate",
                        reason="The same punch was recorded twice. Remove the copy.")
    if code == "meal":
        shift = _shift(card, ref)
        when = _day(shift.start, zone) if shift and shift.start else "one day"
        return PlanItem(exception_id=eid, code=code, kind="pay_premium",
                        reason=f"Meal break missed on {when}. Pay the meal premium (already in pay). "
                               "Punches are not changed.")
    if code == "missed_shift":
        planned = _schedule(card, ref)
        when = _day(planned.start, zone) if planned else "a scheduled day"
        return PlanItem(exception_id=eid, code=code, kind="ask_employee",
                        reason=f"No punches on {when}. Ask {first} whether they worked or were absent.",
                        question=f"There are no punches for your shift on {when}. Did you work it?")
    accept = {
        "variance": "Punches differ from the schedule by more than 15 minutes. Pay as recorded.",
        "unscheduled": "Extra shift was approved. Pay as recorded.",
        "absence": "Absence is confirmed. No pay for that day.",
        "forecast": "Overtime was already worked this week. Pay it as recorded.",
        "long_shift": "Shift is longer than 16 hours. Pay as recorded and follow up.",
    }
    if code in accept:
        return PlanItem(exception_id=eid, code=code, kind="accept_as_recorded", reason=accept[code])
    manager = {
        "schedule_overlap": "Two scheduled shifts overlap. Fix the schedule first.",
        "salary_roster": "Salaried week is not five eight-hour weekdays. Fix the schedule first.",
    }
    return PlanItem(exception_id=eid, code=code, kind="needs_manager",
                    reason=manager.get(code, "This record error needs a manager to review it."))


def rules_items(card, pay) -> list[PlanItem]:
    return [rules_item(card, e) for e in pay["exceptions"]]


def build_correction(card, items: list[PlanItem]) -> Correction | None:
    """Turn edit-type items into one Correction. Returns None when nothing changes shifts."""
    zone = ZoneInfo(card.employee.timezone)
    edits, evidence, done = [], [], set()
    for item in items:
        ref = item.exception_id.split(":", 2)[2]
        if item.kind == "fill_punch" and ref not in done:
            shift, planned = _shift(card, ref), _schedule(card, ref)
            anchor = (shift.start or shift.end) if shift else planned.start
            hh, mm = map(int, item.time.split(":"))
            value = datetime.combine(_local(anchor, zone).date(), time(hh, mm), zone)
            start = value if item.field == "start" else shift.start
            end = value if item.field == "end" else shift.end
            edits.append({"operation": "replace", "shift_id": ref, "start": start, "end": end,
                          "breaks": [b.model_dump(mode="json") for b in shift.breaks]})
            evidence += [f"shift:{ref}"] + ([f"schedule:{ref}"] if planned else [])
            evidence += ["note"] if item.source == "note" else []
            done.add(ref)
        elif item.kind == "remove_duplicate":
            ref = ref.split(":")[0]
            if ref not in done:
                edits.append({"operation": "remove", "shift_id": ref, "start": None, "end": None})
                evidence.append(f"shift:{ref}")
                done.add(ref)
        elif item.kind == "add_shift" and ref not in done:
            planned = _schedule(card, ref)
            edits.append({"operation": "add", "shift_id": ref, "start": planned.start,
                          "end": planned.end,
                          "breaks": [b.model_dump(mode="json") for b in planned.planned_breaks]})
            evidence += [f"schedule:{ref}", "note"]
            done.add(ref)
    if not edits:
        return None
    return Correction.model_validate({
        "edits": edits, "clauses": ["DF-006"], "evidence": list(dict.fromkeys(evidence)),
        "reason": "Proposed by the Dayflow resolution agent from the records and the employee's note.",
    })


def simulate(svc, card, cards, policy_json, correction: Correction | None) -> dict:
    """Recompute pay with the correction applied, in memory. Nothing is written."""
    before = svc.pay(card, cards, policy_json)
    result = {"ok": True, "failures": [], "before_total": before["total"],
              "after_total": before["total"], "cleared": [], "new_blocking": []}
    if correction is None:
        return result
    if card.employee.employment == Employment.salaried_exempt:
        # Comp-off balances carry forward, so an earlier incomplete period blocks this one.
        earlier = [c for c in cards if c.period_start < card.period_start
                   and svc.pay(c, cards, policy_json)["status"] != "complete"]
        if earlier:
            return {**result, "ok": False,
                    "failures": ["Fix the earlier pay period first; the comp-off balance carries over"]}
    try:
        candidate = svc.apply_edits(card, correction)
    except HTTPException as exc:
        return {**result, "ok": False, "failures": [str(exc.detail)]}
    others = [c for c in cards if c.id != card.id] + [candidate]
    after = svc.pay(candidate, others, policy_json)
    old = {e["id"] for e in before["exceptions"]}
    new = {e["id"]: e for e in after["exceptions"]}
    targeted = {f"shift:{edit.shift_id}" for edit in correction.edits}
    cleared = sorted(old - set(new))
    new_blocking = [e["title"] for i, e in new.items() if i not in old and e["blocking"]]
    still = [e["title"] for i, e in new.items() if e["blocking"]
             and any(i.endswith(t.split(":", 1)[1]) for t in targeted)]
    failures = [f"Creates a new problem: {t}" for t in new_blocking] + \
        [f"Does not fix: {t}" for t in still]
    return {"ok": not failures, "failures": failures, "before_total": before["total"],
            "after_total": after["total"], "cleared": cleared, "new_blocking": new_blocking}


def lane_for(items: list[PlanItem], simulation: dict | None, hostile: bool) -> str:
    kinds = {i.kind for i in items}
    if not items:
        return "clear"
    if hostile or kinds & MANAGER_KINDS or (simulation and not simulation["ok"]):
        return "judgment"
    if kinds & EMPLOYEE_KINDS:
        return "waiting"
    return "ready"


def headline(items: list[PlanItem], hostile: bool, simulation: dict | None) -> str:
    """One plain sentence for the queue card."""
    if hostile:
        return "The employee note tries to give instructions to the system. A person should review this card."
    if simulation and not simulation["ok"]:
        return "The pay engine rejected the proposed fix: " + "; ".join(simulation["failures"])
    first = next((i for i in items if i.kind in MANAGER_KINDS), None) or \
        next((i for i in items if i.kind in EMPLOYEE_KINDS), None) or items[0]
    extra = len(items) - 1
    return first.reason + (f" (+{extra} more)" if extra else "")


def plan_card(svc, card, cards, policy_json, pay, ai=None) -> dict:
    """Plan, simulate and route one card. `ai` is an optional callable returning items + trace."""
    hostile = has_instructions(card.note)
    trace = []
    items = rules_items(card, pay)
    engine = "rules"
    if ai and not hostile:
        improved, ai_trace = ai(card, pay, items)
        trace.extend(ai_trace)
        if improved is not None:
            items, engine = improved, "ai"
    correction = build_correction(card, items) if not hostile else None
    simulation = simulate(svc, card, cards, policy_json, correction)
    trace.append({"step": "verify", "ok": simulation["ok"], "failures": simulation["failures"]})
    lane = lane_for(items, simulation, hostile)
    return {
        "card_id": card.id, "employee_id": card.employee.id, "employee": card.employee.name,
        "engine": engine, "hostile": hostile, "lane": lane,
        "headline": headline(items, hostile, simulation) if items else "No exceptions.",
        "items": [i.model_dump() for i in items],
        "correction": correction.model_dump(mode="json") if correction else None,
        "simulation": simulation, "trace": trace,
    }
