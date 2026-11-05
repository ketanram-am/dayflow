from app.agent_eval import evaluate
from app.data import expected_resolutions, generate
from app.reassign import propose
from app.resolver import plan_card


def plan(service, card_id):
    cards, _, _ = generate()
    by = {}
    for c in cards:
        by.setdefault(c.employee.id, []).append(c)
    card = next(c for c in cards if c.id == card_id)
    with service.db.connect() as cx:
        doc = service.policy(cx)[0]["document"]
    mine = by[card.employee.id]
    return plan_card(service, card, mine, doc, service.pay(card, mine, doc), fleet=cards), card, cards, doc


def test_schedule_clash_gets_a_verified_reschedule_not_a_manager_hand_off(service):
    result, *_ = plan(service, "e010-2026-10-19")
    fix = next(i for i in result["items"] if i["code"] == "schedule_overlap")
    assert fix["kind"] == "fix_schedule" and fix["detail"]["mode"] == "reschedule"
    assert fix["detail"]["when"] != fix["detail"]["to_when"] and fix["detail"]["checks"]
    assert result["simulation"]["ok"]


def test_salaried_roster_breach_clears_with_the_same_fix(service):
    result, *_ = plan(service, "e003-2026-10-05")
    kinds = {i["code"]: i["kind"] for i in result["items"]}
    assert kinds["schedule_overlap"] == kinds["salary_roster"] == "fix_schedule"
    assert result["lane"] == "waiting"      # the missing clock-in still needs the employee


def test_every_labelled_clash_in_the_dataset_is_fixable_and_matches_the_truth(service):
    cards, _, _ = generate()
    truth = expected_resolutions()
    with service.db.connect() as cx:
        doc = service.policy(cx)[0]["document"]
    clashes = 0
    for card in cards:
        for key, answer in truth[card.id]["items"].items():
            if ":schedule_overlap:" in key:
                clashes += 1
                assert answer["kind"] == "fix_schedule"
    assert clashes == 10
    by = {}
    for c in cards:
        by.setdefault(c.employee.id, []).append(c)
    fixed = 0
    for card in cards:
        pay = service.pay(card, by[card.employee.id], doc)
        for e in pay["exceptions"]:
            if e["code"] == "schedule_overlap":
                fixed += bool(propose(service, card, cards, doc, e))
    assert fixed == 10


def test_rules_only_agent_scores_clashes_correctly():
    metrics = evaluate(ai=None) if "ai" in evaluate.__code__.co_varnames else evaluate()
    assert metrics["lane_accuracy_pct"] >= 96
