from evals.diagnosis_benchmark import run_benchmark


def test_rules_classify_every_injected_fault_with_ground_truth():
    report = run_benchmark()
    assert report["scenario_count"] >= 40
    assert report["accuracy"] == 1.0, report["misclassified"]
    assert set(report["labels"]) == {"retrieval_failure", "context_construction_failure", "generation_failure", "none"}
    # Without ground truth the same faults are only partly distinguishable.
    assert 0 < report["without_ground_truth"]["accuracy"] < 1.0
