"""End-to-end API tests: ingestion, tracing, async evaluation, diagnosis, analytics, evaluation runs."""

from app.api import routes
from app.core.errors import ExternalServiceError
from tests.conftest import ADMIN, OTHER_USER, USER

QUESTION = "What minimum attendance must students maintain?"


def _ask(client, question=QUESTION, headers=USER):
    response = client.post("/api/v1/query", json={"question": question}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _trace(client, query_log_id, headers=USER):
    response = client.get(f"/api/v1/query/{query_log_id}/trace", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_text_upload_and_document_list(client, policy_document):
    assert policy_document["chunk_count"] >= 1
    documents = client.get("/api/v1/documents", headers=USER).json()
    names = {doc["filename"]: doc for doc in documents}
    assert names["attendance_policy.txt"]["visibility"] == "public"
    assert names["attendance_policy.txt"]["chunk_count"] >= 1


def test_unsupported_file_type_fails_with_message(client):
    response = client.post("/api/v1/documents/ingest", files={"file": ("notes.docx", b"PK..", "application/octet-stream")}, headers=USER)
    job = client.get(f"/api/v1/ingestion-jobs/{response.json()['job_id']}", headers=USER).json()
    assert job["status"] == "failed"
    assert "supported" in job["error_message"]


def test_answer_has_citations_stage_trace_and_background_evaluation(client, policy_document):
    body = _ask(client)
    assert not body["no_answer"]
    assert body["citations"] and body["citations"][0]["filename"] == "attendance_policy.txt"

    trace = _trace(client, body["query_log_id"])
    stage_names = [stage["name"] for stage in trace["stages"]]
    assert stage_names[:4] == ["query_embedding", "document_retrieval", "reranking", "access_control"]
    assert {"context_construction", "llm_generation", "citation_validation", "evaluation"} <= set(stage_names)
    assert trace["context"]["chunk_ids"]
    # TestClient runs background tasks before returning, so evaluation is done.
    assert trace["evaluation_status"] == "completed"
    quality = trace["evaluation"]["answer_quality"]
    assert quality["method"] == "heuristic" and quality["faithfulness"] == 1.0
    assert trace["evaluation"]["retrieval_quality"]["available"] is False
    assert trace["diagnosis"]["category"] == "none"


def test_off_topic_question_is_declined_and_diagnosed(client, policy_document):
    body = _ask(client, "How do I bake sourdough bread at home?")
    assert body["no_answer"]
    trace = _trace(client, body["query_log_id"])
    assert trace["diagnosis"]["category"] == "retrieval_failure"
    assert trace["diagnosis"]["confidence"] == "suspected"


def test_llm_failure_is_traced_as_system_error(client, policy_document, monkeypatch):
    def failing_answer(question, source_context):
        raise ExternalServiceError("LLM provider request failed: 404 model not found")

    monkeypatch.setattr(routes.query_pipeline.llm_service, "answer", failing_answer)
    body = _ask(client)
    assert body["no_answer"]
    trace = _trace(client, body["query_log_id"])
    assert trace["status"] == "llm_failed"
    assert "404" in trace["error_message"]
    assert trace["diagnosis"]["category"] == "system_error"
    assert trace["evaluation_status"] == "skipped"


def test_traces_are_private_to_their_user(client, policy_document):
    body = _ask(client)
    assert client.get(f"/api/v1/query/{body['query_log_id']}/trace", headers=OTHER_USER).status_code == 404
    assert client.get(f"/api/v1/query/{body['query_log_id']}/trace", headers=ADMIN).status_code == 200


def test_history_analytics_and_explanation(client, policy_document):
    body = _ask(client)
    history = client.get("/api/v1/queries", params={"limit": 5}, headers=USER).json()
    assert history["total"] >= 1 and history["items"][0]["id"] == body["query_log_id"]

    failures = client.get("/api/v1/queries", params={"category": "failures"}, headers=USER).json()
    assert all(item["failure_category"] not in (None, "none") for item in failures["items"])

    summary = client.get("/api/v1/analytics/summary", headers=USER).json()
    assert summary["total_queries"] >= 1
    assert summary["avg_latency_ms"] is not None
    assert {item["category"] for item in summary["failure_categories"]} >= {"retrieval_failure", "none"}
    assert any(stage["name"] == "llm_generation" for stage in summary["stage_latency"])

    series = client.get("/api/v1/analytics/timeseries", headers=USER).json()
    assert series["points"] and series["points"][-1]["queries"] >= 1

    explained = client.post(f"/api/v1/query/{body['query_log_id']}/explain", headers=USER).json()
    assert explained["explanation"]["method"] == "template"
    assert explained["explanation"]["text"]


def test_evaluation_run_reports_ground_truth_metrics_and_compares(client, policy_document):
    dataset = client.post(
        "/api/v1/evaluation/datasets",
        json={
            "name": "Policy QA",
            "cases": [
                {
                    "id": "q1",
                    "question": QUESTION,
                    "expected_documents": ["attendance_policy.txt"],
                    "expected_evidence": ["minimum attendance of 75 percent"],
                    "reference_answer": "75 percent",
                },
                # Legacy golden_qa field names are accepted.
                {"id": "q2", "question": "How many books does the library lend?", "expected_source_filename": "attendance_policy.txt"},
                {"id": "q3", "question": "How do I bake sourdough bread at home?", "should_answer": False},
            ],
        },
        headers=USER,
    )
    assert dataset.status_code == 200, dataset.text
    dataset_id = dataset.json()["id"]

    run_ids = []
    for mode in ("hybrid", "vector"):
        created = client.post("/api/v1/evaluation/runs", json={"dataset_id": dataset_id, "retrieval_mode": mode, "top_k": 4}, headers=USER)
        assert created.status_code == 200, created.text
        run_ids.append(created.json()["id"])

    run = client.get(f"/api/v1/evaluation/runs/{run_ids[0]}", headers=USER).json()
    assert run["status"] == "completed", run.get("error_message")
    assert run["completed_count"] == 3
    summary = run["summary"]
    assert summary["retrieval"]["recall_at_k"] == 1.0
    assert summary["retrieval"]["mrr"] == 1.0
    assert summary["retrieval"]["measured_cases"] == 2
    assert summary["answer"]["answer_decision_accuracy"] is not None
    assert run["config"]["retrieval_mode"] == "hybrid" and "auth" not in run["config"]
    first = run["results"][0]
    assert first["retrieval_quality"]["available"] is True
    assert first["diagnosis"]["ground_truth"] is True
    refusal = run["results"][2]
    assert refusal["failure_category"] == "none"

    comparison = client.get("/api/v1/evaluation/compare", params={"run_ids": ",".join(map(str, run_ids))}, headers=USER).json()
    assert len(comparison["runs"]) == 2
    assert len(comparison["cases"]) == 3
    assert set(comparison["cases"][0]["runs"]) == {str(run_id) for run_id in run_ids}

    # Evaluation traffic stays out of the live-traffic dashboard by default.
    live = client.get("/api/v1/queries", params={"source": "api", "limit": 200}, headers=USER).json()
    assert all(item["source"] == "api" for item in live["items"])


def test_dataset_validation_requires_expected_documents(client):
    response = client.post("/api/v1/evaluation/datasets", json={"name": "bad", "cases": [{"question": "Answerable but no source?"}]}, headers=USER)
    assert response.status_code == 422
