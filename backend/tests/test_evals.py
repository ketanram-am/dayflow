from collections import Counter

from app.data import generate, generate_detection_edge_cases
from app.engine import calculate
from app.evals import detection_metrics, detection_scorecard


def test_detection_edge_cases_match_explicit_labels():
    cases = generate_detection_edge_cases()
    names = {name for name, _, _ in cases}
    assert names == {
        "missing_clock_in",
        "missing_clock_out",
        "missing_both_endpoints",
        "unrecorded_ambiguous_absence",
        "confirmed_absence",
        "duplicate_identical_punch",
        "duplicate_inconsistent_punch",
        "overtime_at_boundary",
        "overtime_one_minute_over",
        "schedule_at_tolerance",
        "schedule_over_tolerance",
        "planned_break_mismatch",
    }

    for name, card, expected in cases:
        assert {exception.id for exception in calculate(card).exceptions} == expected, name


def test_scorecard_has_per_category_and_aggregate_metrics_with_all_edge_cases():
    _, base_labels, _ = generate(104729)
    edge_cases = generate_detection_edge_cases(104729)
    base_counts = Counter(
        label.split(":", 1)[0]
        for labels in base_labels.values()
        for label in labels
    )
    edge_counts = Counter(
        label.split(":", 1)[0] for _, _, labels in edge_cases for label in labels
    )

    scorecard = detection_scorecard(seed=42, held_out_seed=104729)
    assert scorecard["labelled_exceptions"] == sum(base_counts.values()) + sum(edge_counts.values())
    assert set(scorecard["detection"]) == {
        "missed_punch", "overtime_risk", "schedule_conflict", "policy_breach",
    }
    for family, metrics in scorecard["detection"].items():
        assert metrics["tp"] == base_counts[family] + edge_counts[family]
        assert metrics["tp"] - base_counts[family] == edge_counts[family]
        assert metrics["fp"] == 0
        assert metrics["fn"] == 0
        assert metrics["precision"] == 1
        assert metrics["recall"] == 1

    aggregate = scorecard["detection_aggregate"]
    for metric in ("tp", "fp", "fn"):
        assert aggregate[metric] == sum(row[metric] for row in scorecard["detection"].values())
    assert aggregate["precision"] == (
        aggregate["tp"] / (aggregate["tp"] + aggregate["fp"])
    )
    assert aggregate["recall"] == (
        aggregate["tp"] / (aggregate["tp"] + aggregate["fn"])
    )


def test_detection_metrics_handle_zero_denominators():
    assert detection_metrics(tp=0, fp=0, fn=0) == {
        "tp": 0, "fp": 0, "fn": 0, "precision": 0, "recall": 0,
    }
    assert detection_metrics(tp=0, fp=2, fn=0)["precision"] == 0
    assert detection_metrics(tp=0, fp=0, fn=3)["recall"] == 0
