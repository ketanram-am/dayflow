
from fastapi.testclient import TestClient
import httpx
import pytest

from pydantic import StrictBool

from app.agent import Provider, ProviderFailure, has_instructions
from app.domain import Model
from app.evals import BENIGN_CASES, INJECTION_CASES
from app.main import create_app


class Ping(Model):
    ok: StrictBool
    text: str


def response(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]},
                          request=httpx.Request("POST", "http://provider.test"))


@pytest.mark.parametrize("note", INJECTION_CASES)
def test_known_injections(note):
    assert has_instructions(note)


@pytest.mark.parametrize("note", BENIGN_CASES)
def test_benign_notes(note):
    assert not has_instructions(note)


def test_schema_retry_exactly_once(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    calls = []

    def malformed(*args, **kwargs):
        calls.append(kwargs)
        return response("not json")

    monkeypatch.setattr("app.agent.httpx.post", malformed)
    with pytest.raises(ProviderFailure, match="one retry"):
        Provider().extract(Ping, "Test-malformed", {})
    assert len(calls) == 2
    assert calls[0]["headers"]["Authorization"] == "Bearer synthetic-test-value"
    calls.clear()
    outputs = iter(["bad", '{"ok": true, "text": "fine"}'])

    def eventual(*args, **kwargs):
        calls.append(kwargs)
        return response(next(outputs))

    monkeypatch.setattr("app.agent.httpx.post", eventual)
    assert Provider().extract(Ping, "Test-eventual", {}).ok
    assert len(calls) == 2


def test_retry_tells_the_model_what_failed(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    sent = []
    outputs = iter(['{"ok": true, "text": "Pay is 999 dollars."}', '{"ok": true, "text": "fine"}'])

    def post(*args, **kwargs):
        sent.append(kwargs["json"]["messages"])
        return response(next(outputs))

    def no_digits(item):
        if any(ch.isdigit() for ch in item.text):
            raise ProviderFailure("Numbers are not allowed in text")
        return item

    monkeypatch.setattr("app.agent.httpx.post", post)
    trace = []
    assert Provider().extract(Ping, "Test-feedback", {}, validate=no_digits, trace=trace).text == "fine"
    assert "Numbers are not allowed in text" in sent[1][-1]["content"]
    assert [step["ok"] for step in trace] == [False, True]
    with pytest.raises(ValueError):
        Ping.model_validate({"ok": "true", "text": "x"})
    with pytest.raises(ValueError):
        Ping.model_validate({"ok": True, "text": "x", "salary": 999})


def test_rate_limit_backs_off_then_succeeds(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    replies = iter([httpx.Response(429, headers={"retry-after": "0"},
                                   request=httpx.Request("POST", "http://provider.test")),
                    response('{"ok": true, "text": "fine"}')])
    monkeypatch.setattr("app.agent.httpx.post", lambda *a, **k: next(replies))
    monkeypatch.setattr("app.agent.time.sleep", lambda seconds: None)
    assert Provider().extract(Ping, "Test-429", {}).ok


def test_api_auth_csrf_and_actual_roundtrip(service):
    with TestClient(create_app(service.db.path)) as client:
        assert client.get("/api/cards").status_code == 401
        assert client.get("/api/health").json()["status"] == "ok"
        result = client.post("/api/login", json={
            "email": "avery@dayflow.demo", "password": "Dayflow-demo-2026!",
        })
        assert result.status_code == 200
        csrf = result.json()["csrf"]
        policies = client.get("/api/policies").json()
        policy = policies["versions"][0]
        assert client.post(f"/api/policies/{policy['id']}/sign", json={
            "hash": policy["content_hash"], "reviewed": True,
        }).status_code == 403
        client.headers["X-CSRF-Token"] = csrf
        assert client.post(f"/api/policies/{policy['id']}/sign", json={
            "hash": policy["content_hash"], "reviewed": True,
        }).status_code == 200
        assert len(client.get("/api/cards").json()["cards"]) == 60
        score = client.get("/api/scorecard")
        assert score.status_code == 200
        assert 148 <= score.json()["labelled_exceptions"] <= 160
        client.post("/api/logout")
        client.post("/api/login", json={
            "email": "e001@dayflow.demo", "password": "Dayflow-demo-2026!",
        })
        assert len(client.get("/api/cards").json()["cards"]) == 2
        assert client.get("/api/cards/e002-2026-10-05").status_code == 403
        assert client.get("/api/audit").status_code == 403
        assert client.post("/api/logout", headers={"Origin": "https://untrusted.test"}).status_code == 403
