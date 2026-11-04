import json

from fastapi.testclient import TestClient
import httpx
import pytest

from app.agent import (
    Brief, Provider, ProviderFailure, investigate, local_critic, suggest_from_schedule, validate_brief,
)
from app.data import generate
from app.domain import CriticVerdict
from app.engine import calculate
from app.evals import BENIGN_CASES, INJECTION_CASES
from app.main import create_app
from app.policy import baseline


def response(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]},
                          request=httpx.Request("POST", "http://provider.test"))


@pytest.mark.parametrize("note", INJECTION_CASES)
def test_known_injections(note):
    assert not local_critic(note).safe


@pytest.mark.parametrize("note", BENIGN_CASES)
def test_benign_notes(note):
    assert local_critic(note).safe


def test_schema_retry_exactly_once(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    calls = []

    def malformed(*args, **kwargs):
        calls.append(kwargs)
        return response("not json")

    monkeypatch.setattr("app.agent.httpx.post", malformed)
    with pytest.raises(ProviderFailure, match="one retry"):
        Provider().extract(CriticVerdict, "Test", {})
    assert len(calls) == 2
    assert calls[0]["headers"]["Authorization"] == "Bearer synthetic-test-value"
    calls.clear()
    outputs = iter(["bad", '{"safe": true, "reason": "No instruction override."}'])

    def eventual(*args, **kwargs):
        calls.append(kwargs)
        return response(next(outputs))

    monkeypatch.setattr("app.agent.httpx.post", eventual)
    assert Provider().extract(CriticVerdict, "Test", {}).safe
    assert len(calls) == 2


def test_semantic_retry_and_strict_schema(monkeypatch):
    monkeypatch.setenv("DAYFLOW_LLM_API_KEY", "synthetic-test-value")
    facts = {"findings": [{"issue": "Missing clock-out"}], "schedule_vs_recorded": ["scheduled 09:00-17:00"]}
    bad = {"summary": "Pay is 999 dollars.", "note_assessment": "unclear", "note_reason": ""}
    good = {**bad, "summary": "The clock-out is missing; the schedule ended at 17:00."}
    outputs = iter([json.dumps(bad), json.dumps(good)])
    monkeypatch.setattr("app.agent.httpx.post", lambda *a, **k: response(next(outputs)))
    value = Provider().extract(Brief, "Test-retry", facts, validate=lambda item: validate_brief(item, facts))
    assert value.summary == good["summary"]
    with pytest.raises(ValueError):
        CriticVerdict.model_validate({"safe": "true", "reason": "Not a boolean."})
    with pytest.raises(ValueError):
        Brief.model_validate({**good, "salary": 999})


def test_suggestion_comes_from_code_not_the_model():
    cards = generate()[0]
    card = next(c for c in cards if any(e["code"] == "missing_endpoint"
                                       for e in calculate(c).model_dump(mode="json")["exceptions"]))
    pay = calculate(card).model_dump(mode="json")
    fix = suggest_from_schedule(card, pay)
    assert fix and fix.edits[0].operation == "replace" and "schedule:" + fix.edits[0].shift_id in fix.evidence


def test_no_llm_and_missing_provider_manual_review(monkeypatch):
    card = generate()[0][0]
    pay = calculate(card).model_dump(mode="json")
    monkeypatch.setenv("DAYFLOW_LLM_MODE", "off")
    assert investigate(card, pay, baseline())["status"] == "rules_only"
    monkeypatch.setenv("DAYFLOW_LLM_MODE", "openai")
    monkeypatch.delenv("DAYFLOW_LLM_API_KEY", raising=False)
    degraded = investigate(card, pay, baseline())
    assert degraded["status"] == "ai_unavailable" and degraded["findings"] == investigate(
        card, pay, baseline())["findings"]
    card.note = INJECTION_CASES[0]
    hostile = investigate(card, pay, baseline())
    assert hostile["critic"]["safe"] is False and hostile["status"] == "needs_person"


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
