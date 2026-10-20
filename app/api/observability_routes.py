"""Trace history, analytics and diagnosis endpoints."""

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.routes import load_query_log, trace_payload
from app.core.auth import AuthContext, require_auth
from app.core.errors import ExternalServiceError
from app.db.session import get_db
from app.models.query_log import QueryLog
from app.services import analytics
from app.services.diagnosis_explainer import explain_diagnosis
from app.services.evaluation_service import AnswerJudge, evaluate_query_log

router = APIRouter()

Source = Literal["api", "evaluation", "all"]


@router.get("/queries")
def list_queries(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source: Source = "api",
    status: str | None = None,
    category: str | None = None,
    search: str | None = Query(default=None, max_length=200),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    statement = select(QueryLog)
    if source != "all":
        statement = statement.where(QueryLog.source == source)
    if not auth.is_admin:
        statement = statement.where(QueryLog.user_id == auth.user_id)
    if status:
        statement = statement.where(QueryLog.status == status)
    if category == "failures":
        statement = statement.where(QueryLog.failure_category.is_not(None), QueryLog.failure_category != "none")
    elif category:
        statement = statement.where(QueryLog.failure_category == category)
    if search:
        pattern = f"%{search}%"
        statement = statement.where(or_(QueryLog.query.ilike(pattern), QueryLog.trace_id.ilike(pattern)))
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    rows = db.execute(statement.order_by(QueryLog.id.desc()).limit(limit).offset(offset)).scalars()
    return {"total": total, "items": [analytics.query_list_item(row) for row in rows]}


@router.get("/analytics/summary")
def analytics_summary(
    source: Source = "api",
    days: int | None = Query(default=None, ge=1, le=365),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    return analytics.summary(analytics.load_logs(db, auth, source, days))


@router.get("/analytics/timeseries")
def analytics_timeseries(
    source: Source = "api",
    days: int | None = Query(default=30, ge=1, le=365),
    bucket: Literal["day", "hour"] = "day",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    return {"bucket": bucket, "points": analytics.timeseries(analytics.load_logs(db, auth, source, days), bucket)}


@router.post("/query/{query_log_id}/explain")
def explain_query(query_log_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> dict:
    """Add a natural-language explanation (LLM, or template offline) to the rule-based diagnosis."""
    query_log = load_query_log(db, query_log_id, auth)
    try:
        explanation = explain_diagnosis(query_log)
    except ExternalServiceError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ExternalServiceError(f"Explanation failed: {type(exc).__name__}: {str(exc)[:200]}") from exc
    query_log.diagnosis_json = {**(query_log.diagnosis_json or {}), "explanation": explanation}
    db.commit()
    return query_log.diagnosis_json


@router.post("/query/{query_log_id}/evaluate")
def evaluate_query(query_log_id: int, db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> dict:
    """Run (or re-run) answer-quality evaluation and diagnosis for one live trace now."""
    query_log = load_query_log(db, query_log_id, auth)
    evaluate_query_log(db, query_log, AnswerJudge())
    db.commit()
    return trace_payload(query_log)
