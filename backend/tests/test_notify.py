from app import notify
from app.desk import Desk


def signed(service, users):
    src = service.policies(users["avery"])["versions"][0]
    service.sign(src["id"], src["content_hash"], users["avery"])


def test_agent_run_asks_each_waiting_employee_once_in_app(service, users):
    signed(service, users)
    desk = Desk(service)
    run = desk.start_run(users["avery"], background=False)
    with service.db.connect() as cx:
        rows = cx.execute("SELECT * FROM notifications WHERE kind='question'").fetchall()
    assert len(rows) == run["lanes"]["waiting"]
    assert all(r["delivery"].startswith("skipped") for r in rows)       # no SMTP configured
    employee = service.user(rows[0]["recipient_id"])
    mine = notify.listing(service.db, employee)
    assert mine and all(n["recipient_id"] == employee["id"] for n in mine)
    assert notify.mark_read(service.db, users["taylor"], mine[0]["id"]) == {"status": "read"}
    assert notify.listing(service.db, employee)[0]["read_at"] is None    # someone else cannot mark it read
    notify.mark_read(service.db, employee, mine[0]["id"])
    assert next(n for n in notify.listing(service.db, employee) if n["id"] == mine[0]["id"])["read_at"]


def test_approving_a_correction_notifies_the_employee_and_only_the_approver(service, users):
    signed(service, users)
    desk = Desk(service)
    desk.start_run(users["avery"], background=False)
    question = next(i for i in desk.resolutions(users["avery"])["items"]
                    if i["lane"] == "waiting" and any(x["kind"] == "fill_punch" and x["field"] == "end"
                                                     for x in i["items"]))
    employee = service.user(question["employee_id"])
    ready = desk.answer(question["id"], employee, "yes")
    assert desk.approve(ready["id"], users["taylor"])["status"] == "approved"
    with service.db.connect() as cx:
        rows = cx.execute("SELECT recipient_id FROM notifications WHERE kind='correction_approved' "
                          "AND card_id=?", (question["card_id"],)).fetchall()
    assert sorted(r["recipient_id"] for r in rows) == sorted([employee["id"], "taylor"])   # not avery


def test_email_is_skipped_without_smtp_and_overridden_in_demo(monkeypatch):
    monkeypatch.delenv("DAYFLOW_SMTP_HOST", raising=False)
    assert notify.send_email("a@b.test", "s", "b").startswith("skipped")
    sent = {}

    class Fake:
        def __init__(self, host, port, timeout):
            sent["host"] = host

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def starttls(self):
            pass

        def login(self, *args):
            pass

        def send_message(self, message):
            sent["to"] = message["To"]

    monkeypatch.setenv("DAYFLOW_SMTP_HOST", "smtp.test")
    monkeypatch.setenv("DAYFLOW_NOTIFY_OVERRIDE", "demo@example.test")
    monkeypatch.setattr("app.notify.smtplib.SMTP", Fake)
    assert notify.send_email("real.person@company.test", "s", "b") == "sent"
    assert sent == {"host": "smtp.test", "to": "demo@example.test"}
    monkeypatch.setattr("app.notify.smtplib.SMTP", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    assert notify.send_email("x@y.test", "s", "b") == "failed: OSError"
