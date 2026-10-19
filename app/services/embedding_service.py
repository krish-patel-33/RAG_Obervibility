import hashlib
import logging
import math
import re
from typing import Any

logger = logging.getLogger(__name__)

from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.core.errors import ExternalServiceError


class EmbeddingService:
    def __init__(self, client: Any | None = None):
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            if settings.ai_provider == "gemini":
                from google import genai

                self._client = genai.Client(
                    api_key=settings.gemini_api_key_str,
                    http_options={"timeout": settings.request_timeout_seconds * 1000},
                )
            else:
                self._client = OpenAI(api_key=settings.openai_api_key_str, timeout=settings.request_timeout_seconds)
        return self._client

    @retry(wait=wait_exponential(multiplier=1, min=1, max=8), stop=stop_after_attempt(settings.openai_max_retries), reraise=True)
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        if self._client is None and _use_local_ai():
            return [_local_embedding(text) for text in texts]
        try:
            if self._uses_gemini_client():
                response = self.client.models.embed_content(
                    model=settings.gemini_embedding_model,
                    contents=texts,
                    config={
                        "task_type": "RETRIEVAL_DOCUMENT",
                        "output_dimensionality": settings.embedding_dimension,
                    },
                )
                vectors = [
                    embedding.values
                    for embedding in (getattr(response, "embeddings", None) or [])
                ]
            else:
                response = self.client.embeddings.create(
                    model=settings.openai_embedding_model,
                    input=texts,
                    dimensions=settings.embedding_dimension,
                )
                vectors = [item.embedding for item in response.data]
        except Exception as exc:
            # Graceful degradation: when the embedding provider is unavailable
            # (e.g. network errors, unsupported endpoints, rate limits), fall
            # back to deterministic local embeddings so ingestion and search
            # keep working. The fallback is also used automatically in local
            # and demo modes when no API key is configured.
            logger.warning(
                "embedding_provider_failed",
                extra={
                    "event": "embedding_provider_failed",
                    "reason": str(exc)[:200],
                    "fallback": "local",
                },
            )
            return [_local_embedding(text) for text in texts]

        if len(vectors) != len(texts):
            raise ExternalServiceError("Embedding provider returned an unexpected number of vectors")
        if any(len(vector) != settings.embedding_dimension for vector in vectors):
            raise ExternalServiceError("Embedding provider returned vectors with an unexpected dimension")
        return vectors

    def _uses_gemini_client(self) -> bool:
        return (
            self._client is None and settings.ai_provider == "gemini"
        ) or (
            self._client is not None and hasattr(self._client, "models")
        )

    def embed_query(self, query: str) -> list[float]:
        return self.embed_texts([query])[0]


TOKEN_RE = re.compile(r"[A-Za-z0-9_]+")


def _use_local_ai() -> bool:
    return settings.ai_provider == "local"


def _local_embedding(text: str) -> list[float]:
    vector = [0.0] * settings.embedding_dimension
    for token in TOKEN_RE.findall(text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % settings.embedding_dimension
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]
