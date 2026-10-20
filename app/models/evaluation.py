from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EvalDataset(Base):
    """A named set of questions with ground truth used to measure RAG quality."""

    __tablename__ = "eval_datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    cases: Mapped[list["EvalCase"]] = relationship(back_populates="dataset", cascade="all, delete-orphan", order_by="EvalCase.id")


class EvalCase(Base):
    """One question plus the ground truth needed by the ground-truth metrics.

    Recall@K / Precision@K / MRR need to know which chunks are relevant. A chunk
    counts as relevant when it belongs to one of ``expected_documents`` and,
    when given, overlaps ``expected_pages`` and contains one of
    ``expected_evidence``. ``reference_answer`` enables answer-correctness checks.
    """

    __tablename__ = "eval_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("eval_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    should_answer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expected_documents: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    expected_pages: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    expected_evidence: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    reference_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    dataset: Mapped[EvalDataset] = relationship(back_populates="cases")


class EvalRun(Base):
    """One execution of a dataset against the pipeline with a recorded configuration."""

    __tablename__ = "eval_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("eval_datasets.id", ondelete="CASCADE"), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    case_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    results: Mapped[list["EvalResult"]] = relationship(back_populates="run", cascade="all, delete-orphan", order_by="EvalResult.id")


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("eval_cases.id", ondelete="SET NULL"), nullable=True)
    query_log_id: Mapped[int | None] = mapped_column(ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True)
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    diagnosis_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    failure_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run: Mapped[EvalRun] = relationship(back_populates="results")
