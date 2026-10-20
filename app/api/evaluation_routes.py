"""Evaluation datasets, runs and run comparison."""

import json
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import AuthContext, require_auth
from app.core.config import settings
from app.core.errors import NotFoundError, ValidationAppError
from app.db.session import get_db
from app.models.evaluation import EvalCase, EvalDataset, EvalResult, EvalRun
from app.models.query_log import QueryLog
from app.schemas.evaluation import EvalDatasetCreate, EvalRunCreate
from app.services.evaluation_service import AnswerJudge, EvaluationRunner

router = APIRouter(prefix="/evaluation")

BENCHMARK_REPORT = Path(__file__).resolve().parents[2] / "evals" / "reports" / "diagnosis_benchmark.json"


@router.post("/datasets")
def create_dataset(payload: EvalDatasetCreate, db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> dict:
    dataset = EvalDataset(name=payload.name, description=payload.description, created_by=auth.user_id)
    for item in payload.cases:
        dataset.cases.append(
            EvalCase(
                external_id=item.id,
                question=item.question,
                should_answer=item.should_answer,
                expected_documents=item.expected_documents,
                expected_pages=item.expected_pages,
                expected_evidence=item.expected_evidence,
                reference_answer=item.reference_answer,
                tags=item.tags,
            )
        )
    db.add(dataset)
    db.commit()
    return _dataset_dict(dataset, len(payload.cases), include_cases=True)


@router.get("/datasets")
def list_datasets(db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> list[dict]:
    counts = dict(db.execute(select(EvalCase.dataset_id, func.count(EvalCase.id)).group_by(EvalCase.dataset_id)).all())
    datasets = db.execute(select(EvalDataset).order_by(EvalDataset.id.desc())).scalars()
    return [_dataset_dict(dataset, counts.get(dataset.id, 0)) for dataset in datasets]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> dict:
    dataset = db.get(EvalDataset, dataset_id)
    if dataset is None:
        raise NotFoundError("Evaluation dataset not found")
    return _dataset_dict(dataset, len(dataset.cases), include_cases=True)


@router.post("/runs")
def create_run(
    payload: EvalRunCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    dataset = db.get(EvalDataset, payload.dataset_id)
    if dataset is None:
        raise NotFoundError("Evaluation dataset not found")
    if not dataset.cases:
        raise ValidationAppError("Evaluation dataset has no cases")
    judge = AnswerJudge(method=payload.judge)
    config = {
        "top_k": payload.top_k or settings.retrieval_top_k,
        "retrieval_mode": payload.retrieval_mode or settings.retrieval_mode,
        "reranking_enabled": settings.reranking_enabled if payload.reranking_enabled is None else payload.reranking_enabled,
        "judge": judge.method,
        "ai_provider": settings.ai_provider,
        "chat_model": settings.active_chat_model,
        "embedding_model": settings.active_embedding_model,
        "min_vector_similarity": settings.vector_similarity_threshold,
        "min_keyword_score": settings.min_keyword_score,
        "min_citation_score": settings.min_citation_score,
        "max_context_chars": settings.max_context_chars,
        "chunk_size_tokens": settings.chunk_size_tokens,
        "auth": {"user_id": auth.user_id, "groups": auth.groups, "role": auth.role},
    }
    label = payload.label or f"{dataset.name} · {config['retrieval_mode']} · k={config['top_k']}"
    run = EvalRun(dataset_id=dataset.id, label=label, status="queued", config_json=config, case_count=len(dataset.cases), created_by=auth.user_id)
    db.add(run)
    db.commit()
    background_tasks.add_task(EvaluationRunner(judge=judge).run, run.id)
    return _run_dict(run)


@router.get("/runs")
def list_runs(
    dataset_id: int | None = None,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> list[dict]:
    statement = select(EvalRun).order_by(EvalRun.id.desc())
    if dataset_id is not None:
        statement = statement.where(EvalRun.dataset_id == dataset_id)
    return [_run_dict(run) for run in db.execute(statement).scalars()]


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> dict:
    run = db.get(EvalRun, run_id)
    if run is None:
        raise NotFoundError("Evaluation run not found")
    rows = db.execute(
        select(EvalResult, EvalCase, QueryLog)
        .outerjoin(EvalCase, EvalResult.case_id == EvalCase.id)
        .outerjoin(QueryLog, EvalResult.query_log_id == QueryLog.id)
        .where(EvalResult.run_id == run_id)
        .order_by(EvalResult.id)
    ).all()
    return {**_run_dict(run), "results": [_result_dict(result, case, log) for result, case, log in rows]}


@router.get("/compare")
def compare_runs(
    run_ids: str = Query(description="Comma-separated run IDs"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    try:
        ids = [int(part) for part in run_ids.split(",") if part.strip()]
    except ValueError as exc:
        raise ValidationAppError("run_ids must be comma-separated integers") from exc
    if not 1 <= len(ids) <= 6:
        raise ValidationAppError("Compare between 1 and 6 runs")
    runs = [db.get(EvalRun, run_id) for run_id in ids]
    if any(run is None for run in runs):
        raise NotFoundError("Evaluation run not found")

    # Per-case diagnosis across runs, for cases that the runs share.
    per_case: dict[int, dict] = {}
    rows = db.execute(
        select(EvalResult, EvalCase).join(EvalCase, EvalResult.case_id == EvalCase.id).where(EvalResult.run_id.in_(ids))
    ).all()
    for result, case in rows:
        entry = per_case.setdefault(case.id, {"case_id": case.id, "question": case.question, "runs": {}})
        retrieval = (result.metrics_json or {}).get("retrieval_quality") or {}
        answer = (result.metrics_json or {}).get("answer_quality") or {}
        entry["runs"][str(result.run_id)] = {
            "failure_category": result.failure_category,
            "subtype": (result.diagnosis_json or {}).get("subtype"),
            "recall_at_k": retrieval.get("recall_at_k"),
            "mrr": retrieval.get("mrr"),
            "faithfulness": answer.get("faithfulness"),
        }
    return {"runs": [_run_dict(run) for run in runs], "cases": list(per_case.values())}


@router.get("/diagnosis-benchmark")
def diagnosis_benchmark(auth: AuthContext = Depends(require_auth)) -> dict:
    """Latest report of the rule-based diagnosis benchmark (``python -m evals.diagnosis_benchmark``)."""
    if not BENCHMARK_REPORT.exists():
        return {"available": False, "command": "python -m evals.diagnosis_benchmark"}
    return {"available": True, **json.loads(BENCHMARK_REPORT.read_text(encoding="utf-8"))}


def _dataset_dict(dataset: EvalDataset, case_count: int, include_cases: bool = False) -> dict:
    payload = {
        "id": dataset.id,
        "name": dataset.name,
        "description": dataset.description,
        "created_by": dataset.created_by,
        "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
        "case_count": case_count,
    }
    if include_cases:
        payload["cases"] = [
            {
                "id": case.id,
                "external_id": case.external_id,
                "question": case.question,
                "should_answer": case.should_answer,
                "expected_documents": case.expected_documents,
                "expected_pages": case.expected_pages,
                "expected_evidence": case.expected_evidence,
                "reference_answer": case.reference_answer,
                "tags": case.tags,
            }
            for case in dataset.cases
        ]
    return payload


def _run_dict(run: EvalRun) -> dict:
    config = {key: value for key, value in (run.config_json or {}).items() if key != "auth"}
    return {
        "id": run.id,
        "dataset_id": run.dataset_id,
        "label": run.label,
        "status": run.status,
        "config": config,
        "summary": run.summary_json or {},
        "case_count": run.case_count,
        "completed_count": run.completed_count,
        "error_message": run.error_message,
        "created_by": run.created_by,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
    }


def _result_dict(result: EvalResult, case: EvalCase | None, log: QueryLog | None) -> dict:
    metrics = result.metrics_json or {}
    return {
        "id": result.id,
        "case_id": result.case_id,
        "question": case.question if case else None,
        "should_answer": case.should_answer if case else None,
        "expected_documents": case.expected_documents if case else [],
        "query_log_id": result.query_log_id,
        "answer": log.answer if log else None,
        "status": log.status if log else None,
        "latency_ms": log.latency_ms if log else None,
        "retrieval_quality": metrics.get("retrieval_quality"),
        "answer_quality": {key: value for key, value in (metrics.get("answer_quality") or {}).items() if key != "claims"},
        "ground_truth": metrics.get("ground_truth"),
        "failure_category": result.failure_category,
        "diagnosis": result.diagnosis_json or {},
    }
