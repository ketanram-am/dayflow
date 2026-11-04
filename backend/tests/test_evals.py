from collections import Counter

from app.data import generate, generate_detection_edge_cases
from app.engine import calculate
from app.evals import detection_scorecard


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


def test_scorecard_counts_edge_case_labels_in_detection_metrics():
    _, base_labels, _ = generate(104729)
    edge_cases = generate_detection_edge_cases(104729)
    expected_counts = Counter(
        label.split(":", 1)[0]
        for labels in [*base_labels.values(), *(case[2] for case in edge_cases)]
        for label in labels
    )

    scorecard = detection_scorecard(seed=42, held_out_seed=104729)
    assert scorecard["labelled_exceptions"] == sum(expected_counts.values())
    for family, metrics in scorecard["detection"].items():
        assert metrics["tp"] == expected_counts[family]
        assert metrics["fp"] == 0
        assert metrics["fn"] == 0
        assert metrics["precision"] == 1
        assert metrics["recall"] == 1
