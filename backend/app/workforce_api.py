"""REST routes for the workforce modules, mounted under /api/wf."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request
from pydantic import Field, StrictBool

from .db import audit, password_hash
from .domain import Model
from .services import fail
from .workforce import Workforce

DATE = r"^\d{4}-\d{2}-\d{2}$"
TIME = r"^([01]\d|2[0-3]):[0-5]\d$"


class Fix(Model):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0, le=100000)


class Verify(Fix):
    purpose: str = Field(default="verify", max_length=20)


class Punch(Fix):
    kind: str = Field(pattern=r"^(check_in|check_out)$")
    captured_at: str | None = Field(default=None, max_length=40)
    event_id: str | None = Field(default=None, max_length=64)


class OfficeInput(Model):
    office_name: str | None = Field(default=None, max_length=80)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: int | None = Field(default=None, ge=20, le=5000)
    max_accuracy_m: int | None = Field(default=None, ge=5, le=1000)
    break_reminder_min: int | None = Field(default=None, ge=30, le=720)


class SyncEvent(Model):
    event_id: str | None = Field(default=None, max_length=64)
    kind: str = Field(pattern=r"^(check_in|check_out)$")
    captured_at: str | None = Field(default=None, max_length=40)
    attempt: int = Field(default=1, ge=1, le=1000)
    result: str = Field(pattern=r"^(success|failed|retry)$")
    error: str | None = Field(default=None, max_length=500)
    device: str | None = Field(default=None, max_length=300)


class ConflictAction(Model):
    action: str = Field(pattern=r"^(resolved|rejected)$")


class ShiftInput(Model):
    employee_id: str = Field(max_length=64)
    date: str = Field(pattern=DATE)
    start: str = Field(pattern=TIME)
    end: str = Field(pattern=TIME)


class SwapInput(Model):
    shift_id: str = Field(max_length=64)
    target_employee_id: str | None = Field(default=None, max_length=64)
    reason: str = Field(default="", max_length=500)


class Decision(Model):
    status: str = Field(pattern=r"^(approved|rejected)$")
    comment: str = Field(default="", max_length=500)


class SwapTarget(Model):
    target_employee_id: str = Field(max_length=64)


class LeaveInput(Model):
    leave_type: str = Field(pattern=r"^(annual|sick|personal|unpaid|other)$")
    start_date: str = Field(pattern=DATE)
    end_date: str | None = Field(default=None, pattern=DATE)
    reason: str = Field(default="", max_length=1000)
    duration: str = Field(default="full", pattern=r"^(full|half|hourly)$")
    hours: float | None = Field(default=None, gt=0, le=8)
    emergency: StrictBool = False


class PolicyInput(Model):
    annual_days: int | None = Field(default=None, ge=0, le=365)
    casual_days: int | None = Field(default=None, ge=0, le=365)
    sick_days: int | None = Field(default=None, ge=0, le=365)
    unpaid_days: int | None = Field(default=None, ge=0, le=365)
    max_consecutive_days: int | None = Field(default=None, ge=1, le=90)
    min_staff_pct: int | None = Field(default=None, ge=0, le=100)


class HolidayInput(Model):
    date: str = Field(pattern=DATE)
    name: str = Field(min_length=1, max_length=80)


class TaskInput(Model):
    title: str = Field(min_length=1, max_length=200)
    project: str | None = Field(default=None, max_length=80)
    tag: str | None = Field(default=None, max_length=40)
    priority: str = Field(default="medium", pattern=r"^(low|medium|high)$")
    assignee_id: str | None = Field(default=None, max_length=64)
    due_date: str | None = Field(default=None, pattern=DATE)


class TaskPatch(Model):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    project: str | None = Field(default=None, max_length=80)
    tag: str | None = Field(default=None, max_length=40)
    priority: str | None = Field(default=None, pattern=r"^(low|medium|high)$")
    assignee_id: str | None = Field(default=None, max_length=64)
    due_date: str | None = Field(default=None, pattern=DATE)
    status: str | None = Field(default=None, pattern=r"^(todo|in_progress|review|completed)$")
    progress: int | None = Field(default=None, ge=0, le=100)


class EmployeePatch(Model):
    full_name: str | None = Field(default=None, max_length=120)
    employee_id: str | None = Field(default=None, max_length=20)
    is_active: StrictBool | None = None
    role: str | None = Field(default=None, pattern=r"^(admin|employee)$")


class AskInput(Model):
    module: str = Field(pattern=r"^(geopulse|shifts|wellness|sync|tasks|leave)$")
    question: str | None = Field(default=None, max_length=1000)


class ApplyOption(Model):
    option_id: str = Field(min_length=5, max_length=120, pattern=r"^[a-z_]+:[A-Za-z0-9_-]+:\d{4}-\d{2}-\d{2}(:[A-Za-z0-9_-]+)?$")


class PasswordChange(Model):
    current: str = Field(max_length=200)
    new: str = Field(max_length=200)


def password_issues(password):
    """Same rules as the web app password screen."""
    rules = [(len(password) >= 8, "at least 8 characters"), (re.search(r"[A-Z]", password), "an uppercase letter"),
             (re.search(r"[a-z]", password), "a lowercase letter"), (re.search(r"[0-9]", password), "a number"),
             (re.search(r"[^A-Za-z0-9]", password), "a symbol")]
    return [text for ok, text in rules if not ok]


def build_router(current_user, service):
    router = APIRouter(prefix="/api/wf")

    def wf(request: Request, svc=Depends(service)) -> Workforce:
        if not hasattr(request.app.state, "workforce"):
            request.app.state.workforce = Workforce(svc)
        return request.app.state.workforce

    def patch(model):
        return model.model_dump(exclude_unset=True)

    # --- people
    @router.get("/me")
    def me(user=Depends(current_user), w=Depends(wf)):
        return w.me(user)

    @router.get("/employees")
    def employees(user=Depends(current_user), w=Depends(wf)):
        return w.employees(user)

    @router.get("/employees/overview")
    def overview(date: str | None = None, user=Depends(current_user), w=Depends(wf)):
        return w.employee_overview(user, date)

    @router.get("/colleagues")
    def colleagues(user=Depends(current_user), w=Depends(wf)):
        return w.colleagues(user)

    @router.patch("/employees/{identity}")
    def update_employee(identity: str, payload: EmployeePatch, user=Depends(current_user), w=Depends(wf)):
        return w.update_employee(user, identity, patch(payload))

    @router.post("/password")
    def change_password(payload: PasswordChange, user=Depends(current_user), svc=Depends(service)):
        issues = password_issues(payload.new)
        if issues:
            fail("Password needs " + ", ".join(issues), 422)
        with svc.db.transaction() as cx:
            row = cx.execute("SELECT salt,password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
            if password_hash(payload.current, row["salt"]) != row["password_hash"]:
                fail("Current password is incorrect", 403)
            cx.execute("UPDATE users SET password_hash=? WHERE id=?",
                       (password_hash(payload.new, row["salt"]), user["id"]))
            audit(cx, user["id"], "password_changed", user["id"], {})
        return {"status": "changed"}

    # --- GeoPulse / ZenBreak
    @router.get("/office")
    def office(user=Depends(current_user), w=Depends(wf)):
        return w.office()

    @router.put("/office")
    def set_office(payload: OfficeInput, user=Depends(current_user), w=Depends(wf)):
        return w.set_office(user, patch(payload))

    @router.post("/location/verify")
    def verify(payload: Verify, user=Depends(current_user), w=Depends(wf)):
        return w.verify_location(user, payload.lat, payload.lng, payload.accuracy, payload.purpose)

    @router.get("/location/logs")
    def location_logs(user=Depends(current_user), w=Depends(wf)):
        return w.location_logs(user)

    @router.post("/punch")
    def punch(payload: Punch, user=Depends(current_user), w=Depends(wf)):
        return w.punch(user, payload.kind, payload.lat, payload.lng, payload.accuracy,
                       payload.captured_at, payload.event_id)

    @router.get("/attendance/today")
    def today(user=Depends(current_user), w=Depends(wf)):
        return w.today_status(user)

    @router.get("/attendance")
    def attendance(employee_id: str | None = None, start: str | None = None, end: str | None = None,
                   limit: int = 200, user=Depends(current_user), w=Depends(wf)):
        return w.attendance(user, employee_id, start, end, min(limit, 500))

    @router.get("/attendance/report")
    def report(start: str, end: str, user=Depends(current_user), w=Depends(wf)):
        return w.attendance_report(user, start, end)

    @router.get("/attendance/week")
    def week(user=Depends(current_user), w=Depends(wf)):
        return w.my_week(user)

    @router.get("/breaks")
    def breaks(since: str | None = None, user=Depends(current_user), w=Depends(wf)):
        return w.breaks(user, since)

    @router.post("/breaks/start")
    def start_break(user=Depends(current_user), w=Depends(wf)):
        return w.start_break(user)

    @router.post("/breaks/end")
    def end_break(user=Depends(current_user), w=Depends(wf)):
        return w.end_break(user)

    # --- SyncShield
    @router.post("/sync/log")
    def sync_log_event(payload: SyncEvent, user=Depends(current_user), w=Depends(wf)):
        return w.log_sync(user, payload.model_dump())

    @router.get("/sync/log")
    def sync_log(user=Depends(current_user), w=Depends(wf)):
        return w.sync_log(user)

    @router.get("/sync/conflicts")
    def conflicts(user=Depends(current_user), w=Depends(wf)):
        return w.conflicts(user)

    @router.post("/sync/scan")
    def scan(user=Depends(current_user), w=Depends(wf)):
        return w.scan_conflicts(user)

    @router.post("/sync/conflicts/{identity}")
    def resolve(identity: str, payload: ConflictAction, user=Depends(current_user), w=Depends(wf)):
        return w.resolve_conflict(user, identity, payload.action)

    # --- RotaFlow
    @router.get("/shifts")
    def shifts(start: str | None = None, end: str | None = None, mine: bool = False,
               user=Depends(current_user), w=Depends(wf)):
        return w.shifts(user, start, end, mine)

    @router.put("/shifts")
    def save_shift(payload: ShiftInput, user=Depends(current_user), w=Depends(wf)):
        return w.save_shift(user, payload.employee_id, payload.date, payload.start, payload.end)

    @router.delete("/shifts/{identity}")
    def delete_shift(identity: str, user=Depends(current_user), w=Depends(wf)):
        return w.delete_shift(user, identity)

    @router.get("/swaps")
    def swaps(user=Depends(current_user), w=Depends(wf)):
        return w.swaps(user)

    @router.post("/swaps")
    def request_swap(payload: SwapInput, user=Depends(current_user), w=Depends(wf)):
        return w.request_swap(user, payload.shift_id, payload.target_employee_id, payload.reason)

    @router.post("/swaps/{identity}/decision")
    def decide_swap(identity: str, payload: Decision, user=Depends(current_user), w=Depends(wf)):
        return w.review_swap(user, identity, payload.status)

    @router.put("/swaps/{identity}/target")
    def swap_target(identity: str, payload: SwapTarget, user=Depends(current_user), w=Depends(wf)):
        return w.assign_swap_target(user, identity, payload.target_employee_id)

    @router.delete("/swaps/{identity}")
    def cancel_swap(identity: str, user=Depends(current_user), w=Depends(wf)):
        return w.cancel_swap(user, identity)

    # --- LeaveSync
    @router.get("/leave")
    def leave(status: str | None = None, user=Depends(current_user), w=Depends(wf)):
        return w.leave_requests(user, status)

    @router.post("/leave")
    def request_leave(payload: LeaveInput, user=Depends(current_user), w=Depends(wf)):
        return w.request_leave(user, payload.model_dump())

    @router.post("/leave/{identity}/decision")
    def decide_leave(identity: str, payload: Decision, user=Depends(current_user), w=Depends(wf)):
        return w.review_leave(user, identity, payload.status, payload.comment)

    @router.delete("/leave/{identity}")
    def cancel_leave(identity: str, user=Depends(current_user), w=Depends(wf)):
        return w.cancel_leave(user, identity)

    @router.get("/leave/balances")
    def balances(employee_id: str | None = None, user=Depends(current_user), w=Depends(wf)):
        return w.balances(user, employee_id)

    @router.get("/leave/calendar")
    def calendar(start: str, end: str, user=Depends(current_user), w=Depends(wf)):
        return w.team_calendar(user, start, end)

    @router.get("/leave/policy")
    def policy(user=Depends(current_user), w=Depends(wf)):
        return w.leave_policy()

    @router.put("/leave/policy")
    def update_policy(payload: PolicyInput, user=Depends(current_user), w=Depends(wf)):
        return w.update_policy(user, patch(payload))

    @router.get("/holidays")
    def holidays(user=Depends(current_user), w=Depends(wf)):
        return w.holidays()

    @router.post("/holidays")
    def add_holiday(payload: HolidayInput, user=Depends(current_user), w=Depends(wf)):
        return w.add_holiday(user, payload.date, payload.name)

    @router.delete("/holidays/{identity}")
    def delete_holiday(identity: str, user=Depends(current_user), w=Depends(wf)):
        return w.delete_holiday(user, identity)

    # --- TaskForge
    @router.get("/tasks")
    def tasks(user=Depends(current_user), w=Depends(wf)):
        return w.tasks(user)

    @router.post("/tasks")
    def create_task(payload: TaskInput, user=Depends(current_user), w=Depends(wf)):
        return w.create_task(user, payload.model_dump())

    @router.patch("/tasks/{identity}")
    def update_task(identity: str, payload: TaskPatch, user=Depends(current_user), w=Depends(wf)):
        return w.update_task(user, identity, patch(payload))

    @router.delete("/tasks/{identity}")
    def delete_task(identity: str, user=Depends(current_user), w=Depends(wf)):
        return w.delete_task(user, identity)

    # --- overtime forecast
    @router.get("/forecast")
    def forecast(user=Depends(current_user), w=Depends(wf)):
        from .forecast import Forecast
        return Forecast(w).build(user)

    @router.post("/forecast/apply")
    def apply_forecast(payload: ApplyOption, user=Depends(current_user), w=Depends(wf)):
        from .forecast import Forecast
        return Forecast(w).apply(user, payload.option_id)

    # --- assistant
    @router.post("/assistant")
    def assistant(payload: AskInput, request: Request, user=Depends(current_user), w=Depends(wf),
                  svc=Depends(service)):
        from .agent import Provider
        from .wf_insights import answer
        provider = Provider(enabled=svc.llm_enabled(), model=svc.llm_model())
        return answer(w, provider, user, payload.module, payload.question)

    # --- dashboard
    @router.get("/dashboard/kpis")
    def kpis(user=Depends(current_user), w=Depends(wf)):
        return w.kpis(user)

    @router.get("/dashboard/trend")
    def trend(days: int = 7, user=Depends(current_user), w=Depends(wf)):
        return w.trend(user, min(max(days, 1), 60))

    @router.get("/dashboard/departments")
    def departments(user=Depends(current_user), w=Depends(wf)):
        return w.departments(user)

    return router
