"""In-app notifications with optional email, queued inside the transaction and sent after it commits.

Ported from PR #8 (Praveenraj2206) and extended: the approving reviewer and the employee are told when
a verified correction is committed, and the employee is told when the agent has a question for them.
Email is off unless DAYFLOW_SMTP_HOST is set. DAYFLOW_NOTIFY_OVERRIDE sends every message to one address
so a demo can show real email without using anyone's real address.
"""

from __future__ import annotations

from email.message import EmailMessage
import os
import smtplib

from .db import now, uid


def send_email(to_addr, subject, body):
    host = os.environ.get("DAYFLOW_SMTP_HOST")
    to_addr = os.environ.get("DAYFLOW_NOTIFY_OVERRIDE") or to_addr
    if not host or not to_addr:
        return "skipped: SMTP not configured"
    message = EmailMessage()
    message["Subject"], message["To"] = subject, to_addr
    message["From"] = os.environ.get("DAYFLOW_SMTP_FROM", "dayflow@localhost")
    message.set_content(body)
    try:
        with smtplib.SMTP(host, int(os.environ.get("DAYFLOW_SMTP_PORT", "587")), timeout=15) as smtp:
            smtp.starttls()
            login = os.environ.get("DAYFLOW_SMTP_USER")
            if login:
                smtp.login(login, os.environ["DAYFLOW_SMTP_PASSWORD"])
            smtp.send_message(message)
        return "sent"
    except Exception as exc:  # noqa: BLE001 - delivery failure must never undo a committed approval
        return f"failed: {type(exc).__name__}"


def queue(cx, recipient_id, kind, subject, body, card_id=None, proposal_id=None):
    identity = uid("ntf-")
    cx.execute("INSERT INTO notifications(id,recipient_id,kind,card_id,proposal_id,subject,body,delivery,created_at) "
               "VALUES(?,?,?,?,?,?,?,'pending',?)",
               (identity, recipient_id, kind, card_id, proposal_id, subject, body, now()))
    return identity


def user_for_employee(cx, employee_id):
    row = cx.execute("SELECT id FROM users WHERE employee_id=?", (employee_id,)).fetchone()
    return row["id"] if row else None


def for_approval(cx, card, proposal_id, proof, approver_id):
    """One notice for the employee and one for the reviewer who approved."""
    delta = next((p["delta"] for p in proof.get("periods", []) if p.get("delta") is not None), None)
    pay = f"Pay change: ${delta}\n" if delta is not None else ""
    subject = f"Pay correction approved: {card.period_start}"
    ids = []
    employee = user_for_employee(cx, card.employee.id)
    if employee:
        ids.append(queue(cx, employee, "correction_approved", subject, (
            f"Hello {card.employee.name},\n\nA correction to your timecard for {card.period_start} to "
            f"{card.period_end} was reviewed and approved.\n\n{pay}Reference: {proposal_id}\n\n"
            "Open Dayflow to see the details or raise a dispute."), card.id, proposal_id))
    if approver_id and approver_id != employee:
        ids.append(queue(cx, approver_id, "correction_approved", subject, (
            f"You approved a verified correction for {card.employee.name} "
            f"({card.period_start}). Reference: {proposal_id}."), card.id, proposal_id))
    return ids


def for_question(cx, card, question, resolution_id):
    employee = user_for_employee(cx, card.employee.id)
    if not employee:
        return []
    return [queue(cx, employee, "question", "Dayflow has a question about your timecard", (
        f"Hello {card.employee.name},\n\n{question}\n\nOpen Dayflow and answer in one tap."),
        card.id, resolution_id)]


def dispatch(db, ids):
    """Send after the database commit so SMTP never holds the database lock."""
    with db.connect() as cx:
        rows = [cx.execute("SELECT n.id,n.subject,n.body,u.email FROM notifications n JOIN users u "
                           "ON u.id=n.recipient_id WHERE n.id=?", (identity,)).fetchone() for identity in ids]
    results = [(send_email(r["email"], r["subject"], r["body"]), r["id"]) for r in rows if r]   # no lock held
    try:
        with db.transaction() as cx:  # one short write; a failure here must not undo a committed approval
            cx.executemany("UPDATE notifications SET delivery=? WHERE id=?", results)
    except Exception:  # noqa: BLE001
        pass


def listing(db, user, limit=50):
    with db.connect() as cx:
        return [dict(r) for r in cx.execute(
            "SELECT * FROM notifications WHERE recipient_id=? ORDER BY created_at DESC LIMIT ?",
            (user["id"], limit))]


def mark_read(db, user, identity):
    with db.transaction() as cx:
        cx.execute("UPDATE notifications SET read_at=? WHERE id=? AND recipient_id=? AND read_at IS NULL",
                   (now(), identity, user["id"]))
    return {"status": "read"}
