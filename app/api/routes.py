import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Request, UploadFile
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, joinedload

from app.core.auth import AuthContext, require_auth
from app.core.config import settings
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.db.session import get_db
from app.models.chunk import Chunk
from app.models.citation import Citation
from app.models.document import Document, DocumentVersion, IngestionJob
from app.models.query_log import QueryLog
from app.schemas.document import DocumentIngestResponse, DocumentSummary, IngestionJobResponse
from app.schemas.health import HealthResponse
from app.schemas.query import QueryRequest, QueryResponse
from app.services.access_control import can_access_document
from app.services.evaluation_service import run_live_evaluation
from app.services.ingestion_job_service import IngestionJobService
from app.services.ingestion_service import IngestionService, TEXT_EXTENSIONS
from app.services.query_pipeline import QueryPipeline
from app.services.readiness import readiness_check

router = APIRouter()
ingestion_service = IngestionService()
_sync_mode = settings.ingestion_mode.lower() in {"sync", "synchronous", "inline"}
ingestion_job_service = IngestionJobService(ingestion_service=ingestion_service, sync_mode=_sync_mode)
query_pipeline = QueryPipeline()
logger = logging.getLogger(__name__)


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", app=settings.app_name)


@router.get("/health/ready")
def health_ready(db: Session = Depends(get_db)) -> dict:
    result = readiness_check(db)
    if not result["ready"]:
        return {"status": "not_ready", **result}
    return {"status": "ready", **result}


@router.post("/documents/ingest", response_model=DocumentIngestResponse)
async def ingest_document(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> DocumentIngestResponse:
    content = await _read_upload_file_limited(file)
    filename = file.filename or "uploaded.pdf"
    default_type = "text/plain" if filename.lower().endswith(TEXT_EXTENSIONS) else "application/pdf"
    # Admin uploads form the shared knowledge base, readable by every
    # authenticated key. Admin keys only carry the "admin" group, so a private
    # admin upload would be invisible to all user keys.
    if auth.is_admin:
        visibility, allowed_user_ids, allowed_group_ids = "public", [], []
    else:
        visibility, allowed_user_ids, allowed_group_ids = "private", [auth.user_id], auth.groups
    job = ingestion_job_service.create_job(
        db=db,
        filename=filename,
        content_type=file.content_type or default_type,
        content=content,
        trace_id=getattr(request.state, "trace_id", None),
        owner_id=auth.user_id,
        visibility=visibility,
        allowed_user_ids=allowed_user_ids,
        allowed_group_ids=allowed_group_ids,
    )
    logger.info(
        "ingestion_job_queued",
        extra={"event": "ingestion_job_queued", "trace_id": getattr(request.state, "trace_id", None)},
    )
    return DocumentIngestResponse(
        job_id=job.id,
        document_id=job.document_id or 0,
        document_version_id=job.document_version_id,
        filename=job.filename,
        chunk_count=job.chunk_count,
        status=job.status,
    )


@router.get("/documents", response_model=list[DocumentSummary])
def list_documents(db: Session = Depends(get_db), auth: AuthContext = Depends(require_auth)) -> list[DocumentSummary]:
    chunk_counts = dict(
        db.execute(
            select(Chunk.document_id, func.count(Chunk.id))
            .join(DocumentVersion, Chunk.document_version_id == DocumentVersion.id)
            .where(DocumentVersion.active.is_(True))
            .group_by(Chunk.document_id)
        ).all()
    )
    documents = db.execute(select(Document).order_by(Document.id.desc())).scalars()
    return [
        DocumentSummary(
            id=document.id,
            filename=document.filename,
            content_type=document.content_type,
            content_hash=document.content_hash,
            created_at=document.created_at,
            visibility=document.visibility,
            owner_id=document.owner_id,
            file_size_bytes=document.file_size_bytes,
            chunk_count=int(chunk_counts.get(document.id, 0)),
        )
        for document in documents
        if can_access_document(document, auth)
    ]


@router.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    document = db.get(Document, document_id, options=[joinedload(Document.versions)])
    if document is None or not can_access_document(document, auth):
        raise NotFoundError("Document not found")
    # Readers of a shared document must not be able to remove it for everyone.
    if not auth.is_admin and document.owner_id != auth.user_id:
        raise ForbiddenError("Only the document owner or an admin can delete this document")

    artifact_uris = {document.raw_file_uri, *(version.parsed_text_uri for version in document.versions)}
    jobs = db.execute(select(IngestionJob).where(IngestionJob.document_id == document_id)).scalars().all()
    for job in jobs:
        artifact_uris.update({job.raw_file_uri, job.parsed_text_uri})

    # SQLite does not enforce ON DELETE actions by default, so detach the
    # rows that outlive the document explicitly. Past answers keep their
    # citation text; only the link to the deleted chunk is cleared.
    chunk_ids = select(Chunk.id).where(Chunk.document_id == document_id)
    db.execute(update(Citation).where(Citation.chunk_id.in_(chunk_ids)).values(chunk_id=None))
    db.execute(
        update(IngestionJob)
        .where(IngestionJob.document_id == document_id)
        .values(document_id=None, document_version_id=None)
    )
    filename = document.filename
    db.delete(document)
    db.commit()

    storage = ingestion_service.storage_backend
    for uri in artifact_uris - {None}:
        try:
            storage.delete(uri)
        except Exception:
            # The index rows are gone, so a leftover file is harmless.
            logger.warning("document_artifact_delete_failed", extra={"event": "document_artifact_delete_failed"})
    logger.info("document_deleted", extra={"event": "document_deleted"})
    return {"deleted": True, "document_id": document_id, "filename": filename}


@router.get("/ingestion-jobs/{job_id}", response_model=IngestionJobResponse)
def get_ingestion_job(
    job_id: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> IngestionJobResponse:
    job = db.get(IngestionJob, job_id)
    if job is None:
        raise NotFoundError("Ingestion job not found")
    if not auth.is_admin and job.owner_id != auth.user_id:
        raise NotFoundError("Ingestion job not found")
    return IngestionJobResponse(
        job_id=job.id,
        status=job.status,
        document_id=job.document_id,
        error_message=job.error_message,
        chunk_count=job.chunk_count,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        failed_at=job.failed_at,
    )


@router.post("/query", response_model=QueryResponse)
def query(
    request: Request,
    payload: QueryRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> QueryResponse:
    outcome = query_pipeline.run(
        db=db,
        question=payload.question,
        auth=auth,
        trace_id=getattr(request.state, "trace_id", None) or uuid.uuid4().hex,
        top_k=payload.top_k,
    )
    # Evaluation runs after the response is sent so users never wait for it.
    if outcome.query_log.evaluation_status == "pending":
        background_tasks.add_task(run_live_evaluation, outcome.query_log.id)
    return outcome.response


@router.get("/query/{query_log_id}/trace")
def get_query_trace(
    query_log_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_auth),
) -> dict:
    query_log = load_query_log(db, query_log_id, auth)
    return trace_payload(query_log)


def load_query_log(db: Session, query_log_id: int, auth: AuthContext) -> QueryLog:
    query_log = db.get(QueryLog, query_log_id, options=[joinedload(QueryLog.citations)])
    if query_log is None or (not auth.is_admin and query_log.user_id != auth.user_id):
        raise NotFoundError("Query log not found")
    return query_log


def trace_payload(query_log: QueryLog) -> dict:
    trace = query_log.trace_json or {}
    metrics = query_log.metrics_json or {}
    return {
        "query_log_id": query_log.id,
        "trace_id": query_log.trace_id,
        "created_at": query_log.created_at.isoformat() if query_log.created_at else None,
        "source": query_log.source,
        "original_query": query_log.query,
        "rewritten_query": trace.get("rewritten_query"),
        "retrieval_mode": trace.get("retrieval_mode"),
        "top_k": trace.get("top_k"),
        "retrieved_chunks": trace.get("retrieved_chunks", []),
        "reranked_chunks": trace.get("reranked_chunks", []),
        "vector_chunks": trace.get("vector_chunks", []),
        "keyword_chunks": trace.get("keyword_chunks", []),
        "context": trace.get("context"),
        "raw_answer": trace.get("raw_answer"),
        "final_citations": [_citation_to_dict(citation) for citation in query_log.citations],
        "validation_result": query_log.validation_json or {},
        "model_usage": {
            "model": query_log.model,
            "prompt_tokens": query_log.prompt_tokens,
            "completion_tokens": query_log.completion_tokens,
            "total_tokens": query_log.total_tokens,
            "estimated_cost": metrics.get("estimated_cost"),
        },
        "metrics": metrics,
        "stages": metrics.get("stages", []),
        "latency_ms": query_log.latency_ms,
        "answer": query_log.answer,
        "status": query_log.status,
        "error_message": query_log.error_message,
        "evaluation_status": query_log.evaluation_status,
        "evaluation": query_log.evaluation_json or {},
        "diagnosis": query_log.diagnosis_json or {},
        "auth": {"user_id": query_log.user_id, "groups": query_log.groups, "role": query_log.auth_role},
        "denied_retrieval_count": query_log.denied_retrieval_count,
    }


async def _read_upload_file_limited(file: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(settings.upload_read_chunk_bytes)
        if not chunk:
            break
        total += len(chunk)
        if total > settings.max_upload_bytes:
            raise ValidationAppError(f"File exceeds max upload size of {settings.max_upload_mb} MB")
        chunks.append(chunk)
    return b"".join(chunks)


def _citation_to_dict(citation: Citation) -> dict:
    return {
        "label": citation.citation_label,
        "chunk_id": citation.chunk_id,
        "filename": citation.source_filename,
        "page_start": citation.page_start,
        "page_end": citation.page_end,
        "score": citation.score,
        "snippet": citation.snippet,
    }
