"""Measure the resolution agent against labelled answers: rules-only vs AI-assisted.

Run:  python -m app.agent_eval                 (rules-only, no model needed)
      python -m app.agent_eval --ai            (also runs the configured model)
Writes evidence/agent_scorecard.json. All data is synthetic; this is not real-world accuracy.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import time

from .agent import Provider
from .ai_planner import NOTE_CODES, make_ai
from .data import expected_resolutions, generate
from .db import Database
from .domain import DISCLAIMER
from .policy import baseline
from .resolver import plan_card
from .services import Service

# Tracked in git (unlike artifacts/) so the published scorecard shows the real-model run.
ARTIFACT = Path(__file__).resolve().parents[2] / "evidence" / "agent_scorecard.json"
# Stated assumption for the time-saved estimate, not a measurement.
MINUTES_PER_MANUAL_EXCEPTION = 4.0
MINUTES_PER_AGENT_PLAN = 0.5


def _item_correct(expected, got):
    if expected["kind"] != got["kind"]:
        return False
    if expected["kind"] == "fill_punch":
        if expected.get("source") == "note":
            return got["source"] == "note" and got["time"] == expected["time"]
        return got["source"] == "schedule"  # nothing stated: must not invent a time
    return True


def evaluate(seed=42, ai=None):
    """Plan every card of a seed and compare with the labelled answers."""
    cards, _, _ = generate(seed)
    truth = expected_resolutions(seed)
    with tempfile.TemporaryDirectory(prefix="dayflow-agent-eval-") as directory:
        svc = Service(Database(Path(directory) / "eval.sqlite3"))
        policy = baseline().model_dump_json()
        by_employee = {}
        for card in cards:
            by_employee.setdefault(card.employee.id, []).append(card)
        totals = Counter()
        started = time.monotonic()
        for card in cards:
            mine = by_employee[card.employee.id]
            pay = svc.pay(card, mine, policy)
            plan = plan_card(svc, card, mine, policy, pay, ai=ai)
            expected = truth[card.id]
            blocked_by_dependency = any("earlier pay period" in f
                                        for f in plan["simulation"]["failures"])
            totals["cards"] += 1
            totals["lane_correct"] += plan["lane"] == expected["lane"] or blocked_by_dependency
            totals["verifier_rejected"] += not plan["simulation"]["ok"] and not blocked_by_dependency
            if expected["hostile"]:
                totals["hostile"] += 1
                totals["hostile_routed"] += plan["lane"] == "judgment" and plan["engine"] == "rules"
            got = {i["exception_id"]: i for i in plan["items"]}
            for exception_id, answer in expected["items"].items():
                if expected["hostile"]:
                    continue
                item = got.get(exception_id)
                ok = bool(item) and _item_correct(answer, item)
                totals["items"] += 1
                totals["items_correct"] += ok
                if exception_id.split(":")[1] in NOTE_CODES:
                    totals["note_items"] += 1
                    totals["note_items_correct"] += ok
                    if item and item["source"] == "note" and not ok:
                        totals["invented_or_wrong_from_note"] += 1
                    if answer.get("source") == "note" and ok:
                        totals["right_time_first_ask"] += 1
            for step in plan["trace"]:
                if step["step"] == "model":
                    totals["model_attempts"] += 1
                    totals["model_cached"] += bool(step.get("cached"))
                if step["step"] == "fallback":
                    totals["fallbacks"] += 1
            totals["exceptions"] += len(plan["items"])
            totals["clear"] += plan["lane"] == "clear"
        totals["seconds"] = round(time.monotonic() - started, 1)
    pct = lambda a, b: round(100 * totals[a] / totals[b], 1) if totals[b] else None  # noqa: E731
    manual = totals["exceptions"] * MINUTES_PER_MANUAL_EXCEPTION
    agent = (totals["cards"] - totals.get("clear", 0)) * MINUTES_PER_AGENT_PLAN
    return {
        "seed": seed, "cards": totals["cards"], "exceptions": totals["exceptions"],
        "item_accuracy_pct": pct("items_correct", "items"),
        "note_dependent_items": totals["note_items"],
        "note_dependent_accuracy_pct": pct("note_items_correct", "note_items"),
        "right_time_on_first_ask": totals["right_time_first_ask"],
        "invented_or_wrong_from_note": totals["invented_or_wrong_from_note"],
        "lane_accuracy_pct": pct("lane_correct", "cards"),
        "verifier_rejected_plans": totals["verifier_rejected"],
        "hostile_notes_routed_to_manager": f"{totals['hostile_routed']}/{totals['hostile']}",
        "model_attempts": totals["model_attempts"], "model_cached": totals["model_cached"],
        "fallbacks_to_rules": totals["fallbacks"], "seconds": totals["seconds"],
        "manager_minutes_manual_estimate": manual,
        "manager_minutes_with_agent_estimate": agent,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ai", action="store_true", help="also evaluate the configured model")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default=str(ARTIFACT))
    options = parser.parse_args()
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "disclaimer": DISCLAIMER,
        "assumptions": f"Time saved assumes {MINUTES_PER_MANUAL_EXCEPTION:g} minutes per "
                       f"exception reviewed by hand and {MINUTES_PER_AGENT_PLAN:g} per agent plan.",
        "scope": "Synthetic seeded data with labelled answers. Not real-world accuracy.",
        "rules_only": evaluate(options.seed),
        "ai": None,
    }
    if options.ai:
        provider = Provider()
        if provider.mode == "off":
            raise SystemExit("Set DAYFLOW_LLM_MODE (ollama or openai) to evaluate a model")
        report["ai"] = {"model": provider.model, "mode": provider.mode,
                        "licence": provider.licence, **evaluate(options.seed, make_ai(provider))}
    target = Path(options.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not options.ai and target.exists():  # keep the last real-model result
        report["ai"] = json.loads(target.read_text()).get("ai")
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
