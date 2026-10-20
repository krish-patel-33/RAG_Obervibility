"""Aggregations over query traces for the dashboard."""

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import AuthContext
from app.models.query_log import QueryLog
from app.services.diagnostics import CATEGORIES, CATEGORY_LABELS
from app.services.query_pipeline import STAGE_LABELS

ERROR_STATUSES = {"failed", "llm_failed"}
MAX_ROWS = 20000


def load_logs(db: Session, auth: AuthContext, source: str | None = "api", days: int | None = None) -> list[QueryLog]:
    statement = select(QueryLog).order_by(QueryLog.id.desc()).limit(MAX_ROWS)
    if source and source != "all":
        statement = statement.where(QueryLog.source == source)
    if not auth.is_admin:
        statement = statement.where(QueryLog.user_id == auth.user_id)
    logs = list(db.execute(statement).scalars())
    if days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        logs = [log for log in logs if as_utc(log.created_at) >= cutoff]
    return logs


def summary(logs: list[QueryLog]) -> dict[str, Any]:
    total = len(logs)
    latencies = sorted(log.latency_ms for log in logs)
    errors = sum(1 for log in logs if log.status in ERROR_STATUSES)
    answered = sum(1 for log in logs if log.status == "completed")
    no_answer = sum(1 for log in logs if log.status == "no_answer")
    quality = [_answer_quality(log) for log in logs]
    categories = {category: 0 for category in CATEGORIES}
    subtypes: dict[str, int] = defaultdict(int)
    undiagnosed = 0
    for log in logs:
        # Traces recorded before diagnosis existed have no category; don't count them as healthy.
        if log.failure_category is None:
            undiagnosed += 1
            continue
        category = log.failure_category
        categories[category] = categories.get(category, 0) + 1
        subtype = (log.diagnosis_json or {}).get("subtype")
        if category != "none" and subtype:
            subtypes[f"{category}:{subtype}"] += 1
    return {
        "total_queries": total,
        "answered": answered,
        "no_answer": no_answer,
        "errors": errors,
        "error_rate": _ratio(errors, total),
        "no_answer_rate": _ratio(no_answer, total),
        "avg_latency_ms": round(mean(latencies), 1) if latencies else None,
        "p50_latency_ms": percentile(latencies, 0.50),
        "p95_latency_ms": percentile(latencies, 0.95),
        "avg_faithfulness": _mean(item.get("faithfulness") for item in quality),
        "avg_answer_relevance": _mean(item.get("answer_relevance") for item in quality),
        "evaluated": sum(1 for log in logs if log.evaluation_status == "completed"),
        "pending_evaluations": sum(1 for log in logs if log.evaluation_status == "pending"),
        "total_tokens": sum(log.total_tokens or 0 for log in logs),
        "avg_tokens": _mean(log.total_tokens for log in logs if log.total_tokens),
        "estimated_cost": round(sum((log.metrics_json or {}).get("estimated_cost") or 0.0 for log in logs), 6),
        "failure_categories": [
            {"category": category, "label": CATEGORY_LABELS[category], "count": count} for category, count in categories.items()
        ],
        "undiagnosed": undiagnosed,
        "failure_subtypes": [{"key": key, "count": count} for key, count in sorted(subtypes.items(), key=lambda item: -item[1])],
        "stage_latency": stage_averages(logs),
    }


def stage_averages(logs: list[QueryLog]) -> list[dict[str, Any]]:
    values: dict[str, list[int]] = defaultdict(list)
    for log in logs:
        for stage in (log.metrics_json or {}).get("stages") or []:
            values[stage["name"]].append(stage.get("ms") or 0)
    return [
        {"name": name, "label": label, "avg_ms": round(mean(values[name]), 1), "samples": len(values[name])}
        for name, label in STAGE_LABELS.items()
        if values.get(name)
    ]


def timeseries(logs: list[QueryLog], bucket: str = "day") -> list[dict[str, Any]]:
    fmt = "%Y-%m-%d %H:00" if bucket == "hour" else "%Y-%m-%d"
    groups: dict[str, list[QueryLog]] = defaultdict(list)
    for log in logs:
        groups[as_utc(log.created_at).strftime(fmt)].append(log)
    points = []
    for key in sorted(groups):
        items = groups[key]
        quality = [_answer_quality(log) for log in items]
        errors = sum(1 for log in items if log.status in ERROR_STATUSES)
        points.append(
            {
                "bucket": key,
                "queries": len(items),
                "errors": errors,
                "error_rate": _ratio(errors, len(items)),
                "avg_latency_ms": round(mean(log.latency_ms for log in items), 1),
                "p95_latency_ms": percentile(sorted(log.latency_ms for log in items), 0.95),
                "avg_faithfulness": _mean(item.get("faithfulness") for item in quality),
                "avg_answer_relevance": _mean(item.get("answer_relevance") for item in quality),
                "tokens": sum(log.total_tokens or 0 for log in items),
                "failures": sum(1 for log in items if log.failure_category not in (None, "none")),
            }
        )
    return points


def query_list_item(log: QueryLog) -> dict[str, Any]:
    quality = _answer_quality(log)
    diagnosis = log.diagnosis_json or {}
    return {
        "id": log.id,
        "trace_id": log.trace_id,
        "query": log.query,
        "status": log.status,
        "source": log.source,
        "latency_ms": log.latency_ms,
        "total_tokens": log.total_tokens,
        "model": log.model,
        "evaluation_status": log.evaluation_status,
        "faithfulness": quality.get("faithfulness"),
        "answer_relevance": quality.get("answer_relevance"),
        "failure_category": log.failure_category,
        "failure_subtype": diagnosis.get("subtype"),
        "confidence": diagnosis.get("confidence"),
        "user_id": log.user_id,
        "created_at": as_utc(log.created_at).isoformat() if log.created_at else None,
    }


def percentile(sorted_values: list[int], fraction: float) -> int | None:
    if not sorted_values:
        return None
    # Nearest-rank percentile.
    index = max(0, math.ceil(fraction * len(sorted_values)) - 1)
    return sorted_values[index]


def as_utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _answer_quality(log: QueryLog) -> dict[str, Any]:
    return (log.evaluation_json or {}).get("answer_quality") or {}


def _ratio(part: int, total: int) -> float | None:
    return round(part / total, 4) if total else None


def _mean(values: Any) -> float | None:
    numbers = [float(value) for value in values if value is not None]
    return round(mean(numbers), 4) if numbers else None
