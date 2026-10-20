"""End-to-end query pipeline with stage-level tracing.

Every query produces one ``QueryLog`` row (the trace) whether it answers,
declines, or fails. Live API traffic and evaluation runs share this code path,
so evaluation measures exactly what users experience.
"""

import logging
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.core.auth import AuthContext
from app.core.config import settings
from app.core.errors import AppError
from app.models.citation import Citation
from app.models.query_log import QueryLog
from app.schemas.query import CitationResponse, QueryResponse
from app.services.access_control import filter_retrieved_chunks
from app.services.citation_formatter import (
    RetrievedChunk,
    answer_has_strong_citation_support,
    build_source_context,
    select_citations_for_answer,
)
from app.services.diagnostics import apply_diagnosis
from app.services.llm_service import LLMService
from app.services.observability import LangfuseTracer, QueryObservation, estimate_cost
from app.services.retrieval_service import RetrievalService, serialize_results

logger = logging.getLogger(__name__)

NO_ANSWER_TEXT = "I could not find this in the uploaded documents."
LLM_FAILURE_ANSWER = "The answer could not be generated because the language model request failed. Open the trace for the error details."

# Display names for the stages recorded in metrics_json["stages"], in execution order.
STAGE_LABELS = {
    "query_embedding": "Query embedding",
    "document_retrieval": "Document retrieval",
    "reranking": "Reranking",
    "access_control": "Access control",
    "context_construction": "Context construction",
    "llm_generation": "LLM generation",
    "citation_validation": "Citation validation",
    "evaluation": "Evaluation",
}

ContextBuilder = Callable[..., tuple[str, list[dict]]]


class StageRecorder:
    def __init__(self) -> None:
        self.stages: list[dict[str, Any]] = []

    def add(self, name: str, ms: int | float, **extra: Any) -> None:
        self.stages.append({"name": name, "label": STAGE_LABELS.get(name, name), "ms": int(ms), "status": "completed", **extra})

    @contextmanager
    def time(self, name: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            self.add(name, _elapsed_ms(started))


@dataclass
class PipelineOutcome:
    query_log: QueryLog
    response: QueryResponse
    results: list[RetrievedChunk] = field(default_factory=list)


class QueryPipeline:
    def __init__(
        self,
        retrieval_service: RetrievalService | None = None,
        llm_service: LLMService | None = None,
        tracer: LangfuseTracer | None = None,
        context_builder: ContextBuilder | None = None,
    ):
        self.retrieval_service = retrieval_service or RetrievalService()
        self.llm_service = llm_service or LLMService()
        self.tracer = tracer or LangfuseTracer()
        self.context_builder = context_builder or build_source_context

    def run(
        self,
        db: Session,
        question: str,
        auth: AuthContext,
        trace_id: str | None = None,
        top_k: int | None = None,
        source: str = "api",
        retrieval_mode: str | None = None,
        rerank: bool | None = None,
        evaluate: bool | None = None,
    ) -> PipelineOutcome:
        trace_id = trace_id or uuid.uuid4().hex
        evaluate = settings.evaluation_enabled if evaluate is None else evaluate
        started = time.perf_counter()
        stages = StageRecorder()
        common = {
            "db": db,
            "trace_id": trace_id,
            "question": question,
            "auth": auth,
            "started": started,
            "stages": stages,
            "source": source,
            "evaluate": evaluate,
        }

        try:
            retrieval = self.retrieval_service.retrieve_with_trace(
                db=db, query=question, top_k=top_k, auth=auth, mode=retrieval_mode, rerank=rerank
            )
            retrieval_metrics = retrieval.metrics
            embedding_ms = retrieval_metrics.get("embedding_latency_ms", 0)
            rerank_ms = retrieval_metrics.get("rerank_latency_ms", 0)
            stages.add("query_embedding", embedding_ms)
            stages.add("document_retrieval", max(0, retrieval_metrics.get("retrieval_latency_ms", 0) - embedding_ms - rerank_ms))
            stages.add("reranking", rerank_ms)

            with stages.time("access_control"):
                results, denied = filter_retrieved_chunks(retrieval.results, auth)
            trace = {
                **retrieval.trace,
                "top_k": top_k or settings.retrieval_top_k,
                "retrieved_chunks": serialize_results(results),
            }
            common.update(retrieval_metrics=retrieval_metrics, denied=denied, results=results)

            if not results:
                return self._finish(
                    **common,
                    trace=trace,
                    answer=NO_ANSWER_TEXT,
                    status="no_answer",
                    validation={"support_ok": False, "reason": "empty_retrieval"},
                    empty_retrieval=True,
                )

            with stages.time("context_construction"):
                source_context, citation_payloads = self.context_builder(results, max_chars=settings.max_context_chars)
            context_ids = [payload["chunk_id"] for payload in citation_payloads]
            trace["context"] = {
                "chunk_ids": context_ids,
                "labels": {payload["label"]: payload["chunk_id"] for payload in citation_payloads},
                "dropped_chunk_ids": [result.chunk.id for result in results if result.chunk.id not in context_ids],
                "chars": len(source_context),
                "max_chars": settings.max_context_chars,
                # The exact text sent to the LLM, so evaluation and diagnosis see what the model saw.
                "text": source_context,
            }

            llm_started = time.perf_counter()
            try:
                llm_result = self.llm_service.answer(question=question, source_context=source_context)
            except AppError as exc:
                stages.add("llm_generation", _elapsed_ms(llm_started), status="failed")
                logger.warning(
                    "llm_provider_failed",
                    extra={"event": "llm_provider_failed", "reason": exc.message[:300], "trace_id": trace_id},
                )
                return self._finish(
                    **common,
                    trace=trace,
                    answer=LLM_FAILURE_ANSWER,
                    status="llm_failed",
                    validation={"support_ok": False, "reason": "llm_provider_failed", "error": exc.message},
                    error_message=exc.message,
                    llm_failed=True,
                )
            stages.add("llm_generation", _elapsed_ms(llm_started))

            with stages.time("citation_validation"):
                answer, selected = select_citations_for_answer(llm_result.answer, citation_payloads)
                support_ok = answer_has_strong_citation_support(answer, selected, min_score=settings.min_citation_score)
                no_answer = "could not find" in answer.lower() or not support_ok
                if not support_ok:
                    answer = NO_ANSWER_TEXT
                    selected = []
            trace["raw_answer"] = llm_result.answer
            trace["final_citations"] = selected
            return self._finish(
                **common,
                trace=trace,
                answer=answer,
                status="no_answer" if no_answer else "completed",
                validation={
                    "support_ok": support_ok,
                    "reason": "ok" if support_ok else "weak_or_missing_citation_support",
                    "min_citation_score": settings.min_citation_score,
                },
                citations=[] if no_answer else selected,
                no_answer=no_answer,
                usage=llm_result,
            )
        except AppError as exc:
            db.rollback()
            self._record_failure(common, exc.message)
            raise
        except Exception as exc:
            db.rollback()
            self._record_failure(common, f"Internal error: {type(exc).__name__}: {str(exc)[:300]}")
            raise

    def _finish(
        self,
        db: Session,
        trace_id: str,
        question: str,
        auth: AuthContext,
        started: float,
        stages: StageRecorder,
        source: str,
        evaluate: bool,
        trace: dict,
        answer: str,
        status: str,
        validation: dict,
        retrieval_metrics: dict | None = None,
        denied: int = 0,
        results: list[RetrievedChunk] | None = None,
        citations: list[dict] | None = None,
        no_answer: bool = True,
        empty_retrieval: bool = False,
        llm_failed: bool = False,
        error_message: str | None = None,
        usage: Any = None,
    ) -> PipelineOutcome:
        results = results or []
        citations = citations or []
        prompt_tokens = getattr(usage, "prompt_tokens", None)
        completion_tokens = getattr(usage, "completion_tokens", None)
        total_tokens = getattr(usage, "total_tokens", None)
        metrics = build_metrics(
            started=started,
            retrieval_metrics=retrieval_metrics or {},
            stages=stages,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            empty_retrieval=empty_retrieval,
            no_answer=no_answer,
            citation_failure=not validation.get("support_ok", False) and validation.get("reason") == "weak_or_missing_citation_support",
            llm_failed=llm_failed,
        )
        should_evaluate = evaluate and status in {"completed", "no_answer"}
        query_log = QueryLog(
            trace_id=trace_id,
            query=question,
            answer=answer,
            retrieved_chunk_ids=[result.chunk.id for result in results],
            latency_ms=_elapsed_ms(started),
            model=settings.active_chat_model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            trace_json=trace,
            metrics_json=metrics,
            validation_json=validation,
            user_id=auth.user_id,
            groups=auth.groups,
            auth_role=auth.role,
            denied_retrieval_count=denied,
            status=status,
            error_message=error_message,
            source=source,
            evaluation_status="pending" if should_evaluate else "skipped",
            evaluation_json={},
        )
        # Rule-based diagnosis on what is known now; refined after evaluation.
        apply_diagnosis(query_log)
        db.add(query_log)
        db.flush()

        citation_responses: list[CitationResponse] = []
        for payload in citations:
            db.add(
                Citation(
                    query_log_id=query_log.id,
                    chunk_id=payload["chunk_id"],
                    citation_label=payload["label"],
                    source_filename=payload["filename"],
                    page_start=payload["page_start"],
                    page_end=payload["page_end"],
                    score=payload["score"],
                    snippet=payload["snippet"],
                )
            )
            citation_responses.append(CitationResponse(**payload))
        db.commit()

        self.tracer.trace_query(
            QueryObservation(
                trace_id=trace_id,
                query=question,
                answer=answer,
                retrieved_chunks=trace.get("retrieved_chunks", []),
                citations=citations,
                metrics=metrics,
                validation=validation,
                model_usage={
                    "model": settings.active_chat_model,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": total_tokens,
                    "estimated_cost": metrics.get("estimated_cost"),
                },
            )
        )
        logger.info(
            "query_completed",
            extra={
                "event": "query_completed",
                "trace_id": trace_id,
                "latency_ms": query_log.latency_ms,
                "model": settings.active_chat_model,
                "total_tokens": total_tokens,
            },
        )
        response = QueryResponse(
            trace_id=trace_id,
            query_log_id=query_log.id,
            answer=answer,
            citations=citation_responses,
            no_answer=no_answer,
        )
        return PipelineOutcome(query_log=query_log, response=response, results=results)

    def _record_failure(self, common: dict, error_message: str) -> None:
        db: Session = common["db"]
        auth: AuthContext = common["auth"]
        trace_id = common["trace_id"]
        try:
            metrics = build_metrics(
                started=common["started"],
                retrieval_metrics=common.get("retrieval_metrics", {}),
                stages=common["stages"],
                prompt_tokens=None,
                completion_tokens=None,
                empty_retrieval=False,
                no_answer=False,
                citation_failure=False,
            )
            query_log = QueryLog(
                trace_id=trace_id,
                query=common["question"],
                answer=None,
                retrieved_chunk_ids=[],
                latency_ms=_elapsed_ms(common["started"]),
                model=settings.active_chat_model,
                trace_json={},
                metrics_json=metrics,
                validation_json={"support_ok": False, "reason": "query_failed"},
                user_id=auth.user_id,
                groups=auth.groups,
                auth_role=auth.role,
                denied_retrieval_count=0,
                status="failed",
                error_message=error_message,
                source=common["source"],
                evaluation_status="skipped",
                evaluation_json={},
            )
            apply_diagnosis(query_log)
            db.add(query_log)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("failed_to_record_query_failure", extra={"event": "failed_to_record_query_failure", "trace_id": trace_id})
        logger.warning("query_failed", extra={"event": "query_failed", "trace_id": trace_id})


def build_metrics(
    started: float,
    retrieval_metrics: dict,
    stages: StageRecorder,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    empty_retrieval: bool,
    no_answer: bool,
    citation_failure: bool,
    llm_failed: bool = False,
) -> dict:
    stage_ms = {stage["name"]: stage["ms"] for stage in stages.stages}
    return {
        "query_latency_ms": _elapsed_ms(started),
        "retrieval_latency_ms": retrieval_metrics.get("retrieval_latency_ms", 0),
        "embedding_latency_ms": retrieval_metrics.get("embedding_latency_ms", 0),
        "llm_latency_ms": stage_ms.get("llm_generation", 0),
        "stages": list(stages.stages),
        "empty_retrieval": empty_retrieval,
        "no_answer": no_answer,
        "citation_failure": citation_failure,
        "llm_failed": llm_failed,
        "estimated_cost": estimate_cost(prompt_tokens, completion_tokens),
    }


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
