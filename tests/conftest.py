"""Test configuration: isolated SQLite database and deterministic local AI.

Environment variables are set before the app is imported so they override the
developer's ``.env`` (and CI's Postgres URL).
"""

import os
import shutil
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="trace-rag-tests-"))
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": f"sqlite:///{(_TMP / 'test.db').as_posix()}",
        "LOCAL_STORAGE_PATH": str(_TMP / "storage"),
        "AI_PROVIDER": "local",
        "ADMIN_API_KEYS": "test-admin-key",
        "USER_API_KEYS": "test-user-key:user-1:default;other-user-key:user-2:other",
        "RATE_LIMIT_ENABLED": "false",
        "INGESTION_MODE": "sync",
        "EVALUATION_ENABLED": "true",
        "EVALUATION_JUDGE": "heuristic",
        "CORS_ALLOWED_ORIGINS": "http://localhost:3000",
        "LANGFUSE_ENABLED": "false",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

ADMIN = {"X-API-Key": "test-admin-key"}
USER = {"X-API-Key": "test-user-key"}
OTHER_USER = {"X-API-Key": "other-user-key"}

POLICY_TEXT = (
    "Students must maintain a minimum attendance of 75 percent in every course. "
    "Medical leave can condone up to 10 percent of the shortfall.\n\n"
    "The library lends at most 4 books for 14 days."
)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(scope="session")
def policy_document(client):
    """A public (admin-uploaded) text document shared by the API tests."""
    response = client.post(
        "/api/v1/documents/ingest",
        files={"file": ("attendance_policy.txt", POLICY_TEXT.encode(), "text/plain")},
        headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "completed"
    return body
