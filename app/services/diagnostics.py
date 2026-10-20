"""Rule-based failure diagnosis for RAG traces.

Each query trace is classified into one category:

* ``retrieval_failure`` - the evidence needed was not retrieved.
* ``context_construction_failure`` - it was retrieved but did not reach the
  context sent to the LLM.
* ``generation_failure`` - the evidence reached the LLM but the answer is
  missing, unsupported, contradicting it, or wrong.
* ``system_error`` - a provider or internal error stopped the pipeline.
* ``none`` - no failure detected.

With ground truth (evaluation runs) the rules can confirm a failure. Live
traffic has no ground truth, so the same scenarios are inferred from trace
signals and reported with ``confidence="suspected"``. Rules are evaluated in
order and the first match wins; every rule has a stable ID so results can be
reported and checked against labelled failure scenarios.
"""

from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings

NONE = "none"
RETRIEVAL_FAILURE = "retrieval_failure"
CONTEXT_FAILURE = "context_construction_failure"
GENERATION_FAILURE = "generation_failure"
SYSTEM_ERROR = "system_error"
CATEGORIES = [RETRIEVAL_FAILURE, CONTEXT_FAILURE, GENERATION_FAILURE, SYSTEM_ERROR, NONE]

CATEGORY_LABELS = {
    RETRIEVAL_FAILURE: "Retrieval failure",
    CONTEXT_FAILURE: "Context construction problem",
    GENERATION_FAILURE: "Generation failure",
    SYSTEM_ERROR: "System error",
    NONE: "No failure detected",
}

# What an operator can do about each diagnosis.
RECOMMENDATIONS = {
    "llm_provider_error": "Check the model name, API key and provider status; the error message shows the provider's response.",
    "pipeline_error": "Inspect the error message and server logs for this trace ID.",
    "hallucinated_answer": "Tighten the no-answer instruction or raise MIN_CITATION_SCORE so unsupported answers are rejected.",
    "correct_refusal": "",
    "document_not_indexed": "Upload the expected document, or fix the expected document name in the dataset.",
    "relevant_not_retrieved": "Try hybrid retrieval, a larger top-K, lower similarity thresholds, or smaller chunks.",
    "relevant_chunk_dropped": "Raise MAX_CONTEXT_CHARS or reduce top-K so relevant chunks are not cut from the context.",
    "evidence_missing_from_context": "Use smaller or overlapping chunks so the evidence sentence stays inside one retrieved chunk.",
    "uncited_answer_rejected": "Strengthen the citation instruction in the prompt or try a model that follows citation formats.",
    "missed_answer": "Check the prompt: the model declined even though the evidence was provided.",
    "contradicts_evidence": "Review the cited chunks; consider a stronger model or a lower temperature.",
    "unfaithful": "Ask the model to answer strictly from the sources, or raise the citation threshold.",
    "incorrect_answer": "Compare the answer with the reference; the model may be misreading the evidence.",
    "no_relevant_chunks": "If the documents should cover this question, lower MIN_VECTOR_SIMILARITY or check that they are indexed.",
    "context_truncated": "Raise MAX_CONTEXT_CHARS or reduce top-K.",
    "answer_evidence_not_retrieved": "Check the retrieved chunks: try hybrid retrieval, a larger top-K, or confirm the documents cover the question.",
    "answer_evidence_not_in_context": "Raise MAX_CONTEXT_CHARS or reduce top-K so the dropped chunks reach the LLM.",
    "ok": "",
}


@dataclass(frozen=True)
class GroundTruthSignals:
    """Facts derived from an evaluation case's ground truth."""

    should_answer: bool
    relevant_total: int  # relevant chunks that exist in the indexed corpus
    relevant_retrieved: int  # relevant chunks among the final top-K
    relevant_in_context: int  # relevant chunks that made it into the LLM context
    evidence_in_context: bool | None = None  # expected evidence phrases present in context (None = not specified)
    reference_overlap: float | None = None  # share of reference-answer key terms found in the answer


@dataclass(frozen=True)
class DiagnosisInput:
    status: str  # completed | no_answer | llm_failed | failed
    no_answer: bool
    retrieved_count: int
    context_count: int = 0
    dropped_context_count: int = 0
    validation_reason: str | None = None
    error_message: str | None = None
    evaluated: bool = False
    faithfulness: float | None = None
    contradiction: bool = False
    answer_relevance: float | None = None
    ground_truth: GroundTruthSignals | None = None
    signals: dict[str, Any] = field(default_factory=dict)


def diagnose(inp: DiagnosisInput) -> dict[str, Any]:
    if inp.status in {"failed", "llm_failed"}:
        return _result(
            SYSTEM_ERROR,
            "llm_provider_error" if inp.status == "llm_failed" else "pipeline_error",
            "confirmed",
            "S1",
            "The pipeline stopped because of an error, so answer quality cannot be judged.",
            [inp.error_message or "Unknown error"],
            inp,
        )
    if inp.ground_truth is not None:
        return _diagnose_with_ground_truth(inp, inp.ground_truth)
    return _diagnose_live(inp)


def _diagnose_with_ground_truth(inp: DiagnosisInput, gt: GroundTruthSignals) -> dict[str, Any]:
    answered = not inp.no_answer
    if not gt.should_answer:
        if answered:
            return _result(
                GENERATION_FAILURE, "hallucinated_answer", "confirmed", "G1",
                "The question is not answerable from the documents, but the system produced an answer.",
                ["Ground truth marks this question as unanswerable."], inp,
            )
        return _result(NONE, "correct_refusal", "confirmed", "G2", "The system correctly declined an unanswerable question.", [], inp)

    if gt.relevant_total == 0:
        return _result(
            RETRIEVAL_FAILURE, "document_not_indexed", "confirmed", "G3",
            "No indexed chunk matches the expected source, so retrieval could not succeed.",
            ["Check that the expected document was uploaded and indexed."], inp,
        )
    if gt.relevant_retrieved == 0:
        return _result(
            RETRIEVAL_FAILURE, "relevant_not_retrieved", "confirmed", "G4",
            "The expected supporting document exists but none of its relevant chunks were retrieved.",
            [f"{gt.relevant_total} relevant chunk(s) exist; 0 were in the top {inp.signals.get('top_k', 'K')} results."], inp,
        )
    if gt.relevant_in_context == 0:
        return _result(
            CONTEXT_FAILURE, "relevant_chunk_dropped", "confirmed", "G5",
            "Relevant chunks were retrieved but were left out of the context sent to the LLM.",
            [f"{gt.relevant_retrieved} relevant chunk(s) retrieved, 0 included in the context."], inp,
        )
    if gt.evidence_in_context is False:
        return _result(
            CONTEXT_FAILURE, "evidence_missing_from_context", "confirmed", "G6",
            "A relevant document reached the context, but the essential evidence text did not.",
            ["None of the expected evidence phrases appear in the constructed context."], inp,
        )

    # From here on the evidence was available to the LLM.
    if inp.validation_reason == "weak_or_missing_citation_support":
        return _result(
            GENERATION_FAILURE, "uncited_answer_rejected", "confirmed", "G7",
            "The evidence was in the context, but the LLM's answer lacked valid citations and was rejected.",
            [], inp,
        )
    if inp.no_answer:
        return _result(
            GENERATION_FAILURE, "missed_answer", "confirmed", "G8",
            "The evidence was in the context, but the LLM said it could not find the answer.",
            [], inp,
        )
    if inp.contradiction:
        return _result(
            GENERATION_FAILURE, "contradicts_evidence", "confirmed", "G9",
            "Supporting evidence is present, but the answer contradicts it.", _faithfulness_reasons(inp), inp,
        )
    if inp.faithfulness is not None and inp.faithfulness < settings.faithfulness_threshold:
        return _result(
            GENERATION_FAILURE, "unfaithful", "confirmed", "G10",
            "Supporting evidence is present, but parts of the answer are not supported by it.", _faithfulness_reasons(inp), inp,
        )
    if gt.reference_overlap is not None and gt.reference_overlap < settings.reference_overlap_threshold:
        return _result(
            GENERATION_FAILURE, "incorrect_answer", "confirmed", "G11",
            "Supporting evidence is present, but the answer misses key facts of the reference answer.",
            [f"Reference key-term overlap {gt.reference_overlap:.2f} < {settings.reference_overlap_threshold:.2f}."], inp,
        )
    return _result(NONE, "ok", "confirmed", "G12", "Relevant evidence was retrieved, used, and reflected in the answer.", [], inp)


def _diagnose_live(inp: DiagnosisInput) -> dict[str, Any]:
    warnings: list[str] = []
    if inp.retrieved_count == 0:
        return _result(
            RETRIEVAL_FAILURE, "no_relevant_chunks", "suspected", "L1",
            "No chunk passed the relevance thresholds. Either the documents do not cover this question or retrieval missed it.",
            [], inp,
        )
    if inp.dropped_context_count > 0:
        warnings.append(f"{inp.dropped_context_count} retrieved chunk(s) were cut from the context by the size limit.")
        if inp.no_answer or (inp.faithfulness is not None and inp.faithfulness < settings.faithfulness_threshold):
            return _result(
                CONTEXT_FAILURE, "context_truncated", "suspected", "L2",
                "Retrieved chunks were dropped from the context and the answer is missing or weak.", warnings, inp,
            )
    if inp.validation_reason == "weak_or_missing_citation_support":
        return _result(
            GENERATION_FAILURE, "uncited_answer_rejected", "suspected", "L3",
            "The LLM's answer lacked valid citations, so the citation gate replaced it with a no-answer.", warnings, inp,
        )
    if not inp.no_answer:
        if inp.contradiction:
            return _result(
                GENERATION_FAILURE, "contradicts_evidence", "suspected", "L4",
                "The evaluator found claims that contradict the retrieved evidence.", warnings + _faithfulness_reasons(inp), inp,
            )
        if inp.faithfulness is not None and inp.faithfulness < settings.faithfulness_threshold:
            return _result(
                GENERATION_FAILURE, "unfaithful", "suspected", "L5",
                "Parts of the answer are not supported by the retrieved evidence.", warnings + _faithfulness_reasons(inp), inp,
            )
        if inp.answer_relevance is not None and inp.answer_relevance < settings.answer_relevance_threshold:
            # The answer is faithful to its context (L5 did not fire) yet misses the
            # question, so the needed evidence never reached the LLM: an upstream fault.
            relevance_reason = f"Answer relevance {inp.answer_relevance:.2f} < {settings.answer_relevance_threshold:.2f} while the answer is faithful to its context."
            if inp.dropped_context_count > 0:
                return _result(
                    CONTEXT_FAILURE, "answer_evidence_not_in_context", "suspected", "L6",
                    "The answer sticks to its context but misses the question; chunks cut from the context may have held the answer.",
                    warnings + [relevance_reason], inp,
                )
            return _result(
                RETRIEVAL_FAILURE, "answer_evidence_not_retrieved", "suspected", "L6",
                "The answer sticks to its context but misses the question, so the retrieved chunks probably do not contain the answer.",
                warnings + [relevance_reason], inp,
            )
    else:
        warnings.append("The LLM declined although chunks were retrieved; this is correct if they do not contain the answer.")
    summary = "No failure detected." if inp.evaluated or inp.no_answer else "No failure detected so far; evaluation is pending."
    return _result(NONE, "ok", "suspected", "L7", summary, warnings, inp)


def _faithfulness_reasons(inp: DiagnosisInput) -> list[str]:
    if inp.faithfulness is None:
        return []
    return [f"Faithfulness {inp.faithfulness:.2f} (threshold {settings.faithfulness_threshold:.2f})."]


def _result(
    category: str,
    subtype: str,
    confidence: str,
    rule: str,
    summary: str,
    reasons: list[str],
    inp: DiagnosisInput,
) -> dict[str, Any]:
    return {
        "category": category,
        "category_label": CATEGORY_LABELS[category],
        "subtype": subtype,
        "confidence": confidence,
        "rule": rule,
        "summary": summary,
        "reasons": reasons,
        "recommendation": RECOMMENDATIONS.get(subtype, ""),
        "ground_truth": inp.ground_truth is not None,
        "signals": {
            "status": inp.status,
            "no_answer": inp.no_answer,
            "retrieved_count": inp.retrieved_count,
            "context_count": inp.context_count,
            "dropped_context_count": inp.dropped_context_count,
            "validation_reason": inp.validation_reason,
            "faithfulness": inp.faithfulness,
            "contradiction": inp.contradiction,
            "answer_relevance": inp.answer_relevance,
            **({"ground_truth": inp.ground_truth.__dict__} if inp.ground_truth is not None else {}),
            **inp.signals,
        },
    }


def diagnosis_input_from_log(query_log: Any, ground_truth: GroundTruthSignals | None = None) -> DiagnosisInput:
    trace = query_log.trace_json or {}
    context = trace.get("context") or {}
    metrics = query_log.metrics_json or {}
    evaluation = query_log.evaluation_json or {}
    answer_quality = evaluation.get("answer_quality") or {}
    validation = query_log.validation_json or {}
    status = query_log.status
    if validation.get("reason") == "llm_provider_failed":
        # Older traces stored LLM failures with status "no_answer".
        status = "llm_failed"
    return DiagnosisInput(
        status=status,
        no_answer=bool(metrics.get("no_answer", query_log.status != "completed")),
        retrieved_count=len(query_log.retrieved_chunk_ids or []),
        context_count=len(context.get("chunk_ids") or []),
        dropped_context_count=len(context.get("dropped_chunk_ids") or []),
        validation_reason=validation.get("reason"),
        error_message=query_log.error_message,
        evaluated=query_log.evaluation_status == "completed",
        faithfulness=answer_quality.get("faithfulness"),
        contradiction=bool(answer_quality.get("contradiction")),
        answer_relevance=answer_quality.get("answer_relevance"),
        ground_truth=ground_truth,
        signals={"top_k": trace.get("top_k")},
    )


def apply_diagnosis(query_log: Any, ground_truth: GroundTruthSignals | None = None) -> dict[str, Any]:
    """Diagnose a query log in place and return the diagnosis."""
    previous = query_log.diagnosis_json or {}
    diagnosis = diagnose(diagnosis_input_from_log(query_log, ground_truth))
    # An LLM explanation stays valid only while the diagnosis it explains is unchanged.
    if previous.get("explanation") and previous.get("category") == diagnosis["category"] and previous.get("subtype") == diagnosis["subtype"]:
        diagnosis["explanation"] = previous["explanation"]
    query_log.diagnosis_json = diagnosis
    query_log.failure_category = diagnosis["category"]
    return diagnosis
