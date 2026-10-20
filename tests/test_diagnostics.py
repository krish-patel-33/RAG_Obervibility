import pytest

from app.services.diagnostics import DiagnosisInput, GroundTruthSignals, diagnose


def gt(**overrides):
    values = {
        "should_answer": True,
        "relevant_total": 2,
        "relevant_retrieved": 1,
        "relevant_in_context": 1,
        "evidence_in_context": True,
        "reference_overlap": 1.0,
    }
    values.update(overrides)
    return GroundTruthSignals(**values)


def answered(**overrides):
    values = {
        "status": "completed",
        "no_answer": False,
        "retrieved_count": 3,
        "context_count": 3,
        "faithfulness": 1.0,
        "answer_relevance": 0.9,
        "evaluated": True,
    }
    values.update(overrides)
    return DiagnosisInput(**values)


@pytest.mark.parametrize(
    ("inp", "category", "rule"),
    [
        (answered(status="llm_failed", error_message="404"), "system_error", "S1"),
        (answered(ground_truth=gt(should_answer=False)), "generation_failure", "G1"),
        (answered(no_answer=True, ground_truth=gt(should_answer=False)), "none", "G2"),
        (answered(ground_truth=gt(relevant_total=0, relevant_retrieved=0, relevant_in_context=0)), "retrieval_failure", "G3"),
        (answered(ground_truth=gt(relevant_retrieved=0, relevant_in_context=0)), "retrieval_failure", "G4"),
        (answered(ground_truth=gt(relevant_in_context=0)), "context_construction_failure", "G5"),
        (answered(ground_truth=gt(evidence_in_context=False)), "context_construction_failure", "G6"),
        (answered(no_answer=True, validation_reason="weak_or_missing_citation_support", ground_truth=gt()), "generation_failure", "G7"),
        (answered(no_answer=True, ground_truth=gt()), "generation_failure", "G8"),
        (answered(contradiction=True, faithfulness=0.5, ground_truth=gt()), "generation_failure", "G9"),
        (answered(faithfulness=0.4, ground_truth=gt()), "generation_failure", "G10"),
        (answered(ground_truth=gt(reference_overlap=0.1)), "generation_failure", "G11"),
        (answered(ground_truth=gt()), "none", "G12"),
        (answered(retrieved_count=0, no_answer=True), "retrieval_failure", "L1"),
        (answered(dropped_context_count=2, no_answer=True), "context_construction_failure", "L2"),
        (answered(no_answer=True, validation_reason="weak_or_missing_citation_support"), "generation_failure", "L3"),
        (answered(contradiction=True), "generation_failure", "L4"),
        (answered(faithfulness=0.3), "generation_failure", "L5"),
        (answered(answer_relevance=0.1), "retrieval_failure", "L6"),
        (answered(answer_relevance=0.1, dropped_context_count=1), "context_construction_failure", "L6"),
        (answered(), "none", "L7"),
    ],
)
def test_rules(inp, category, rule):
    result = diagnose(inp)
    assert (result["category"], result["rule"]) == (category, rule)
    has_proof = inp.ground_truth is not None or inp.status in {"failed", "llm_failed"}
    assert result["confidence"] == ("confirmed" if has_proof else "suspected")
