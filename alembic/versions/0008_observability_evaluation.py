"""observability, evaluation and diagnosis schema

Revision ID: 0008_observability_evaluation
Revises: 0007_production_readiness_schema
Create Date: 2026-10-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_observability_evaluation"
down_revision: Union[str, None] = "0007_production_readiness_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("query_logs", sa.Column("source", sa.String(length=32), nullable=False, server_default="api"))
    op.add_column("query_logs", sa.Column("evaluation_status", sa.String(length=32), nullable=False, server_default="skipped"))
    op.add_column("query_logs", sa.Column("evaluation_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))
    op.add_column("query_logs", sa.Column("diagnosis_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))
    op.add_column("query_logs", sa.Column("failure_category", sa.String(length=64), nullable=True))
    op.create_index("ix_query_logs_failure_category", "query_logs", ["failure_category"])
    op.create_index("ix_query_logs_created_at", "query_logs", ["created_at"])

    op.create_table(
        "eval_datasets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "eval_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("eval_datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("should_answer", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("expected_documents", sa.JSON(), nullable=False),
        sa.Column("expected_pages", sa.JSON(), nullable=False),
        sa.Column("expected_evidence", sa.JSON(), nullable=False),
        sa.Column("reference_answer", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False),
    )
    op.create_index("ix_eval_cases_dataset_id", "eval_cases", ["dataset_id"])
    op.create_table(
        "eval_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dataset_id", sa.Integer(), sa.ForeignKey("eval_datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("summary_json", sa.JSON(), nullable=False),
        sa.Column("case_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_eval_runs_dataset_id", "eval_runs", ["dataset_id"])
    op.create_table(
        "eval_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("eval_cases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("query_log_id", sa.Integer(), sa.ForeignKey("query_logs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metrics_json", sa.JSON(), nullable=False),
        sa.Column("diagnosis_json", sa.JSON(), nullable=False),
        sa.Column("failure_category", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_eval_results_run_id", "eval_results", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_eval_results_run_id", table_name="eval_results")
    op.drop_table("eval_results")
    op.drop_index("ix_eval_runs_dataset_id", table_name="eval_runs")
    op.drop_table("eval_runs")
    op.drop_index("ix_eval_cases_dataset_id", table_name="eval_cases")
    op.drop_table("eval_cases")
    op.drop_table("eval_datasets")
    op.drop_index("ix_query_logs_created_at", table_name="query_logs")
    op.drop_index("ix_query_logs_failure_category", table_name="query_logs")
    op.drop_column("query_logs", "failure_category")
    op.drop_column("query_logs", "diagnosis_json")
    op.drop_column("query_logs", "evaluation_json")
    op.drop_column("query_logs", "evaluation_status")
    op.drop_column("query_logs", "source")
