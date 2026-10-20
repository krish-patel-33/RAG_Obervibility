from app.services.evaluation_service import ContextBlock, heuristic_judge, parse_json_object, reference_overlap, retrieval_metrics

CONTEXT = [ContextBlock(label="S1", chunk_id=1, text="Students must maintain a minimum attendance of 75 percent in every course.")]


def test_retrieval_metrics():
    metrics = retrieval_metrics([5, 1, 7, 2], relevant_ids={1, 2, 9}, k=4)
    assert metrics["recall_at_k"] == round(2 / 3, 4)
    assert metrics["precision_at_k"] == 0.5
    assert metrics["mrr"] == 0.5
    assert metrics["hit_at_k"] == 1.0


def test_retrieval_metrics_without_ground_truth_are_not_invented():
    metrics = retrieval_metrics([1, 2], relevant_ids=set(), k=2)
    assert metrics["recall_at_k"] is None and metrics["mrr"] is None


def test_heuristic_judge_supported_claim():
    result = heuristic_judge("What minimum attendance is required?", "Students must maintain a minimum attendance of 75 percent [S1].", CONTEXT)
    assert result["faithfulness"] == 1.0 and not result["contradiction"]
    assert result["answer_relevance"] > 0.5


def test_heuristic_judge_flags_number_contradiction():
    result = heuristic_judge("What minimum attendance is required?", "Students must maintain a minimum attendance of 60 percent [S1].", CONTEXT)
    assert result["contradiction"] and result["faithfulness"] == 0.0


def test_reference_overlap():
    assert reference_overlap("The minimum is 75 percent [S1].", "75 percent") == 1.0
    assert reference_overlap("The minimum is 60 percent.", "75 percent") == 0.5
    assert reference_overlap("anything", None) is None


def test_parse_json_object_tolerates_code_fences():
    fenced = "```json\n" + '{"claims": [], "answer_relevance": 0.9}' + "\n```"
    assert parse_json_object(fenced) == {"claims": [], "answer_relevance": 0.9}
