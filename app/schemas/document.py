from datetime import datetime

from pydantic import BaseModel


class DocumentIngestResponse(BaseModel):
    job_id: str | None = None
    document_id: int
    document_version_id: int | None = None
    filename: str
    chunk_count: int
    status: str


class IngestionJobResponse(BaseModel):
    job_id: str
    status: str
    document_id: int | None
    error_message: str | None
    chunk_count: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    failed_at: datetime | None


class DocumentSummary(BaseModel):
    id: int
    filename: str
    content_type: str
    content_hash: str
    created_at: datetime
    visibility: str = "private"
    owner_id: str | None = None
    file_size_bytes: int | None = None
    chunk_count: int = 0

    model_config = {"from_attributes": True}
