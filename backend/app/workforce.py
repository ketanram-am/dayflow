"""Workforce modules for attendance, shifts, leave and tasks in the Dayflow backend.

GeoPulse (geofenced attendance), ZenBreak (breaks and net time), SyncShield (offline replay,
audit trail, conflicts), RotaFlow (shifts and swaps), LeaveSync (leave and approval) and
TaskForge (tasks). Everything runs on Dayflow's SQLite database, sessions and hash-chained audit.
Business rules live here, on the server; the browser never decides whether a punch is valid.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import math
import random

from .db import audit, now as stamp, uid
from .services import AGENT_ID, fail, reviewer

SYNC_PAST = timedelta(hours=12)
SYNC_FUTURE = timedelta(minutes=2)
LEAVE_ALLOWANCE = {"annual": "annual_days", "personal": "casual_days", "sick": "sick_days",
                   "unpaid": "unpaid_days"}


def haversine(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def classify(office, lat, lng, accuracy):
    """Inside / outside / uncertain / low_accuracy / unconfigured, with the distance in metres.

    A fix is only Inside when its whole accuracy circle fits inside the radius, and only Outside
    when the whole circle is beyond it. A circle that crosses the boundary is Uncertain, so poor
    indoor GPS can never confirm someone as inside.
    """
    if office["latitude"] is None or office["longitude"] is None:
        return "unconfigured", None
    distance = haversine(lat, lng, office["latitude"], office["longitude"])
    if accuracy is not None and accuracy > office["max_accuracy_m"]:
        return "low_accuracy", distance
    spread = accuracy or 0
    if distance + spread <= office["radius_m"]:
        return "inside", distance
    if distance - spread > office["radius_m"]:
        return "outside", distance
    return "uncertain", distance


def working_days(start, end, holidays=()):
    """Weekdays between two ISO dates inclusive, excluding holidays."""
    if not start or not end or end < start:
        return 0
    skip = set(holidays)
    count, day, last = 0, date.fromisoformat(start), date.fromisoformat(end)
    while day <= last:
        if day.weekday() < 5 and day.isoformat() not in skip:
            count += 1
        day += timedelta(days=1)
    return count


def request_days(row, holidays=()):
    if row["duration"] == "half":
        return 0.5
    if row["duration"] == "hourly":
        return round((row["hours"] or 0) / 8, 2)
    return float(working_days(row["start_date"], row["end_date"], holidays))


def _dt(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:  # a time with no zone is read as UTC, never as the server's local time
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _hhmm(value, label):
    try:
        return time.fromisoformat(value).strftime("%H:%M")
    except (TypeError, ValueError):
        fail(f"{label} must be a time like 09:00", 422)


def _clean(row):
    return dict(row) if row is not None else None


class Workforce:
    def __init__(self, service, clock=None):
        self.svc = service
        self.db = service.db
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.seed()

    # ------------------------------------------------------------------ people
    def today(self):
        return self.clock().date().isoformat()

    def _is_admin(self, user):
        return user["role"] == "reviewer"

    def _employee(self, cx, user_id):
        row = cx.execute(
            """SELECT u.id,u.employee_id,u.name AS full_name,u.email,u.role,
            COALESCE(p.is_active,1) AS is_active,p.profile_image,p.department,
            COALESCE(p.created_at,'') AS created_at
            FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND u.id!=?""",
            (user_id, AGENT_ID)).fetchone()
        if not row:
            return None
        out = dict(row)
        out["role"] = "admin" if out["role"] == "reviewer" else "employee"
        out["is_active"] = bool(out["is_active"])
        return out

    def me(self, user):
        with self.db.connect() as cx:
            employee = self._employee(cx, user["id"])
        return {"employee": employee, "isAdmin": self._is_admin(user)}

    def employees(self, user):
        reviewer(user)
        with self.db.connect() as cx:
            ids = [r["id"] for r in cx.execute("SELECT id FROM users WHERE id!=? ORDER BY name", (AGENT_ID,))]
            return [self._employee(cx, i) for i in ids]

    def colleagues(self, user):
        with self.db.connect() as cx:
            return [{"id": r["id"], "full_name": r["name"]} for r in cx.execute(
                """SELECT u.id,u.name FROM users u LEFT JOIN profiles p ON p.user_id=u.id
                WHERE u.id NOT IN (?,?) AND COALESCE(p.is_active,1)=1 ORDER BY u.name""",
                (AGENT_ID, user["id"]))]

    def employee_overview(self, user, day=None):
        """One row per person with today's attendance, leave and shift (reviewers only)."""
        reviewer(user)
        day = day or self.today()
        out = []
        with self.db.connect() as cx:
            attendance = {r["employee_id"]: dict(r) for r in cx.execute(
                "SELECT * FROM attendance WHERE attendance_date=?", (day,))}
            on_leave = {r["employee_id"] for r in cx.execute(
                """SELECT employee_id FROM leave_requests WHERE approval_status='approved'
                AND start_date<=? AND end_date>=?""", (day, day))}
            shifts = {r["employee_id"]: r["shift_start"] for r in cx.execute(
                "SELECT employee_id,shift_start FROM shift_schedules WHERE assigned_date=?", (day,))}
            for person in self.employees(user):
                out.append({**person, "attendance": attendance.get(person["id"]),
                            "on_leave": person["id"] in on_leave,
                            "shift_start": shifts.get(person["id"])})
        return out

    def update_employee(self, user, target_id, changes):
        """Admins manage activation and role; anyone edits their own display name."""
        own = target_id == user["id"]
        if not own and not self._is_admin(user):
            fail("You can only change your own profile", 403)
        with self.db.transaction() as cx:
            person = self._employee(cx, target_id)
            if not person:
                fail("Employee not found", 404)
            if "full_name" in changes:
                name = changes["full_name"].strip()
                if not name or len(name) > 120:
                    fail("Name must be 1 to 120 characters", 422)
                cx.execute("UPDATE users SET name=? WHERE id=?", (name, target_id))
            if changes.get("employee_id") and changes["employee_id"] != person["employee_id"]:
                fail("The employee ID is linked to payroll records and cannot be changed", 409)
            for field in ("is_active", "role"):
                if field in changes and not self._is_admin(user):
                    fail("Only administrators can change access", 403)
            if "is_active" in changes:
                if own and not changes["is_active"]:
                    fail("You cannot deactivate your own account", 409)
                cx.execute("INSERT INTO profiles(user_id,is_active,created_at) VALUES(?,?,?) "
                           "ON CONFLICT(user_id) DO UPDATE SET is_active=excluded.is_active",
                           (target_id, int(bool(changes["is_active"])), stamp()))
                if not changes["is_active"]:
                    cx.execute("DELETE FROM sessions WHERE user_id=?", (target_id,))
            if "role" in changes:
                role = "reviewer" if changes["role"] == "admin" else "employee"
                if role == "employee" and person["role"] == "admin" and cx.execute(
                        "SELECT COUNT(*) c FROM users WHERE role='reviewer' AND id!=?",
                        (AGENT_ID,)).fetchone()["c"] <= 1:
                    fail("At least one administrator is required", 409)
                cx.execute("UPDATE users SET role=? WHERE id=?", (role, target_id))
            audit(cx, user["id"], "employee_updated", target_id, {"fields": sorted(changes)})
            return self._employee(cx, target_id)

    # ----------------------------------------------------------- office / GeoPulse
    def office(self):
        with self.db.connect() as cx:
            return dict(cx.execute("SELECT * FROM office_settings WHERE id=1").fetchone())

    def set_office(self, user, values):
        reviewer(user)
        with self.db.transaction() as cx:
            current = dict(cx.execute("SELECT * FROM office_settings WHERE id=1").fetchone())
            merged = {**current, **{k: v for k, v in values.items() if v is not None
                                    or k in ("latitude", "longitude")}}
            if (merged["latitude"] is None) != (merged["longitude"] is None):
                fail("Set both latitude and longitude", 422)
            cx.execute(
                """UPDATE office_settings SET office_name=?,latitude=?,longitude=?,radius_m=?,
                max_accuracy_m=?,break_reminder_min=? WHERE id=1""",
                (merged["office_name"].strip() or "Main office", merged["latitude"],
                 merged["longitude"], merged["radius_m"], merged["max_accuracy_m"],
                 merged["break_reminder_min"]))
            audit(cx, user["id"], "office_settings_updated", "office",
                  {"radius_m": merged["radius_m"], "configured": merged["latitude"] is not None})
            return dict(cx.execute("SELECT * FROM office_settings WHERE id=1").fetchone())

    def _active(self, cx, user):
        row = cx.execute("SELECT COALESCE(is_active,1) a FROM users u LEFT JOIN profiles p "
                         "ON p.user_id=u.id WHERE u.id=?", (user["id"],)).fetchone()
        if not row or not row["a"]:
            fail("Account is not active", 403)

    def _verify(self, cx, user, lat, lng, accuracy, purpose):
        self._active(cx, user)
        office = dict(cx.execute("SELECT * FROM office_settings WHERE id=1").fetchone())
        status, distance = classify(office, lat, lng, accuracy)
        cx.execute("INSERT INTO location_logs VALUES(?,?,?,?,?,?,?,?,?)", (
            uid("loc-"), user["id"], lat, lng, accuracy, distance, purpose[:20], status, stamp()))
        return {"status": status, "distance_m": None if distance is None else round(distance, 1),
                "radius_m": office["radius_m"], "office_name": office["office_name"],
                "max_accuracy_m": office["max_accuracy_m"], "accuracy_m": accuracy}

    def verify_location(self, user, lat, lng, accuracy, purpose="verify"):
        with self.db.transaction() as cx:
            return self._verify(cx, user, lat, lng, accuracy, purpose)

    def location_logs(self, user, limit=50):
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute(
                "SELECT * FROM location_logs WHERE employee_id=? ORDER BY recorded_at DESC LIMIT ?",
                (user["id"], limit))]

    def _refusal(self, v):
        status = v["status"]
        if status == "unconfigured":
            return "The office location has not been set up yet. An administrator must set it in Settings."
        if status == "low_accuracy":
            return (f"GPS accuracy is ±{round(v['accuracy_m'])} m but ±{v['max_accuracy_m']} m is "
                    "required. Move near a window or outdoors and try again.")
        if status == "uncertain":
            return (f"Uncertain: you are about {round(v['distance_m'])} m from {v['office_name']} and "
                    f"your GPS error (±{round(v['accuracy_m'] or 0)} m) crosses the boundary. "
                    "Move closer to the centre and try again.")
        return f"You are {round(v['distance_m'])} m from {v['office_name']} (allowed {v['radius_m']} m)."

    def punch(self, user, kind, lat, lng, accuracy, captured_at=None, event_id=None):
        """Server-validated check in / check out. Idempotent by event id; replays keep their time."""
        if kind not in ("check_in", "check_out"):
            return {"ok": False, "code": "invalid", "message": "Unknown action"}
        received = self.clock()
        try:
            when = _dt(captured_at) if captured_at else received
        except ValueError:
            return {"ok": False, "code": "invalid", "message": "captured_at must be an ISO timestamp"}
        # Event ids are unique per employee: the stored value carries the owner so two people can never collide.
        event_id = f"{user['id']}:{event_id}" if event_id else None
        column = "check_in_event_id" if kind == "check_in" else "check_out_event_id"
        with self.db.transaction() as cx:
            if event_id and cx.execute(f"SELECT 1 FROM attendance WHERE {column}=?", (event_id,)).fetchone():
                return {"ok": True, "code": "duplicate", "message": "This punch was already recorded"}
            if when > received + SYNC_FUTURE or when < received - SYNC_PAST:
                return {"ok": False, "code": "window",
                        "message": "Punch time is outside the allowed 12-hour sync window"}
            v = self._verify(cx, user, lat, lng, accuracy,
                             kind if not captured_at else f"offline_{kind}")
            if v["status"] != "inside":
                return {**v, "ok": False, "code": v["status"], "message": self._refusal(v)}
            when_s, day = when.isoformat(), when.date().isoformat()
            if kind == "check_in":
                if cx.execute("SELECT 1 FROM attendance WHERE employee_id=? AND check_out_time IS NULL",
                              (user["id"],)).fetchone():
                    return {**v, "ok": False, "code": "open_session",
                            "message": "You are already checked in. Check out first."}
                if cx.execute("SELECT 1 FROM attendance WHERE employee_id=? AND attendance_date=?",
                              (user["id"], day)).fetchone():
                    return {**v, "ok": False, "code": "already", "message": "You have already checked in today."}
                row_id = uid("att-")
                cx.execute(
                    """INSERT INTO attendance(id,employee_id,attendance_date,check_in_time,latitude,longitude,
                    location_status,synced_offline,check_in_event_id,server_received_at,created_at)
                    VALUES(?,?,?,?,?,?,'inside',?,?,?,?)""",
                    (row_id, user["id"], day, when_s, lat, lng, int(bool(captured_at)), event_id,
                     received.isoformat(), stamp()))
            else:
                session = cx.execute(
                    "SELECT * FROM attendance WHERE employee_id=? AND check_out_time IS NULL "
                    "ORDER BY check_in_time DESC LIMIT 1", (user["id"],)).fetchone()
                if not session:
                    return {**v, "ok": False, "code": "no_session", "message": "You are not checked in."}
                if when <= _dt(session["check_in_time"]):
                    return {**v, "ok": False, "code": "order", "message": "Check-out must be after check-in."}
                cx.execute("UPDATE breaks SET break_end=? WHERE attendance_id=? AND break_end IS NULL",
                           (when_s, session["id"]))
                hours = self._net_minutes(cx, session["id"], session["check_in_time"], when_s) / 60
                cx.execute(
                    """UPDATE attendance SET check_out_time=?,check_out_latitude=?,check_out_longitude=?,
                    check_out_event_id=?,total_working_hours=?,
                    synced_offline=MAX(synced_offline,?) WHERE id=?""",
                    (when_s, lat, lng, event_id, round(hours, 2), int(bool(captured_at)), session["id"]))
                row_id = session["id"]
            audit(cx, user["id"], f"attendance_{kind}", row_id, {
                "geofence": v["status"], "distance_m": v["distance_m"], "offline_replay": bool(captured_at),
                "captured_at": when_s})
            record = dict(cx.execute("SELECT * FROM attendance WHERE id=?", (row_id,)).fetchone())
        return {**v, "ok": True, "code": "recorded",
                "message": "Checked in" if kind == "check_in" else "Checked out", "attendance": record}

    # ---------------------------------------------------------------- ZenBreak
    def _net_minutes(self, cx, attendance_id, start, end):
        gross = (_dt(end) - _dt(start)).total_seconds() / 60
        taken = 0.0
        for b in cx.execute("SELECT break_start,break_end FROM breaks WHERE attendance_id=?", (attendance_id,)):
            stop = b["break_end"] or end
            taken += max(0.0, (_dt(stop) - _dt(b["break_start"])).total_seconds() / 60)
        return max(0.0, gross - taken)

    def start_break(self, user):
        with self.db.transaction() as cx:
            session = cx.execute("SELECT id FROM attendance WHERE employee_id=? AND check_out_time IS NULL "
                                 "ORDER BY check_in_time DESC LIMIT 1", (user["id"],)).fetchone()
            if not session:
                fail("Check in before starting a break")
            if cx.execute("SELECT 1 FROM breaks WHERE employee_id=? AND break_end IS NULL", (user["id"],)).fetchone():
                fail("A break is already in progress")
            row = {"id": uid("brk-"), "attendance_id": session["id"], "employee_id": user["id"],
                   "break_start": self.clock().isoformat(), "break_end": None}
            cx.execute("INSERT INTO breaks VALUES(:id,:attendance_id,:employee_id,:break_start,:break_end)", row)
            audit(cx, user["id"], "break_started", row["id"], {})
            return row

    def end_break(self, user):
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM breaks WHERE employee_id=? AND break_end IS NULL", (user["id"],)).fetchone()
            if not row:
                fail("No break in progress")
            end = self.clock().isoformat()
            cx.execute("UPDATE breaks SET break_end=? WHERE id=?", (end, row["id"]))
            audit(cx, user["id"], "break_ended", row["id"], {})
            return {**dict(row), "break_end": end}

    def today_status(self, user):
        """Everything the attendance screen shows, computed from saved timestamps (never a browser timer)."""
        now_s = self.clock().isoformat()
        with self.db.connect() as cx:
            latest = cx.execute("SELECT * FROM attendance WHERE employee_id=? ORDER BY check_in_time DESC LIMIT 1",
                                (user["id"],)).fetchone()
            office = dict(cx.execute("SELECT * FROM office_settings WHERE id=1").fetchone())
            if not latest:
                return {"today": None, "active_break": None, "break_minutes": 0, "net_minutes": 0,
                        "continuous_minutes": 0, "reminder_due": False, "breaks": []}
            att = dict(latest)
            breaks = [dict(b) for b in cx.execute(
                "SELECT * FROM breaks WHERE attendance_id=? ORDER BY break_start", (att["id"],))]
            end = att["check_out_time"] or now_s
            taken = sum(max(0.0, (_dt(b["break_end"] or end) - _dt(b["break_start"])).total_seconds() / 60)
                        for b in breaks)
            active = next((b for b in breaks if not b["break_end"]), None)
            open_session = att["check_out_time"] is None
            since = max([_dt(att["check_in_time"])] + [_dt(b["break_end"]) for b in breaks if b["break_end"]])
            continuous = 0.0 if (active or not open_session) else (self.clock() - since).total_seconds() / 60
            return {"today": att, "active_break": active, "break_minutes": round(taken, 1),
                    "net_minutes": round(self._net_minutes(cx, att["id"], att["check_in_time"], end), 1),
                    "continuous_minutes": round(continuous, 1),
                    "reminder_due": open_session and continuous >= office["break_reminder_min"],
                    "breaks": breaks}

    def attendance(self, user, employee_id=None, start=None, end=None, limit=200):
        target = employee_id or user["id"]
        if target != user["id"] and not self._is_admin(user):
            fail("You can only view your own attendance", 403)
        sql, args = "SELECT * FROM attendance WHERE employee_id=?", [target]
        if start:
            sql, args = sql + " AND attendance_date>=?", args + [start]
        if end:
            sql, args = sql + " AND attendance_date<=?", args + [end]
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute(sql + " ORDER BY attendance_date DESC LIMIT ?", args + [limit])]

    def attendance_report(self, user, start, end):
        reviewer(user)
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute(
                "SELECT * FROM attendance WHERE attendance_date BETWEEN ? AND ? ORDER BY attendance_date",
                (start, end))]

    def breaks(self, user, since=None, limit=200):
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute(
                "SELECT * FROM breaks WHERE employee_id=? AND break_start>=? ORDER BY break_start DESC LIMIT ?",
                (user["id"], since or "0000", limit))]

    # --------------------------------------------------------------- SyncShield
    def log_sync(self, user, event):
        with self.db.transaction() as cx:
            cx.execute("INSERT INTO sync_log VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                uid("log-"), event.get("event_id"), user["id"], event["kind"], event.get("captured_at"),
                stamp(), max(1, event.get("attempt", 1)), event["result"],
                (event.get("error") or "")[:500], (event.get("device") or "")[:300], stamp()))
        return {"status": "logged"}

    def sync_log(self, user, limit=500):
        with self.db.connect() as cx:
            sql = ("SELECT s.*,u.name AS full_name,u.employee_id AS employee_code FROM sync_log s "
                   "JOIN users u ON u.id=s.employee_id")
            if self._is_admin(user):
                rows = cx.execute(sql + " ORDER BY s.synced_at DESC LIMIT ?", (limit,))
            else:
                rows = cx.execute(sql + " WHERE s.employee_id=? ORDER BY s.synced_at DESC LIMIT ?",
                                  (user["id"], limit))
            return [dict(r) for r in rows]

    def conflicts(self, user, limit=200):
        with self.db.connect() as cx:
            sql = ("SELECT c.*,u.name AS full_name,u.employee_id AS employee_code FROM sync_conflicts c "
                   "JOIN users u ON u.id=c.employee_id")
            if self._is_admin(user):
                rows = cx.execute(sql + " ORDER BY c.created_at DESC LIMIT ?", (limit,))
            else:
                rows = cx.execute(sql + " WHERE c.employee_id=? ORDER BY c.created_at DESC LIMIT ?",
                                  (user["id"], limit))
            return [dict(r) for r in rows]

    def scan_conflicts(self, user):
        reviewer(user)
        today = self.today()
        queries = [
            ("duplicate_punch", "high", """SELECT employee_id, attendance_date d,
             COUNT(*)||' attendance records exist for this day' det FROM attendance
             GROUP BY employee_id, attendance_date HAVING COUNT(*)>1"""),
            ("missing_checkout", "medium", f"""SELECT employee_id, attendance_date d,
             'Checked in at '||substr(check_in_time,12,5)||' UTC but never checked out' det
             FROM attendance WHERE check_out_time IS NULL AND attendance_date<'{today}'"""),
            ("leave_overlap", "high", """SELECT a.employee_id, a.attendance_date d,
             'Attendance recorded during approved '||l.leave_type||' leave ('||l.start_date||' to '||l.end_date||')' det
             FROM attendance a JOIN leave_requests l ON l.employee_id=a.employee_id
             AND l.approval_status='approved' AND a.attendance_date BETWEEN l.start_date AND l.end_date"""),
            ("location_mismatch", "medium", """SELECT employee_id, attendance_date d,
             'Punch recorded with location status "'||location_status||'"' det
             FROM attendance WHERE location_status='outside'"""),
        ]
        found = 0
        with self.db.transaction() as cx:
            for kind, severity, sql in queries:
                for row in cx.execute(sql).fetchall():
                    cur = cx.execute(
                        "INSERT OR IGNORE INTO sync_conflicts(id,employee_id,conflict_type,conflict_date,details,"
                        "severity,status,created_at) VALUES(?,?,?,?,?,?,'open',?)",
                        (uid("cf-"), row["employee_id"], kind, row["d"], row["det"], severity, stamp()))
                    found += cur.rowcount
            audit(cx, user["id"], "sync_conflicts_scanned", "sync", {"new": found})
        return {"ok": True, "new_conflicts": found, "scanned_at": stamp()}

    def resolve_conflict(self, user, conflict_id, action):
        reviewer(user)
        if action not in ("resolved", "rejected"):
            fail("Action must be resolved or rejected", 422)
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM sync_conflicts WHERE id=? AND status='open'", (conflict_id,)).fetchone()
            if not row:
                return {"ok": False, "message": "Conflict not found or already closed"}
            cx.execute("UPDATE sync_conflicts SET status=?,resolved_by=?,resolved_at=? WHERE id=?",
                       (action, user["id"], stamp(), conflict_id))
            cx.execute("INSERT INTO sync_log VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
                uid("log-"), None, row["employee_id"], "check_in", None, stamp(), 1, "correction",
                f"Conflict {row['conflict_type']} ({row['conflict_date'] or 'no date'}) marked {action}",
                f"admin:{user['id']}", stamp()))
            audit(cx, user["id"], "sync_conflict_resolved", conflict_id, {"action": action})
        return {"ok": True, "message": f"Conflict marked as {action}"}

    # ------------------------------------------------------------------ RotaFlow
    def _leave_on(self, cx, employee_id, day):
        return cx.execute(
            """SELECT 1 FROM leave_requests WHERE employee_id=? AND approval_status='approved'
            AND start_date<=? AND end_date>=?""", (employee_id, day, day)).fetchone() is not None

    def shifts(self, user, start=None, end=None, mine=False, limit=500):
        sql = ("SELECT s.*,u.name AS full_name FROM shift_schedules s JOIN users u ON u.id=s.employee_id "
               "WHERE s.assigned_date>=? AND s.assigned_date<=?")
        args = [start or self.today(), end or "9999-12-31"]
        if mine or not self._is_admin(user):
            sql, args = sql + " AND s.employee_id=?", args + [user["id"]]
        with self.db.connect() as cx:
            return [{**dict(r), "employee": {"full_name": r["full_name"]}} for r in cx.execute(
                sql + " ORDER BY s.assigned_date,s.shift_start LIMIT ?", args + [limit])]

    def save_shift(self, user, employee_id, day, start, end):
        reviewer(user)
        start, end = _hhmm(start, "Start"), _hhmm(end, "End")
        try:
            date.fromisoformat(day)
        except ValueError:
            fail("Date must look like 2026-11-09", 422)
        if end <= start:
            fail("The shift must end after it starts", 422)
        with self.db.transaction() as cx:
            person = self._employee(cx, employee_id)
            if not person or not person["is_active"]:
                fail("Choose an active employee", 422)
            if self._leave_on(cx, employee_id, day):
                fail(f"{person['full_name']} has approved leave on {day}; the shift was not saved", 409)
            existing = cx.execute("SELECT id FROM shift_schedules WHERE employee_id=? AND assigned_date=?",
                                  (employee_id, day)).fetchone()
            if existing:
                cx.execute("UPDATE shift_schedules SET shift_start=?,shift_end=? WHERE id=?",
                           (start, end, existing["id"]))
                shift_id = existing["id"]
            else:
                shift_id = uid("shf-")
                cx.execute("INSERT INTO shift_schedules VALUES(?,?,?,?,?,?)",
                           (shift_id, employee_id, day, start, end, stamp()))
            audit(cx, user["id"], "shift_saved", shift_id,
                  {"employee": employee_id, "date": day, "start": start, "end": end})
            return dict(cx.execute("SELECT * FROM shift_schedules WHERE id=?", (shift_id,)).fetchone())

    def delete_shift(self, user, shift_id):
        reviewer(user)
        with self.db.transaction() as cx:
            cx.execute("DELETE FROM shift_swap_requests WHERE shift_id=?", (shift_id,))
            if not cx.execute("DELETE FROM shift_schedules WHERE id=?", (shift_id,)).rowcount:
                fail("Shift not found", 404)
            audit(cx, user["id"], "shift_deleted", shift_id, {})
        return {"status": "deleted"}

    def _swap_rows(self, cx, where="", args=()):
        rows = cx.execute(
            f"""SELECT w.*,s.assigned_date,s.shift_start,s.shift_end,r.name AS requester_name,
            t.name AS target_name FROM shift_swap_requests w JOIN shift_schedules s ON s.id=w.shift_id
            JOIN users r ON r.id=w.requester_id LEFT JOIN users t ON t.id=w.target_employee_id
            {where} ORDER BY w.created_at DESC""", args)
        return [{**dict(r),
                 "shift": {"assigned_date": r["assigned_date"], "shift_start": r["shift_start"],
                           "shift_end": r["shift_end"]},
                 "requester": {"full_name": r["requester_name"]},
                 "target": {"full_name": r["target_name"]} if r["target_name"] else None}
                for r in rows]

    def swaps(self, user):
        with self.db.connect() as cx:
            if self._is_admin(user):
                return self._swap_rows(cx)
            return self._swap_rows(cx, "WHERE w.requester_id=? OR w.target_employee_id=?", (user["id"], user["id"]))

    def request_swap(self, user, shift_id, target_id, reason):
        with self.db.transaction() as cx:
            shift = cx.execute("SELECT * FROM shift_schedules WHERE id=? AND employee_id=?",
                               (shift_id, user["id"])).fetchone()
            if not shift:
                fail("You can only request a swap for your own shift", 403)
            if shift["assigned_date"] < self.today():
                fail("That shift is in the past", 409)
            if cx.execute("SELECT 1 FROM shift_swap_requests WHERE shift_id=? AND status='pending'",
                          (shift_id,)).fetchone():
                fail("A swap is already pending for this shift")
            if target_id:
                self._check_target(cx, target_id, shift, user["id"])
            swap_id = uid("swp-")
            cx.execute("INSERT INTO shift_swap_requests VALUES(?,?,?,?,?,'pending',NULL,?)",
                       (swap_id, shift_id, user["id"], target_id, reason[:500], stamp()))
            audit(cx, user["id"], "swap_requested", swap_id, {"shift": shift_id, "target": target_id})
            return {"id": swap_id, "status": "pending"}

    def _check_target(self, cx, target_id, shift, requester_id):
        person = self._employee(cx, target_id)
        if not person or not person["is_active"] or target_id == requester_id:
            fail("Choose a different active colleague", 422)
        if cx.execute("SELECT 1 FROM shift_schedules WHERE employee_id=? AND assigned_date=?",
                      (target_id, shift["assigned_date"])).fetchone():
            fail(f"{person['full_name']} already has a shift on {shift['assigned_date']}", 409)
        if self._leave_on(cx, target_id, shift["assigned_date"]):
            fail(f"{person['full_name']} has approved leave on {shift['assigned_date']}", 409)

    def review_swap(self, user, swap_id, status):
        reviewer(user)
        if status not in ("approved", "rejected"):
            fail("Status must be approved or rejected", 422)
        with self.db.transaction() as cx:
            swap = cx.execute("SELECT * FROM shift_swap_requests WHERE id=? AND status='pending'", (swap_id,)).fetchone()
            if not swap:
                fail("Swap request not found or already decided", 404)
            if swap["requester_id"] == user["id"]:
                fail("You cannot decide your own swap request", 403)
            if status == "approved":
                if not swap["target_employee_id"]:
                    fail("Choose a colleague for this swap before approving", 409)
                shift = cx.execute("SELECT * FROM shift_schedules WHERE id=?", (swap["shift_id"],)).fetchone()
                if shift["employee_id"] != swap["requester_id"]:
                    fail("The shift has moved to someone else since this request; reject it and ask again", 409)
                self._check_target(cx, swap["target_employee_id"], shift, swap["requester_id"])
                cx.execute("UPDATE shift_schedules SET employee_id=? WHERE id=?",
                           (swap["target_employee_id"], swap["shift_id"]))
            cx.execute("UPDATE shift_swap_requests SET status=?,reviewed_by=? WHERE id=?",
                       (status, user["id"], swap_id))
            audit(cx, user["id"], f"swap_{status}", swap_id, {"shift": swap["shift_id"]})
        return {"status": status}

    def assign_swap_target(self, user, swap_id, target_id):
        reviewer(user)
        with self.db.transaction() as cx:
            swap = cx.execute("SELECT * FROM shift_swap_requests WHERE id=? AND status='pending'", (swap_id,)).fetchone()
            if not swap:
                fail("Swap request not found or already decided", 404)
            shift = cx.execute("SELECT * FROM shift_schedules WHERE id=?", (swap["shift_id"],)).fetchone()
            self._check_target(cx, target_id, shift, swap["requester_id"])
            cx.execute("UPDATE shift_swap_requests SET target_employee_id=? WHERE id=?", (target_id, swap_id))
        return {"status": "assigned"}

    def cancel_swap(self, user, swap_id):
        with self.db.transaction() as cx:
            if not cx.execute("DELETE FROM shift_swap_requests WHERE id=? AND requester_id=? AND status='pending'",
                              (swap_id, user["id"])).rowcount:
                fail("Only your own pending requests can be cancelled", 403)
        return {"status": "cancelled"}

    # ----------------------------------------------------------------- LeaveSync
    def leave_policy(self):
        with self.db.connect() as cx:
            return dict(cx.execute("SELECT * FROM leave_policy WHERE id=1").fetchone())

    def update_policy(self, user, values):
        reviewer(user)
        with self.db.transaction() as cx:
            current = dict(cx.execute("SELECT * FROM leave_policy WHERE id=1").fetchone())
            merged = {**current, **{k: v for k, v in values.items() if v is not None}}
            cx.execute("""UPDATE leave_policy SET annual_days=?,casual_days=?,sick_days=?,unpaid_days=?,
                       max_consecutive_days=?,min_staff_pct=?,updated_at=? WHERE id=1""",
                       (merged["annual_days"], merged["casual_days"], merged["sick_days"], merged["unpaid_days"],
                        merged["max_consecutive_days"], merged["min_staff_pct"], stamp()))
            audit(cx, user["id"], "leave_policy_updated", "leave_policy", values)
        return self.leave_policy()

    def holidays(self):
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute("SELECT * FROM holidays ORDER BY holiday_date")]

    def add_holiday(self, user, day, name):
        reviewer(user)
        try:
            date.fromisoformat(day)
        except ValueError:
            fail("Date must look like 2026-12-25", 422)
        with self.db.transaction() as cx:
            if cx.execute("SELECT 1 FROM holidays WHERE holiday_date=?", (day,)).fetchone():
                fail("That date is already a holiday")
            hid = uid("hol-")
            cx.execute("INSERT INTO holidays VALUES(?,?,?)", (hid, day, name.strip()))
            audit(cx, user["id"], "holiday_added", hid, {"date": day})
            return {"id": hid, "holiday_date": day, "name": name.strip()}

    def delete_holiday(self, user, holiday_id):
        reviewer(user)
        with self.db.transaction() as cx:
            if not cx.execute("DELETE FROM holidays WHERE id=?", (holiday_id,)).rowcount:
                fail("Holiday not found", 404)
            audit(cx, user["id"], "holiday_deleted", holiday_id, {})
        return {"status": "deleted"}

    def balances(self, user, employee_id=None, year=None):
        target = employee_id or user["id"]
        if target != user["id"] and not self._is_admin(user):
            fail("You can only view your own balance", 403)
        year = year or self.clock().year
        policy = self.leave_policy()
        holidays = [h["holiday_date"] for h in self.holidays()]
        out = {}
        with self.db.connect() as cx:
            rows = cx.execute(
                """SELECT * FROM leave_requests WHERE employee_id=? AND approval_status IN ('approved','pending')
                AND substr(start_date,1,4)=?""", (target, str(year))).fetchall()
        for kind, field in LEAVE_ALLOWANCE.items():
            used = sum(request_days(r, holidays) for r in rows if r["leave_type"] == kind and r["approval_status"] == "approved")
            pending = sum(request_days(r, holidays) for r in rows if r["leave_type"] == kind and r["approval_status"] == "pending")
            out[kind] = {"allowance": policy[field], "used": used, "pending": pending,
                         "remaining": policy[field] - used - pending}
        return out

    def leave_requests(self, user, status=None):
        sql = ("SELECT l.*,u.name AS full_name,u.employee_id AS employee_code FROM leave_requests l "
               "JOIN users u ON u.id=l.employee_id")
        args, where = [], []
        if not self._is_admin(user):
            where.append("l.employee_id=?")
            args.append(user["id"])
        if status:
            where.append("l.approval_status=?")
            args.append(status)
        if where:
            sql += " WHERE " + " AND ".join(where)
        with self.db.connect() as cx:
            return [{**dict(r), "emergency": bool(r["emergency"]),
                     "employee": {"full_name": r["full_name"], "employee_id": r["employee_code"], "profile_image": None}}
                    for r in cx.execute(sql + " ORDER BY l.created_at DESC", args)]

    def request_leave(self, user, body):
        start, end = body["start_date"], body.get("end_date") or body["start_date"]
        try:
            first, last = date.fromisoformat(start), date.fromisoformat(end)
        except ValueError:
            fail("Dates must look like 2026-11-12", 422)
        if last < first:
            fail("End date must be on or after start date", 422)
        if first.year != last.year:
            fail("Leave that crosses New Year must be requested as two requests, one per year", 422)
        duration = body.get("duration", "full")
        if duration != "full" and start != end:
            fail("Half-day and hourly leave must be a single day", 422)
        hours = body.get("hours")
        if duration == "hourly" and not (hours and 0 < hours <= 8):
            fail("Enter the number of hours (up to 8)", 422)
        policy = self.leave_policy()
        if (last - first).days + 1 > policy["max_consecutive_days"]:
            fail(f"Leave cannot exceed {policy['max_consecutive_days']} consecutive days", 422)
        holidays = [h["holiday_date"] for h in self.holidays()]
        row = {"duration": duration, "hours": hours, "start_date": start, "end_date": end}
        days = request_days(row, holidays)
        if days <= 0:
            fail("The selected dates contain no working days", 422)
        with self.db.transaction() as cx:
            if cx.execute(
                    """SELECT 1 FROM leave_requests WHERE employee_id=? AND approval_status IN ('pending','approved')
                    AND start_date<=? AND end_date>=?""", (user["id"], end, start)).fetchone():
                fail("This overlaps another pending or approved leave request")
            kind = body["leave_type"]
            if kind in LEAVE_ALLOWANCE:
                left = self.balances(user, year=first.year)[kind]["remaining"]
                if days > left:
                    fail(f"Only {left:g} {kind} day(s) remain; this request needs {days:g}")
            lid = uid("lv-")
            cx.execute(
                """INSERT INTO leave_requests(id,employee_id,leave_type,start_date,end_date,reason,duration,hours,
                emergency,approval_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?)""",
                (lid, user["id"], kind, start, end, body.get("reason", "").strip()[:1000], duration, hours,
                 int(bool(body.get("emergency"))), stamp()))
            audit(cx, user["id"], "leave_requested", lid, {"type": kind, "days": days})
            return {"id": lid, "approval_status": "pending", "days": days}

    def review_leave(self, user, leave_id, status, comment=""):
        reviewer(user)
        if status not in ("approved", "rejected"):
            fail("Status must be approved or rejected", 422)
        with self.db.transaction() as cx:
            row = cx.execute("SELECT * FROM leave_requests WHERE id=?", (leave_id,)).fetchone()
            if not row:
                fail("Leave request not found", 404)
            if row["approval_status"] != "pending":
                fail("This request has already been decided")
            if row["employee_id"] == user["id"]:
                fail("You cannot decide your own leave request", 403)
            warnings = []
            if status == "approved":
                affected = cx.execute(
                    "SELECT assigned_date FROM shift_schedules WHERE employee_id=? AND assigned_date BETWEEN ? AND ?",
                    (row["employee_id"], row["start_date"], row["end_date"])).fetchall()
                if affected:
                    warnings.append(f"{len(affected)} scheduled shift(s) fall inside this leave and need cover.")
                policy = dict(cx.execute("SELECT * FROM leave_policy WHERE id=1").fetchone())
                total = cx.execute("SELECT COUNT(*) c FROM users u LEFT JOIN profiles p ON p.user_id=u.id "
                                   "WHERE u.id!=? AND COALESCE(p.is_active,1)=1", (AGENT_ID,)).fetchone()["c"]
                day = date.fromisoformat(row["start_date"])
                while day <= date.fromisoformat(row["end_date"]):
                    off = cx.execute("""SELECT COUNT(DISTINCT employee_id) c FROM leave_requests
                                     WHERE approval_status='approved' AND start_date<=? AND end_date>=?""",
                                     (day.isoformat(), day.isoformat())).fetchone()["c"] + 1
                    if total and (total - off) / total * 100 < policy["min_staff_pct"]:
                        warnings.append(f"Staffing on {day} would fall below {policy['min_staff_pct']}%.")
                        break
                    day += timedelta(days=1)
            cx.execute("UPDATE leave_requests SET approval_status=?,reviewed_by=?,reviewed_at=?,manager_comment=? WHERE id=?",
                       (status, user["id"], stamp(), comment[:500] or None, leave_id))
            audit(cx, user["id"], f"leave_{status}", leave_id, {"employee": row["employee_id"], "comment": comment[:200]})
        return {"status": status, "warnings": warnings}

    def cancel_leave(self, user, leave_id):
        with self.db.transaction() as cx:
            if not cx.execute("DELETE FROM leave_requests WHERE id=? AND employee_id=? AND approval_status='pending'",
                              (leave_id, user["id"])).rowcount:
                fail("Only your own pending requests can be cancelled", 403)
            audit(cx, user["id"], "leave_cancelled", leave_id, {})
        return {"status": "cancelled"}

    def team_calendar(self, user, start, end):
        with self.db.connect() as cx:
            rows = [dict(r) for r in cx.execute(
                """SELECT l.employee_id,u.name AS full_name,l.start_date,l.end_date,l.approval_status,l.leave_type
                FROM leave_requests l JOIN users u ON u.id=l.employee_id
                WHERE l.approval_status IN ('approved','pending') AND l.start_date<=? AND l.end_date>=?""", (end, start))]
        if not self._is_admin(user):  # colleagues see who is away, never why (sick leave is private)
            for row in rows:
                if row["employee_id"] != user["id"]:
                    row["leave_type"] = "other"
        return rows

    # ----------------------------------------------------------------- TaskForge
    def tasks(self, user):
        sql = "SELECT * FROM tasks"
        args = ()
        if not self._is_admin(user):
            sql, args = sql + " WHERE assignee_id=?", (user["id"],)
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute(sql + " ORDER BY created_at DESC", args)]

    def create_task(self, user, body):
        reviewer(user)
        title = body["title"].strip()
        if not title:
            fail("Title is required", 422)
        with self.db.transaction() as cx:
            if body.get("assignee_id") and not self._employee(cx, body["assignee_id"]):
                fail("Assignee not found", 422)
            tid = uid("tsk-")
            cx.execute("""INSERT INTO tasks(id,title,project,tag,priority,status,progress,assignee_id,due_date,created_by,created_at)
                       VALUES(?,?,?,?,?,'todo',0,?,?,?,?)""",
                       (tid, title[:200], (body.get("project") or "General").strip()[:80],
                        (body.get("tag") or "Feature").strip()[:40], body.get("priority", "medium"),
                        body.get("assignee_id"), body.get("due_date"), user["id"], stamp()))
            audit(cx, user["id"], "task_created", tid, {"assignee": body.get("assignee_id")})
            return dict(cx.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone())

    def update_task(self, user, task_id, changes):
        with self.db.transaction() as cx:
            task = cx.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
            if not task:
                fail("Task not found", 404)
            admin = self._is_admin(user)
            if not admin and task["assignee_id"] != user["id"]:
                fail("You can only update tasks assigned to you", 403)
            detail_fields = {"title", "project", "tag", "priority", "assignee_id", "due_date"}
            if not admin and detail_fields & set(changes):
                fail("Only administrators can change task details", 403)
            if changes.get("assignee_id") and not self._employee(cx, changes["assignee_id"]):
                fail("Assignee not found", 422)
            values = {**dict(task), **changes}
            if values["status"] == "completed" and task["status"] != "completed":
                values["completed_at"], values["progress"] = stamp(), 100
            elif values["status"] != "completed":
                values["completed_at"] = None
            cx.execute("""UPDATE tasks SET title=?,project=?,tag=?,priority=?,status=?,progress=?,assignee_id=?,
                       due_date=?,completed_at=? WHERE id=?""",
                       (values["title"], values["project"], values["tag"], values["priority"], values["status"],
                        values["progress"], values["assignee_id"], values["due_date"], values["completed_at"], task_id))
            if changes.get("status") and changes["status"] != task["status"]:
                audit(cx, user["id"], "task_status_changed", task_id, {"from": task["status"], "to": changes["status"]})
            return dict(cx.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone())

    def delete_task(self, user, task_id):
        reviewer(user)
        with self.db.transaction() as cx:
            cx.execute("DELETE FROM tasks WHERE id=?", (task_id,))
            audit(cx, user["id"], "task_deleted", task_id, {})
        return {"status": "deleted"}

    # ----------------------------------------------------------------- dashboard
    def kpis(self, user):
        reviewer(user)
        today = date.fromisoformat(self.today())
        with self.db.connect() as cx:
            def one(sql, *args):
                return cx.execute(sql, args).fetchone()[0]
            total = one("SELECT COUNT(*) FROM users u LEFT JOIN profiles p ON p.user_id=u.id "
                        "WHERE u.id!=? AND COALESCE(p.is_active,1)=1", AGENT_ID)
            return {
                "total_employees": total,
                "present_today": one("SELECT COUNT(DISTINCT employee_id) FROM attendance WHERE attendance_date=?", today.isoformat()),
                "present_last_week": one("SELECT COUNT(DISTINCT employee_id) FROM attendance WHERE attendance_date=?",
                                         (today - timedelta(days=7)).isoformat()),
                "on_leave": one("SELECT COUNT(*) FROM leave_requests WHERE approval_status='approved' "
                                "AND start_date<=? AND end_date>=?", today.isoformat(), today.isoformat()),
                "on_leave_yesterday": one("SELECT COUNT(*) FROM leave_requests WHERE approval_status='approved' "
                                          "AND start_date<=? AND end_date>=?", (today - timedelta(days=1)).isoformat(),
                                          (today - timedelta(days=1)).isoformat()),
                "pending_leave": one("SELECT COUNT(*) FROM leave_requests WHERE approval_status='pending'"),
                "pending_swaps": one("SELECT COUNT(*) FROM shift_swap_requests WHERE status='pending'"),
                "open_conflicts": one("SELECT COUNT(*) FROM sync_conflicts WHERE status='open'"),
            }

    def trend(self, user, days=7):
        reviewer(user)
        today = date.fromisoformat(self.today())
        out = []
        with self.db.connect() as cx:
            total = cx.execute("SELECT COUNT(*) FROM users u LEFT JOIN profiles p ON p.user_id=u.id "
                               "WHERE u.id!=? AND COALESCE(p.is_active,1)=1", (AGENT_ID,)).fetchone()[0]
            for back in range(max(days, 1) - 1, -1, -1):
                day = (today - timedelta(days=back)).isoformat()
                present = cx.execute("SELECT COUNT(DISTINCT employee_id) FROM attendance WHERE attendance_date=?",
                                     (day,)).fetchone()[0]
                out.append({"day": day, "present": present, "rate": round(present / total * 100, 1) if total else 0})
        return out

    def departments(self, user):
        reviewer(user)
        with self.db.connect() as cx:
            return [{"department": r["d"], "n": r["n"]} for r in cx.execute(
                """SELECT COALESCE(NULLIF(p.department,''),'Unassigned') d,COUNT(*) n FROM users u
                LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id!=? AND COALESCE(p.is_active,1)=1
                GROUP BY 1 ORDER BY 2 DESC""", (AGENT_ID,))]

    def my_week(self, user, days=7):
        today = date.fromisoformat(self.today())
        with self.db.connect() as cx:
            return [dict(r) for r in cx.execute(
                "SELECT attendance_date,total_working_hours FROM attendance WHERE employee_id=? AND attendance_date>? "
                "ORDER BY attendance_date", (user["id"], (today - timedelta(days=days)).isoformat()))]

    # --------------------------------------------------------------------- seed
    def seed(self):
        """Departments from the payroll roster plus a believable fortnight of demo activity."""
        from .data import generate
        with self.db.transaction() as cx:
            if cx.execute("SELECT 1 FROM meta WHERE key='workforce_seed'").fetchone():
                return
            rng = random.Random(42)
            cards, _, _ = generate()
            departments = {c.employee.id: c.employee.department for c in cards}
            people = [r["id"] for r in cx.execute("SELECT id FROM users WHERE role='employee' AND id!=? ORDER BY id", (AGENT_ID,))]
            for row in cx.execute("SELECT id FROM users WHERE id!=?", (AGENT_ID,)).fetchall():
                cx.execute("INSERT OR IGNORE INTO profiles(user_id,department,is_active,created_at) VALUES(?,?,1,?)",
                           (row["id"], departments.get(row["id"], "Operations"), stamp()))
            if len(people) < 6:  # too small for the demo fortnight; profiles are enough
                cx.execute("INSERT INTO meta VALUES('workforce_seed','1')")
                return
            today = self.clock().date()
            for back in range(14, 0, -1):
                day = today - timedelta(days=back)
                if day.weekday() >= 5:
                    continue
                for person in people:
                    if rng.random() > 0.86:
                        continue
                    start = datetime.combine(day, time(8, 50), timezone.utc) + timedelta(minutes=rng.randint(0, 50))
                    end = datetime.combine(day, time(17, 0), timezone.utc) + timedelta(minutes=rng.randint(0, 75))
                    rest = rng.choice([20, 30, 45])
                    aid = uid("att-")
                    cx.execute("""INSERT INTO attendance(id,employee_id,attendance_date,check_in_time,check_out_time,
                               location_status,total_working_hours,synced_offline,server_received_at,created_at)
                               VALUES(?,?,?,?,?,'inside',?,0,?,?)""",
                               (aid, person, day.isoformat(), start.isoformat(), end.isoformat(),
                                round(((end - start).total_seconds() / 60 - rest) / 60, 2), end.isoformat(), stamp()))
                    cx.execute("INSERT INTO breaks VALUES(?,?,?,?,?)", (
                        uid("brk-"), aid, person, (start + timedelta(hours=4)).isoformat(),
                        (start + timedelta(hours=4, minutes=rest)).isoformat()))
            for back in range(0, 1):
                day = today - timedelta(days=back)
                if day.weekday() < 5:
                    for person in people[: int(len(people) * 0.6)]:
                        start = datetime.combine(day, time(8, 55), timezone.utc) + timedelta(minutes=rng.randint(0, 40))
                        if start > self.clock():
                            continue
                        cx.execute("""INSERT INTO attendance(id,employee_id,attendance_date,check_in_time,location_status,
                                   synced_offline,server_received_at,created_at) VALUES(?,?,?,?,'inside',0,?,?)""",
                                   (uid("att-"), person, day.isoformat(), start.isoformat(), start.isoformat(), stamp()))
            for ahead in range(0, 21):
                day = today + timedelta(days=ahead)
                if day.weekday() >= 5:
                    continue
                for person in people:
                    cx.execute("INSERT OR IGNORE INTO shift_schedules VALUES(?,?,?,?,?,?)",
                               (uid("shf-"), person, day.isoformat(), "09:00", "17:00", stamp()))
            # This week's pressure points: a few people pick up a Saturday, a few have Friday off.
            non_exempt = sorted(c.employee.id for c in cards if c.employee.employment.value != "salaried_exempt")
            non_exempt = [i for i in dict.fromkeys(non_exempt) if i in people]
            monday = today - timedelta(days=today.weekday())
            for person in non_exempt[:7]:
                saturday = monday + timedelta(days=5)
                if saturday >= today:
                    cx.execute("INSERT OR IGNORE INTO shift_schedules VALUES(?,?,?,?,?,?)",
                               (uid("shf-"), person, saturday.isoformat(), "09:00", "16:00", stamp()))
            for person in non_exempt[7:13]:
                cx.execute("DELETE FROM shift_schedules WHERE employee_id=? AND assigned_date=?",
                           (person, (monday + timedelta(days=4)).isoformat()))
            for h_date, name in (("2026-11-26", "Thanksgiving"), ("2026-12-25", "Christmas Day")):
                cx.execute("INSERT OR IGNORE INTO holidays VALUES(?,?,?)", (uid("hol-"), h_date, name))
            demo_leave = [
                (people[1], "annual", 3, 4, "approved", "Family trip"),
                (people[2], "sick", 0, 0, "approved", "Flu"),
                (people[3], "personal", 8, 8, "pending", "Moving house"),
                (people[4], "annual", 10, 12, "pending", "Wedding"),
                (people[5], "unpaid", 5, 5, "rejected", "Extended weekend"),
            ]
            for person, kind, a, b, status, reason in demo_leave:
                first, last = today + timedelta(days=a), today + timedelta(days=b)
                cx.execute("""INSERT INTO leave_requests(id,employee_id,leave_type,start_date,end_date,reason,approval_status,
                           reviewed_by,reviewed_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                           (uid("lv-"), person, kind, first.isoformat(), last.isoformat(), reason, status,
                            "avery" if status != "pending" else None, stamp() if status != "pending" else None, stamp()))
            for i, (title, project, tag, priority, status, offset) in enumerate((
                    ("Prepare weekly QA report", "Quality", "Report", "high", "in_progress", 3),
                    ("Review October timecard exceptions", "Payroll", "Review", "high", "todo", 2),
                    ("Update onboarding checklist", "People", "Docs", "medium", "todo", 6),
                    ("Audit geofence radius at main office", "Facilities", "Audit", "medium", "review", 4),
                    ("Close pay period 2026-10-19", "Payroll", "Close", "high", "todo", 5),
                    ("Refresh shift swap policy", "People", "Policy", "low", "completed", -1))):
                cx.execute("""INSERT INTO tasks(id,title,project,tag,priority,status,progress,assignee_id,due_date,created_by,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                           (uid("tsk-"), title, project, tag, priority, status,
                            100 if status == "completed" else 40 if status == "in_progress" else 0,
                            people[i % len(people)], (today + timedelta(days=offset)).isoformat(), "avery", stamp()))
            cx.execute("INSERT INTO meta VALUES('workforce_seed','1')")
