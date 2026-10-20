"""Benchmark for the rule-based failure diagnosis.

Builds an isolated corpus, then runs labelled scenarios through the real query
pipeline. Each scenario injects one known fault (or none):

* retrieval failures  - expected document not indexed; retriever that misses it
* context problems    - relevant chunk dropped from the context; evidence cut out
* generation failures - LLM that contradicts, refuses, omits citations, or
                        answers an unanswerable question
* healthy controls    - correct answers and correct refusals

The diagnosis for each scenario is compared with its label to report accuracy,
per-class precision/recall and a confusion matrix.

Run:  python -m evals.diagnosis_benchmark [--output PATH]

The benchmark uses its own temporary SQLite database and the deterministic
local embedding model, so results are reproducible and need no API key.
"""

import argparse
import json
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

_TMP = Path(tempfile.mkdtemp(prefix="diagnosis-benchmark-"))
if "app.core.config" not in sys.modules:
    # Standalone run: isolate from the developer's .env before the app loads.
    os.environ.update(
        {
            "APP_ENV": "test",
            "DATABASE_URL": f"sqlite:///{(_TMP / 'benchmark.db').as_posix()}",
            "LOCAL_STORAGE_PATH": str(_TMP / "storage"),
            "AI_PROVIDER": "local",
            "ADMIN_API_KEYS": "benchmark-admin",
            "USER_API_KEYS": "benchmark-user:bench-user:default",
            "RATE_LIMIT_ENABLED": "false",
            "EVALUATION_JUDGE": "heuristic",
        }
    )

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.core.auth import AuthContext  # noqa: E402
from app.db.base import Base  # noqa: E402
from app import models  # noqa: E402,F401
from app.models.evaluation import EvalCase  # noqa: E402
from app.services.citation_formatter import build_source_context  # noqa: E402
from app.services.diagnostics import CATEGORIES, diagnose, diagnosis_input_from_log  # noqa: E402
from app.services.evaluation_service import AnswerJudge, evaluate_query_log, find_relevant_chunk_ids  # noqa: E402
from app.services.ingestion_service import IngestionService  # noqa: E402
from app.services.llm_service import LLMResult  # noqa: E402
from app.services.query_pipeline import QueryPipeline  # noqa: E402
from app.services.retrieval_service import RetrievalService  # noqa: E402
from app.services.storage import LocalStorageBackend  # noqa: E402
from app.utils.text import content_tokens  # noqa: E402

REPORT_PATH = Path(__file__).resolve().parent / "reports" / "diagnosis_benchmark.json"
NO_ANSWER = "I could not find this in the uploaded documents."

CORPUS = {
    "attendance_policy.txt": (
        "Attendance Policy. Students must maintain a minimum attendance of 75 percent in every course to sit the final examination. "
        "Medical leave certified by a doctor can condone up to 10 percent of the attendance shortfall. "
        "Attendance is recorded by the course instructor at the start of each lecture."
    ),
    "examination_rules.txt": (
        "Examination Rules. The semester examination lasts 180 minutes and begins at 10 AM. "
        "Candidates must carry their hall ticket; entry is refused 30 minutes after the start. "
        "Revaluation requests must be filed within 15 days of the result announcement."
    ),
    "library_rules.txt": (
        "Library Rules. Each student may borrow at most 4 books at a time for a period of 14 days. "
        "A late fine of 5 rupees per day is charged for every overdue book. "
        "Reference journals cannot be taken out of the reading hall."
    ),
    "fee_payment.txt": (
        "Fee Payment. Tuition fees must be paid before the 30th of July each academic year. "
        "A late payment penalty of 500 rupees applies during the first week after the deadline. "
        "Scholarship holders submit their sanction letter to the accounts office."
    ),
    "hostel_rules.txt": (
        "Hostel Rules. The hostel gates close at 9 PM on weekdays and 10 PM on weekends. "
        "Visitors are allowed only in the common lounge between 4 PM and 7 PM. "
        "Cooking appliances are not permitted inside the rooms."
    ),
}

# (question, document, evidence phrase, reference answer)
QUESTIONS = [
    ("What minimum attendance must students maintain?", "attendance_policy.txt", "minimum attendance of 75 percent", "75 percent"),
    ("How long does the semester examination last?", "examination_rules.txt", "lasts 180 minutes", "180 minutes"),
    ("How many books may a student borrow from the library?", "library_rules.txt", "at most 4 books", "4 books for 14 days"),
    ("What is the deadline for paying tuition fees?", "fee_payment.txt", "before the 30th of July", "30th of July"),
    ("When do the hostel gates close on weekdays?", "hostel_rules.txt", "close at 9 PM on weekdays", "9 PM"),
]

# Off-topic: retrieval finds nothing, so the pipeline declines before the LLM.
OFF_TOPIC = [
    "What is the capital city of Australia?",
    "Who won the football world cup in 2018?",
    "How do I bake sourdough bread at home?",
]
# Near-domain but unanswerable: related chunks are retrieved, yet none states the answer.
NEAR_DOMAIN_UNANSWERABLE = [
    "What is the fine for losing a library book?",
    "How many visitors are allowed in the hostel lounge at once?",
    "What is the late fee for paying tuition fees in the second week?",
]


# --------------------------------------------------------------------------
# Injected components
# --------------------------------------------------------------------------

BLOCK_RE = re.compile(r"\[(S\d+)\][^\n]*\n(.*?)(?=\n\n---\n\n|\Z)", re.S)
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def _best_sentence(question: str, source_context: str) -> tuple[str, str] | None:
    terms = content_tokens(question)
    best: tuple[float, str, str] | None = None
    for label, text in BLOCK_RE.findall(source_context):
        for sentence in SENTENCE_RE.split(" ".join(text.split())):
            score = len(terms & content_tokens(sentence))
            if sentence and (best is None or score > best[0]):
                best = (score, label, sentence.rstrip(".!?"))
    return (best[1], best[2]) if best else None


class StubLLM:
    """Deterministic stand-in for the answer LLM; ``mode`` selects the injected behaviour."""

    available = False

    def __init__(self, mode: str = "faithful"):
        self.mode = mode

    def answer(self, question: str, source_context: str) -> LLMResult:
        best = _best_sentence(question, source_context)
        if self.mode == "refuse" or best is None:
            text = NO_ANSWER
        elif self.mode == "hallucinate":
            text = "The office is open from 8 AM to 6 PM on all working days [S1]."
        else:
            label, sentence = best
            if self.mode == "contradict":
                sentence = re.sub(r"\d+", lambda m: str(int(m.group()) + 17), sentence)
            text = f"{sentence}." if self.mode == "uncited" else f"{sentence} [{label}]."
        return LLMResult(answer=text, prompt_tokens=0, completion_tokens=0, total_tokens=0)

    def complete(self, system_prompt: str, user_prompt: str, json_output: bool = False) -> LLMResult:
        raise RuntimeError("StubLLM does not judge")


class MissingDocumentRetriever(RetrievalService):
    """Retriever fault: never returns chunks of the given document."""

    def __init__(self, hidden_filename: str):
        super().__init__()
        self.hidden_filename = hidden_filename

    def retrieve_with_trace(self, *args: Any, **kwargs: Any):
        result = super().retrieve_with_trace(*args, **kwargs)
        kept = [item for item in result.results if item.chunk.document.filename != self.hidden_filename]
        return type(result)(results=kept, trace=result.trace, metrics=result.metrics)


def dropping_context_builder(hidden_filename: str) -> Callable[..., tuple[str, list[dict]]]:
    """Context fault: leaves the given document's chunks out of the prompt."""

    def build(results, max_chars=None):
        kept = [item for item in results if item.chunk.document.filename != hidden_filename]
        return build_source_context(kept or results[:0], max_chars=max_chars)

    return build


def truncating_context_builder(evidence: str) -> Callable[..., tuple[str, list[dict]]]:
    """Context fault: cuts the evidence sentence out of the chunk text sent to the LLM."""

    def build(results, max_chars=None):
        context, citations = build_source_context(results, max_chars=max_chars)
        pattern = re.compile(r"[^.]*" + re.escape(evidence) + r"[^.]*\.", re.I)
        return pattern.sub("", context), citations

    return build


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------


@dataclass
class Scenario:
    name: str
    expected: str
    question: str
    should_answer: bool = True
    document: str | None = None
    evidence: str | None = None
    reference: str | None = None
    llm_mode: str = "faithful"
    hide_from_retrieval: bool = False
    drop_from_context: bool = False
    truncate_evidence: bool = False
    expected_document_override: str | None = None
    tags: list[str] = field(default_factory=list)


def build_scenarios() -> list[Scenario]:
    scenarios: list[Scenario] = []
    for question, document, evidence, reference in QUESTIONS:
        base = {"question": question, "document": document, "evidence": evidence, "reference": reference}
        scenarios += [
            Scenario(name=f"healthy:{document}", expected="none", **base),
            Scenario(name=f"retrieval_miss:{document}", expected="retrieval_failure", hide_from_retrieval=True, **base),
            Scenario(name=f"context_drop:{document}", expected="context_construction_failure", drop_from_context=True, **base),
            Scenario(name=f"evidence_cut:{document}", expected="context_construction_failure", truncate_evidence=True, **base),
            Scenario(name=f"contradiction:{document}", expected="generation_failure", llm_mode="contradict", **base),
            Scenario(name=f"refusal_with_evidence:{document}", expected="generation_failure", llm_mode="refuse", **base),
            Scenario(name=f"uncited_answer:{document}", expected="generation_failure", llm_mode="uncited", **base),
        ]
    for question, _, _, _ in QUESTIONS[:3]:
        scenarios.append(
            Scenario(
                name=f"not_indexed:{question[:30]}",
                expected="retrieval_failure",
                question=question,
                expected_document_override="sports_policy.txt",
                evidence=None,
            )
        )
    for question in OFF_TOPIC:
        scenarios.append(Scenario(name=f"off_topic_refusal:{question[:30]}", expected="none", question=question, should_answer=False))
    for question in NEAR_DOMAIN_UNANSWERABLE:
        scenarios.append(Scenario(name=f"correct_refusal:{question[:30]}", expected="none", question=question, should_answer=False, llm_mode="refuse"))
        scenarios.append(Scenario(name=f"hallucination:{question[:30]}", expected="generation_failure", question=question, should_answer=False, llm_mode="hallucinate"))
    return scenarios


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------


def _session_factory() -> sessionmaker:
    engine = create_engine(f"sqlite:///{(_TMP / 'scenarios.db').as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _index_corpus(db: Session) -> None:
    ingestion = IngestionService(storage_backend=LocalStorageBackend(_TMP / "corpus"))
    for filename, text in CORPUS.items():
        ingestion.ingest_pdf_with_acl(
            db=db, filename=filename, content_type="text/plain", content=text.encode("utf-8"), owner_id="bench", visibility="public"
        )


def run_benchmark(judge_method: str = "heuristic") -> dict[str, Any]:
    SessionFactory = _session_factory()
    auth = AuthContext(user_id="bench-user", groups=["default"], role="user")
    judge = AnswerJudge(method=judge_method)
    rows: list[dict[str, Any]] = []
    with SessionFactory() as db:
        _index_corpus(db)
        for scenario in build_scenarios():
            retriever = MissingDocumentRetriever(scenario.document) if scenario.hide_from_retrieval else RetrievalService()
            if scenario.drop_from_context:
                builder = dropping_context_builder(scenario.document)
            elif scenario.truncate_evidence:
                builder = truncating_context_builder(scenario.evidence)
            else:
                builder = None
            pipeline = QueryPipeline(retrieval_service=retriever, llm_service=StubLLM(scenario.llm_mode), context_builder=builder)
            outcome = pipeline.run(db=db, question=scenario.question, auth=auth, source="benchmark", evaluate=False)

            expected_documents = [scenario.expected_document_override or scenario.document] if scenario.should_answer else []
            case = EvalCase(
                id=None,
                question=scenario.question,
                should_answer=scenario.should_answer,
                expected_documents=expected_documents,
                expected_pages=[],
                expected_evidence=[scenario.evidence] if scenario.evidence else [],
                reference_answer=scenario.reference,
                tags=[],
            )
            relevant = find_relevant_chunk_ids(db, case, auth)
            evaluate_query_log(db, outcome.query_log, judge, case=case, relevant_ids=relevant)
            db.commit()
            diagnosis = outcome.query_log.diagnosis_json
            # Same trace, diagnosed as live traffic would be: no ground truth available.
            live = diagnose(diagnosis_input_from_log(outcome.query_log))
            rows.append(
                {
                    "scenario": scenario.name,
                    "expected": scenario.expected,
                    "predicted": diagnosis["category"],
                    "subtype": diagnosis["subtype"],
                    "rule": diagnosis["rule"],
                    "correct": diagnosis["category"] == scenario.expected,
                    "live_predicted": live["category"],
                    "live_rule": live["rule"],
                    "live_correct": live["category"] == scenario.expected,
                }
            )
    report = build_report(rows, judge_method)
    live_rows = [{**row, "predicted": row["live_predicted"], "rule": row["live_rule"], "correct": row["live_correct"]} for row in rows]
    live_report = build_report(live_rows, judge_method)
    report["without_ground_truth"] = {key: live_report[key] for key in ("accuracy", "labels", "confusion_matrix", "per_class", "rules_fired", "misclassified")}
    return report


def build_report(rows: list[dict[str, Any]], judge_method: str) -> dict[str, Any]:
    labels = [category for category in CATEGORIES if any(row["expected"] == category or row["predicted"] == category for row in rows)]
    matrix = {expected: {predicted: 0 for predicted in labels} for expected in labels}
    for row in rows:
        matrix[row["expected"]][row["predicted"]] += 1
    per_class = {}
    for label in labels:
        tp = matrix[label][label]
        predicted = sum(matrix[expected][label] for expected in labels)
        actual = sum(matrix[label].values())
        precision = tp / predicted if predicted else None
        recall = tp / actual if actual else None
        f1 = 2 * precision * recall / (precision + recall) if precision and recall else 0.0
        per_class[label] = {
            "support": actual,
            "precision": round(precision, 4) if precision is not None else None,
            "recall": round(recall, 4) if recall is not None else None,
            "f1": round(f1, 4),
        }
    correct = sum(1 for row in rows if row["correct"])
    return {
        "judge": judge_method,
        "scenario_count": len(rows),
        "accuracy": round(correct / len(rows), 4) if rows else None,
        "labels": labels,
        "confusion_matrix": matrix,
        "per_class": per_class,
        "rules_fired": dict(Counter(row["rule"] for row in rows)),
        "misclassified": [row for row in rows if not row["correct"]],
        "scenarios": rows,
    }


def print_report(report: dict[str, Any]) -> None:
    print(f"Diagnosis benchmark ({report['scenario_count']} scenarios, judge={report['judge']})")
    print("\n== With ground truth (evaluation datasets) ==")
    _print_section(report)
    print("\n== Without ground truth (live-traffic rules, same traces) ==")
    _print_section(report["without_ground_truth"])


def _print_section(report: dict[str, Any]) -> None:
    print(f"Accuracy: {report['accuracy']:.2%}\n")
    labels = report["labels"]
    width = max(len(label) for label in labels) + 2
    print("expected \\ predicted".ljust(width) + "".join(label[:12].rjust(14) for label in labels))
    for expected in labels:
        print(expected.ljust(width) + "".join(str(report["confusion_matrix"][expected][predicted]).rjust(14) for predicted in labels))
    print()
    for label, stats in report["per_class"].items():
        print(f"{label:<30} support={stats['support']:<3} precision={stats['precision']} recall={stats['recall']} f1={stats['f1']}")
    by_expected: dict[str, list[str]] = defaultdict(list)
    for row in report["misclassified"]:
        by_expected[row["expected"]].append(f"{row['scenario']} -> {row['predicted']} ({row['rule']})")
    if by_expected:
        print("\nMisclassified:")
        for expected, items in by_expected.items():
            for item in items:
                print(f"  [{expected}] {item}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--output", type=Path, default=REPORT_PATH)
    args = parser.parse_args()
    report = run_benchmark()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print_report(report)
    print(f"\nReport written to {args.output}")


if __name__ == "__main__":
    main()
