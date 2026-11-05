from datetime import datetime, timezone

from fastapi import HTTPException
import pytest

from app.forecast import Forecast
from app.workforce import Workforce

WED = datetime(2026, 11, 4, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def wf(service):
    return Workforce(service, lambda: WED)


def test_forecast_flags_people_who_will_pass_forty_hours(wf, users):
    report = Forecast(wf).build(users["avery"])
    assert report["threshold_minutes"] == 2400 and report["employees_checked"] == 20
    assert 3 <= len(report["flagged"]) <= 6
    top = report["flagged"][0]
    assert top["projected_minutes"] == top["worked_minutes"] + top["remaining_minutes"]
    assert top["over_minutes"] == top["projected_minutes"] - 2400
    assert [d["date"] for d in top["days"]] == sorted(d["date"] for d in top["days"])


def test_options_are_priced_by_the_engine_and_stay_under_the_limit(wf, users):
    report = Forecast(wf).build(users["avery"])
    priced = [o for f in report["flagged"] for o in f["options"]]
    assert priced and all(o["saving"] is not None and float(o["saving"]) >= 0 for o in priced)
    finish = next(o for o in priced if o["kind"] == "finish_early")
    owner = next(f for f in report["flagged"] if finish in f["options"])
    assert finish["minutes"] % 15 == 0 and finish["minutes"] >= owner["over_minutes"]
    assert float(report["potential_saving"]) > 0
    hand = [o for o in priced if o["kind"] == "hand_over"]
    assert all(o["to_projected_after"] <= 2400 for o in hand)


def test_only_a_reviewer_can_see_or_apply_the_forecast(wf, users):
    with pytest.raises(HTTPException) as caught:
        Forecast(wf).build(users["e010"])
    assert caught.value.status_code == 403
    with pytest.raises(HTTPException):
        Forecast(wf).apply(users["e010"], "finish_early:e001:2026-11-07")


def test_applying_finish_early_edits_the_schedule_and_the_audit_chain(wf, users, service):
    report = Forecast(wf).build(users["avery"])
    option = next(o for f in report["flagged"] for o in f["options"] if o["kind"] == "finish_early")
    eid = option["id"].split(":")[1]
    Forecast(wf).apply(users["avery"], option["id"])
    shift = next(s for s in wf.shifts(users["avery"], option["date"], option["date"]) if s["employee_id"] == eid)
    assert shift["shift_end"] == option["new_end"]
    again = Forecast(wf).build(users["avery"])
    person = next((f for f in again["flagged"] if f["employee_id"] == eid), None)
    assert person is None or person["over_minutes"] < next(
        f for f in report["flagged"] if f["employee_id"] == eid)["over_minutes"]
    with service.db.connect() as cx:
        assert cx.execute("SELECT COUNT(*) FROM audit WHERE action='overtime_prevented'").fetchone()[0] == 1
    with pytest.raises(HTTPException) as stale:
        Forecast(wf).apply(users["avery"], "finish_early:nobody:2026-11-07")
    assert stale.value.status_code == 409


def test_applying_a_hand_over_moves_the_shift_to_the_free_colleague(wf, users):
    report = Forecast(wf).build(users["avery"])
    option = next(o for f in report["flagged"] for o in f["options"] if o["kind"] == "hand_over")
    eid = option["id"].split(":")[1]
    Forecast(wf).apply(users["avery"], option["id"])
    owners = [s["employee_id"] for s in wf.shifts(users["avery"], option["date"], option["date"])
              if s["employee_id"] in (eid, option["to_employee_id"])]
    assert option["to_employee_id"] in owners and eid not in owners


def test_forecast_routes_respect_roles(tmp_path):
    from fastapi.testclient import TestClient
    from app.main import create_app
    with TestClient(create_app(tmp_path / "f.sqlite3")) as client:
        login = client.post("/api/login", json={"email": "e010@dayflow.demo", "password": "Dayflow-demo-2026!"}).json()
        assert client.get("/api/wf/forecast").status_code == 403
        client.post("/api/logout", headers={"x-csrf-token": login["csrf"]})
        login = client.post("/api/login", json={"email": "avery@dayflow.demo", "password": "Dayflow-demo-2026!"}).json()
        body = client.get("/api/wf/forecast").json()
        assert body["threshold_minutes"] == 2400 and "flagged" in body
        bad = client.post("/api/wf/forecast/apply", json={"option_id": "x"}, headers={"x-csrf-token": login["csrf"]})
        assert bad.status_code == 422
