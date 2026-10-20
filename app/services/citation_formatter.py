from dataclasses import dataclass
import re

from app.models.chunk import Chunk
from app.utils.text import compact_snippet

# Matches "[S1]" as well as grouped citations such as "[S1, S3]" or "[S1; S2]".
CITATION_RE = re.compile(r"\[(S\d+(?:\s*[,;]\s*S\d+)*)\]")
LABEL_RE = re.compile(r"S\d+")
BULLET_PREFIX_RE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+")
MIN_CLAIM_WORDS = 4


@dataclass(frozen=True)
class RetrievedChunk:
    chunk: Chunk
    score: float
    source: str = "vector"


def citation_label(index: int) -> str:
    return f"S{index + 1}"


def build_source_context(results: list[RetrievedChunk], max_chars: int | None = None) -> tuple[str, list[dict]]:
    blocks: list[str] = []
    citations: list[dict] = []
    used_chars = 0

    for idx, result in enumerate(results):
        chunk = result.chunk
        label = citation_label(idx)
        filename = chunk.document.filename if chunk.document else "unknown"
        page = _format_page_range(chunk.page_start, chunk.page_end)
        block = f"[{label}] {filename}{page}\n{chunk.text}"
        if max_chars is not None and blocks and used_chars + len(block) > max_chars:
            break
        used_chars += len(block)
        blocks.append(block)
        citations.append(
            {
                "label": label,
                "chunk_id": chunk.id,
                "document_id": chunk.document_id,
                "filename": filename,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "score": round(result.score, 4),
                "snippet": compact_snippet(chunk.text),
            }
        )

    return "\n\n---\n\n".join(blocks), citations


def select_citations_for_answer(answer: str, citations: list[dict]) -> tuple[str, list[dict]]:
    valid_by_label = {citation["label"]: citation for citation in citations}
    labels_in_answer = [label for label in citation_labels(answer) if label in valid_by_label]

    if labels_in_answer:
        unique_labels = list(dict.fromkeys(labels_in_answer))
        return answer, [valid_by_label[label] for label in unique_labels]

    if is_no_answer(answer) or not citations:
        return answer, []

    return answer, []


def answer_has_strong_citation_support(answer: str, citations: list[dict], min_score: float) -> bool:
    if is_no_answer(answer):
        return True
    valid_by_label = {citation["label"]: citation for citation in citations if float(citation.get("score", 0.0)) >= min_score}
    if not valid_by_label:
        return False

    for claim in extract_claims(answer):
        labels = citation_labels(claim)
        if not labels:
            return False
        if any(label not in valid_by_label for label in labels):
            return False
    return True


def citation_labels(text: str) -> list[str]:
    return [label for group in CITATION_RE.findall(text) for label in LABEL_RE.findall(group)]


def is_no_answer(answer: str) -> bool:
    normalized = answer.lower()
    return "could not find" in normalized or "not found" in normalized or "not in the uploaded documents" in normalized


def extract_claims(answer: str) -> list[str]:
    """Split an answer into claim blocks (paragraphs and list items) that must carry a citation.

    LLMs usually cite once at the end of a paragraph or list item, so each
    line-level block is checked rather than each sentence. Headings, list
    lead-ins ending in ":" and very short fragments are not factual claims.
    """
    claims: list[str] = []
    for line in answer.strip().splitlines():
        block = BULLET_PREFIX_RE.sub("", line).strip()
        if not block or block.startswith("#") or block.endswith(":"):
            continue
        if not CITATION_RE.search(block) and len(block.split()) < MIN_CLAIM_WORDS:
            continue
        claims.append(block)
    return claims


def _format_page_range(page_start: int | None, page_end: int | None) -> str:
    if page_start is None:
        return ""
    if page_end is None or page_end == page_start:
        return f", page {page_start}"
    return f", pages {page_start}-{page_end}"
