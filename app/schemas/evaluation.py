from typing import Literal

from pydantic import BaseModel, Field, model_validator


class EvalCaseIn(BaseModel):
    """One ground-truth case.

    Also accepts the legacy ``evals/golden_qa`` field names
    (``id``, ``expected_source_filename``, ``expected_page``, ``expected_answer``).
    """

    id: str | None = None
    question: str = Field(min_length=3, max_length=4000)
    should_answer: bool = True
    expected_documents: list[str] = Field(default_factory=list)
    expected_pages: list[int] = Field(default_factory=list)
    expected_evidence: list[str] = Field(default_factory=list)
    reference_answer: str | None = None
    tags: list[str] = Field(default_factory=list)
    expected_source_filename: str | None = None
    expected_page: int | None = None
    expected_answer: str | None = None

    @model_validator(mode="after")
    def merge_legacy_fields(self) -> "EvalCaseIn":
        if self.expected_source_filename and self.expected_source_filename not in self.expected_documents:
            self.expected_documents.append(self.expected_source_filename)
        if self.expected_page is not None and self.expected_page not in self.expected_pages:
            self.expected_pages.append(self.expected_page)
        if self.reference_answer is None and self.expected_answer and self.should_answer:
            self.reference_answer = self.expected_answer
        if self.should_answer and not self.expected_documents:
            raise ValueError(f"case {self.id or self.question[:40]!r}: answerable cases need expected_documents")
        return self


class EvalDatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256)
    description: str | None = None
    cases: list[EvalCaseIn] = Field(min_length=1, max_length=1000)


class EvalRunCreate(BaseModel):
    dataset_id: int
    label: str | None = Field(default=None, max_length=256)
    top_k: int | None = Field(default=None, ge=1, le=20)
    retrieval_mode: Literal["hybrid", "vector"] | None = None
    reranking_enabled: bool | None = None
    judge: Literal["auto", "llm", "heuristic"] | None = None
