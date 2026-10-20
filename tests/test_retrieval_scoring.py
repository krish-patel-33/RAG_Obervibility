from types import SimpleNamespace

from app.core.config import settings
from app.services.citation_formatter import RetrievedChunk
from app.services.retrieval_service import RetrievalService
from app.utils.text import content_tokens


def _result(chunk_id: int, score: float, source: str) -> RetrievedChunk:
    return RetrievedChunk(chunk=SimpleNamespace(id=chunk_id, text=""), score=score, source=source)


def _service() -> RetrievalService:
    return RetrievalService(embedding_service=object(), reranker=object())


def test_rank_fusion_does_not_turn_weak_hits_into_strong_scores():
    weak_vector = [_result(1, 0.05, "vector"), _result(2, 0.04, "vector")]
    weak_keyword = [_result(1, 0.2, "keyword")]
    assert _service()._weighted_rrf(weak_vector, weak_keyword) == []


def test_relevant_hits_pass_and_score_reflects_raw_similarity():
    threshold = settings.vector_similarity_threshold
    fused = _service()._weighted_rrf([_result(1, threshold + 0.3, "vector"), _result(2, 0.01, "vector")], [_result(3, 1.0, "keyword")])
    assert [item.chunk.id for item in fused] == [1, 3]
    assert abs(fused[0].score - settings.vector_search_weight * (threshold + 0.3)) < 1e-9


def test_stopwords_do_not_count_as_keyword_matches():
    assert content_tokens("What is the capital of France and who won?") == {"capital", "france", "won"}
