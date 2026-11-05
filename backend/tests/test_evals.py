from app.data import generate, generate_detection_edge_cases
from app.engine import calculate
from app.evals import detection_metrics, detection_scorecard


def test_detection_edge_cases_match_explicit_labels():
    cases = generate_detection_edge_cases()
    assert {name for name, _, _ in cases} == {
        "missing_clock_in", "missing_clock_out", "missing_both_endpoints",
        "unrecorded_ambiguous_absence", "confirmed_absence", "duplicate_identical_punch",
        "duplicate_inconsistent_punch", "overtime_at_boundary", "overtime_one_minute_over",
        "schedule_at_tolerance", "schedule_over_tolerance", "planned_break_mismatch",
    }
    for name, card, expected in cases:
        assert {exception.id for exception in calculate(card).exceptions} == expected, name


def test_scorecard_reports_edge_cases_and_aggregate_without_changing_the_headline_count():
    scorecard = detection_scorecard(seed=42, held_out_seed=104729)
    _, labels, _ = generate(104729)
    assert scorecard["labelled_exceptions"] == sum(map(len, labels.values()))   # headline unchanged
    edge = scorecard["edge_cases"]
    assert len(edge["cases"]) == 12 and all(c["ok"] for c in edge["cases"])
    assert edge["fp"] == edge["fn"] == 0 and edge["precision"] == edge["recall"] == 1
    aggregate = scorecard["detection_aggregate"]
    for metric in ("tp", "fp", "fn"):
        assert aggregate[metric] == sum(row[metric] for row in scorecard["detection"].values())
    assert aggregate["precision"] == aggregate["tp"] / (aggregate["tp"] + aggregate["fp"])


def test_detection_metrics_handle_zero_denominators():
    assert detection_metrics(tp=0, fp=0, fn=0) == {"tp": 0, "fp": 0, "fn": 0, "precision": 0, "recall": 0}
    assert detection_metrics(tp=0, fp=2, fn=0)["precision"] == 0
    assert detection_metrics(tp=0, fp=0, fn=3)["recall"] == 0
