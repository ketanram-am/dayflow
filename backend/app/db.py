from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3

from .domain import canonical

SCHEMA = """
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('reviewer','employee')), employee_id TEXT,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, expires TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, revision INTEGER NOT NULL,
 payload TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies(
 id TEXT PRIMARY KEY, version TEXT UNIQUE NOT NULL, document TEXT NOT NULL,
 content_hash TEXT NOT NULL, source_hash TEXT NOT NULL, created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_signatures(
 policy_id TEXT PRIMARY KEY REFERENCES policies(id), signer TEXT NOT NULL,
 signed_at TEXT NOT NULL, content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals(
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id),
 author TEXT NOT NULL REFERENCES users(id), correction TEXT NOT NULL,
 input_hash TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES policies(id),
 state TEXT NOT NULL CHECK(state IN ('proposed','manual_review','verified','committed','rejected')),
 proof TEXT, created_at TEXT NOT NULL, parent_id TEXT REFERENCES proposals(id)
);
CREATE TABLE IF NOT EXISTS attestations(
 id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(id),
 actor TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('employee_confirmation','manager_attestation')),
 reason TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals(
 id TEXT PRIMARY KEY, proposal_id TEXT UNIQUE REFERENCES proposals(id),
 actor TEXT NOT NULL REFERENCES users(id), proof_hash TEXT NOT NULL,
 proof TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS write_permits(
 card_id TEXT PRIMARY KEY REFERENCES cards(id), old_revision INTEGER NOT NULL,
 new_hash TEXT NOT NULL, approval_id TEXT NOT NULL REFERENCES approvals(id)
);
CREATE TABLE IF NOT EXISTS disputes(
 id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id),
 actor TEXT NOT NULL REFERENCES users(id), line_id TEXT, revision INTEGER NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispute_resolutions(
 dispute_id TEXT PRIMARY KEY REFERENCES disputes(id), actor TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS investigations(
 id TEXT PRIMARY KEY, card_id TEXT REFERENCES cards(id), actor TEXT NOT NULL,
 result TEXT NOT NULL, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs(
 id TEXT PRIMARY KEY, started_by TEXT NOT NULL REFERENCES users(id), mode TEXT NOT NULL,
 model TEXT, status TEXT NOT NULL CHECK(status IN ('running','finished','failed')),
 total INTEGER NOT NULL, done INTEGER NOT NULL, started_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS resolutions(
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id),
 card_id TEXT NOT NULL REFERENCES cards(id), card_revision INTEGER NOT NULL,
 plan TEXT NOT NULL, plan_hash TEXT NOT NULL,
 lane TEXT NOT NULL CHECK(lane IN ('ready','waiting','judgment','clear')),
 state TEXT NOT NULL CHECK(state IN ('open','approved','rejected','superseded')),
 proposal_id TEXT REFERENCES proposals(id), parent_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resolution_answers(
 id TEXT PRIMARY KEY, resolution_id TEXT NOT NULL REFERENCES resolutions(id),
 actor TEXT NOT NULL REFERENCES users(id), answer TEXT NOT NULL, plan_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit(
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, entity TEXT NOT NULL, details TEXT NOT NULL,
 previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
 BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
 BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS card_gate BEFORE UPDATE ON cards
 WHEN NEW.id != OLD.id OR NEW.employee_id != OLD.employee_id
 OR NEW.revision != OLD.revision + 1 OR NOT EXISTS(
 SELECT 1 FROM write_permits p WHERE p.card_id=OLD.id
 AND p.old_revision=OLD.revision AND p.new_hash=NEW.content_hash)
 BEGIN SELECT RAISE(ABORT,'Verified approval required'); END;
CREATE TRIGGER IF NOT EXISTS card_no_delete BEFORE DELETE ON cards
 BEGIN SELECT RAISE(ABORT,'Timecards cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS policy_no_update BEFORE UPDATE ON policies
 BEGIN SELECT RAISE(ABORT,'Policy versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS policy_no_delete BEFORE DELETE ON policies
 BEGIN SELECT RAISE(ABORT,'Policy versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS signature_no_update BEFORE UPDATE ON policy_signatures
 BEGIN SELECT RAISE(ABORT,'Signatures are immutable'); END;
CREATE TRIGGER IF NOT EXISTS signature_no_delete BEFORE DELETE ON policy_signatures
 BEGIN SELECT RAISE(ABORT,'Signatures are immutable'); END;
CREATE TRIGGER IF NOT EXISTS proposal_source_immutable BEFORE UPDATE ON proposals
 WHEN NEW.card_id != OLD.card_id OR NEW.author != OLD.author
 OR NEW.correction != OLD.correction OR NEW.input_hash != OLD.input_hash
 OR NEW.policy_id != OLD.policy_id
 BEGIN SELECT RAISE(ABORT,'Create a new correction revision'); END;
CREATE TRIGGER IF NOT EXISTS approval_no_update BEFORE UPDATE ON approvals
 BEGIN SELECT RAISE(ABORT,'Approvals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS approval_no_delete BEFORE DELETE ON approvals
 BEGIN SELECT RAISE(ABORT,'Approvals are immutable'); END;
CREATE TRIGGER IF NOT EXISTS attestation_no_update BEFORE UPDATE ON attestations
 BEGIN SELECT RAISE(ABORT,'Attestations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS attestation_no_delete BEFORE DELETE ON attestations
 BEGIN SELECT RAISE(ABORT,'Attestations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS resolution_plan_immutable BEFORE UPDATE ON resolutions
 WHEN NEW.plan != OLD.plan OR NEW.plan_hash != OLD.plan_hash OR NEW.card_id != OLD.card_id
 OR NEW.run_id != OLD.run_id OR NEW.card_revision != OLD.card_revision
 BEGIN SELECT RAISE(ABORT,'Agent plans are immutable; create a new plan'); END;
CREATE TRIGGER IF NOT EXISTS answer_no_update BEFORE UPDATE ON resolution_answers
 BEGIN SELECT RAISE(ABORT,'Employee answers are immutable'); END;
CREATE TRIGGER IF NOT EXISTS answer_no_delete BEFORE DELETE ON resolution_answers
 BEGIN SELECT RAISE(ABORT,'Employee answers are immutable'); END;
CREATE TRIGGER IF NOT EXISTS dispute_no_update BEFORE UPDATE ON disputes
 BEGIN SELECT RAISE(ABORT,'Disputes are immutable; append a resolution'); END;
CREATE TRIGGER IF NOT EXISTS dispute_no_delete BEFORE DELETE ON disputes
 BEGIN SELECT RAISE(ABORT,'Disputes are immutable'); END;
CREATE TABLE IF NOT EXISTS office_settings(
 id INTEGER PRIMARY KEY CHECK(id=1), office_name TEXT NOT NULL DEFAULT 'Main office',
 latitude REAL CHECK(latitude BETWEEN -90 AND 90), longitude REAL CHECK(longitude BETWEEN -180 AND 180),
 radius_m INTEGER NOT NULL DEFAULT 150 CHECK(radius_m BETWEEN 20 AND 5000),
 max_accuracy_m INTEGER NOT NULL DEFAULT 100 CHECK(max_accuracy_m BETWEEN 5 AND 1000),
 break_reminder_min INTEGER NOT NULL DEFAULT 240 CHECK(break_reminder_min BETWEEN 30 AND 720)
);
INSERT OR IGNORE INTO office_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS profiles(
 user_id TEXT PRIMARY KEY REFERENCES users(id), department TEXT,
 is_active INTEGER NOT NULL DEFAULT 1, profile_image TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES users(id),
 attendance_date TEXT NOT NULL, check_in_time TEXT NOT NULL, check_out_time TEXT,
 latitude REAL, longitude REAL, location_status TEXT NOT NULL CHECK(location_status IN ('inside','outside')),
 check_out_latitude REAL, check_out_longitude REAL, total_working_hours REAL,
 synced_offline INTEGER NOT NULL DEFAULT 0,
 check_in_event_id TEXT UNIQUE, check_out_event_id TEXT UNIQUE,
 server_received_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(employee_id, attendance_date)
);
CREATE TABLE IF NOT EXISTS breaks(
 id TEXT PRIMARY KEY, attendance_id TEXT NOT NULL REFERENCES attendance(id),
 employee_id TEXT NOT NULL REFERENCES users(id), break_start TEXT NOT NULL, break_end TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_break ON breaks(employee_id) WHERE break_end IS NULL;
CREATE TABLE IF NOT EXISTS location_logs(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES users(id),
 latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy REAL, distance_m REAL,
 purpose TEXT NOT NULL, geofence_status TEXT NOT NULL
 CHECK(geofence_status IN ('inside','outside','uncertain','unconfigured','low_accuracy')),
 recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_policy(
 id INTEGER PRIMARY KEY CHECK(id=1), annual_days INTEGER NOT NULL DEFAULT 20,
 casual_days INTEGER NOT NULL DEFAULT 10, sick_days INTEGER NOT NULL DEFAULT 10,
 unpaid_days INTEGER NOT NULL DEFAULT 5, max_consecutive_days INTEGER NOT NULL DEFAULT 15,
 min_staff_pct INTEGER NOT NULL DEFAULT 70, updated_at TEXT
);
INSERT OR IGNORE INTO leave_policy(id) VALUES(1);
CREATE TABLE IF NOT EXISTS holidays(
 id TEXT PRIMARY KEY, holiday_date TEXT UNIQUE NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_requests(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES users(id),
 leave_type TEXT NOT NULL CHECK(leave_type IN ('annual','sick','personal','unpaid','other')),
 start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
 duration TEXT NOT NULL DEFAULT 'full' CHECK(duration IN ('full','half','hourly')), hours REAL,
 emergency INTEGER NOT NULL DEFAULT 0,
 approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
 reviewed_by TEXT, reviewed_at TEXT, manager_comment TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shift_schedules(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES users(id),
 assigned_date TEXT NOT NULL, shift_start TEXT NOT NULL, shift_end TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(employee_id, assigned_date)
);
CREATE TABLE IF NOT EXISTS shift_swap_requests(
 id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shift_schedules(id),
 requester_id TEXT NOT NULL REFERENCES users(id), target_employee_id TEXT REFERENCES users(id),
 reason TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks(
 id TEXT PRIMARY KEY, title TEXT NOT NULL, project TEXT NOT NULL DEFAULT 'General',
 tag TEXT NOT NULL DEFAULT 'Feature',
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','completed')),
 progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 assignee_id TEXT REFERENCES users(id), due_date TEXT, completed_at TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log(
 id TEXT PRIMARY KEY, event_id TEXT, employee_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('check_in','check_out')), captured_at TEXT,
 synced_at TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
 result TEXT NOT NULL CHECK(result IN ('success','failed','retry','conflict','correction')),
 error TEXT, device_info TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_conflicts(
 id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES users(id),
 conflict_type TEXT NOT NULL CHECK(conflict_type IN
 ('duplicate_punch','missing_checkout','leave_overlap','location_mismatch','sync_failure')),
 conflict_date TEXT, details TEXT, severity TEXT NOT NULL DEFAULT 'medium'
 CHECK(severity IN ('low','medium','high')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','rejected')),
 resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL,
 UNIQUE(employee_id, conflict_type, conflict_date)
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix="") -> str:
    return prefix + secrets.token_hex(10)


def password_hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 240000).hex()


class Database:
    def __init__(self, path=None):
        self.path = str(path or os.environ.get(
            "DAYFLOW_DB", Path(__file__).resolve().parents[1] / "dayflow.sqlite3"
        ))
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)
            connection.execute("PRAGMA journal_mode=WAL")

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=30, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @contextmanager
    def transaction(self):
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def audit(connection, actor, action, entity, details):
    previous = connection.execute(
        "SELECT event_hash FROM audit ORDER BY sequence DESC LIMIT 1"
    ).fetchone()
    previous_hash = previous["event_hash"] if previous else "0" * 64
    event = {"at": now(), "actor": actor, "action": action, "entity": entity, "details": details}
    digest = hashlib.sha256((previous_hash + canonical(event)).encode()).hexdigest()
    connection.execute(
        "INSERT INTO audit(at,actor,action,entity,details,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?)",
        (event["at"], actor, action, entity, canonical(details), previous_hash, digest),
    )


def audit_integrity(connection):
    previous = "0" * 64
    rows = connection.execute("SELECT * FROM audit ORDER BY sequence").fetchall()
    for row in rows:
        event = {key: row[key] for key in ("at", "actor", "action", "entity")}
        event["details"] = json.loads(row["details"])
        expected = hashlib.sha256((previous + canonical(event)).encode()).hexdigest()
        if row["previous_hash"] != previous or row["event_hash"] != expected:
            return False
        previous = expected
    return True
