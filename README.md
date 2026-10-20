# RAGWatch 

An observability, evaluation and failure-diagnosis platform for retrieval-augmented generation (RAG), built around a working citation-gated RAG application. Upload documents, ask grounded questions, and see for every request how long each stage took, what was retrieved, what the LLM was given, how good the answer was, and — when something went wrong — which stage failed and why.

---

## Modules

| # | Module | What it does |
|---|--------|--------------|
| 1 | **Document processing and RAG pipeline** | Upload PDF, plain-text and Markdown documents; extract text; chunk; embed; store vectors (SQLite or Postgres + pgvector); hybrid retrieval; LLM answers with inline `[S1]` citations; sources shown next to answers. |
| 2 | **Observability and request tracing** | Every request gets a trace ID and a stored trace with stage-level timings (query embedding, document retrieval, reranking, access control, context construction, LLM generation, citation validation), retrieval candidates, the exact LLM context, errors, model, token usage and total latency. Searchable trace history. Evaluation runs asynchronously after the response is sent. |
| 3 | **RAG performance evaluation** | Retrieval quality (Recall@K, Precision@K, MRR, Hit@K), answer quality (faithfulness, answer relevance, reference overlap) and system performance (latency, p95, error rate, tokens). Ground-truth datasets, configurable evaluation runs and run comparison. |
| 4 | **Failure detection and diagnosis** | Explicit, ordered rules classify each trace as a retrieval failure, context construction problem, generation failure, system error, or no failure — *confirmed* with ground truth, *suspected* without. Optional LLM explanation. A fault-injection benchmark measures how accurately the rules classify known failure scenarios. |
| 5 | **Dashboard and analytics** | Next.js + Recharts console: KPIs, volume/latency and quality trends, failure categories, per-stage latency, retrieval quality per evaluation run, request history, trace inspector, evaluation comparisons. Every metric has a plain-language explanation. |

## Architecture

```mermaid
flowchart LR
    U[Console / API client] --> AUTH[API key auth + ACL]
    AUTH --> INGEST[Parse PDF/TXT/MD → chunk → embed → store]
    AUTH --> PIPE[Query pipeline]
    subgraph PIPE[Query pipeline — every stage timed]
      E[Query embedding] --> R[Hybrid retrieval + relevance gate] --> RR[Rerank] --> ACL[ACL filter] --> CTX[Context construction] --> LLM[LLM generation] --> CV[Citation validation]
    end
    PIPE --> TRACE[(Trace: query_logs)]
    TRACE -. background .-> EVAL[Evaluation: answer quality, system metrics]
    EVAL --> DIAG[Rule-based diagnosis]
    DS[(Eval datasets: ground truth)] --> RUN[Evaluation runs] --> PIPE
    RUN --> RQ[Recall@K / Precision@K / MRR] --> DIAG
    DIAG --> DASH[Dashboard, history, trace inspector]
```

Live queries and evaluation runs share one code path (`app/services/query_pipeline.py`), so evaluation measures exactly what users experience.

### Example trace

```
Trace 6 · What is DDL, and which statements belong to it?
Query embedding         1.67 s
Document retrieval        29 ms
Reranking                  1 ms
Access control             0 ms
Context construction       0 ms
LLM generation          5.14 s
Citation validation        0 ms
Total response time     6.84 s
Evaluation (async)     12.60 s   faithfulness 100% · relevance 100% · diagnosis: no failure (rule L7)
```

## What each metric needs

| Category | Metrics | Required inputs | Available for |
|---|---|---|---|
| Retrieval quality | Recall@K, Precision@K, MRR, Hit@K | Ground truth: expected documents, optionally pages and evidence phrases, that identify the relevant chunks | Evaluation runs only — live traces record *"requires ground truth"* instead of a number |
| Answer quality | Faithfulness, answer relevance | The answer and the exact context it was generated from (stored in the trace) | Every answered request (LLM judge, or deterministic heuristic offline) |
| Answer correctness | Reference overlap, answer/decline accuracy | A reference answer / `should_answer` label | Evaluation runs |
| System performance | Latency (avg, p50, p95), error rate, token usage | The trace itself | Every request |

A chunk counts as **relevant** when it comes from one of the case's `expected_documents` and, when given, overlaps `expected_pages` and contains one of `expected_evidence`. Precision@K divides by K.

**Faithfulness** = supported claims / all claims. The LLM judge labels each claim *supported*, *unsupported* or *contradicted* against the context; the heuristic judge uses lexical support per cited source and treats numbers missing from the evidence as contradictions. **Answer relevance** is LLM-rated (or, heuristically, the share of the question's key terms the answer addresses).

## Failure diagnosis

Rules are evaluated in order; the first match wins. Each has a stable ID that is stored with the diagnosis.

| Rule | Needs ground truth | Condition | Diagnosis |
|---|---|---|---|
| S1 | – | Pipeline/LLM error | System error |
| G1 / G2 | yes | Unanswerable question answered / declined | Generation failure (hallucinated answer) / none |
| G3 | yes | Expected document not indexed | Retrieval failure |
| G4 | yes | Expected supporting chunks absent from the top-K results | Retrieval failure |
| G5 | yes | Relevant chunk retrieved but left out of the LLM context | Context construction problem |
| G6 | yes | Relevant document in context but the evidence text is missing | Context construction problem |
| G7–G11 | yes | Evidence in context, but the answer was uncited, declined, contradicting, unfaithful, or misses the reference facts | Generation failure |
| L1–L7 | no | Same scenarios inferred from trace signals (empty retrieval, dropped context, citation-gate rejection, judge verdicts, low relevance of a faithful answer) | *Suspected* category |

`POST /api/v1/query/{id}/explain` adds a natural-language explanation (LLM, or a template offline). The explanation never changes the rule-based category.

### Diagnosis benchmark

`python -m evals.diagnosis_benchmark` builds an isolated corpus and runs 47 labelled scenarios through the real pipeline, each injecting one known fault: expected document not indexed, retriever that misses the document, relevant chunk dropped from the context, evidence sentence cut from the context, LLM that contradicts / refuses / omits citations / hallucinates, plus healthy controls and correct refusals. It reports accuracy, per-class precision/recall/F1 and a confusion matrix, both **with** ground truth and **without** (live rules on the same traces).

Latest local result (deterministic local embeddings, heuristic judge):

| Setting | Accuracy |
|---|---|
| With ground truth (evaluation runs) | 100% (47/47) |
| Without ground truth (live-traffic rules) | 61.7% (29/47) |

The first number shows that each rule fires for the fault it targets; it is high by construction, because every scenario injects exactly one such fault. The second number shows how much ground truth matters: without it, a refusal despite available evidence looks the same as a legitimate refusal, and a context fault that leaves no trace looks like a retrieval miss. The report is written to `evals/reports/diagnosis_benchmark.json` and shown on the Evaluations page.

## Supported Input Sources

PDF (text-extractable, via `pypdf`), plain text (`.txt`) and Markdown (`.md`). The parser reports `No extractable text found in PDF` when a scanned PDF requires OCR. PDF chunks carry `page_start` / `page_end`; text files have no pages unless they contain form-feed page breaks.

## Tech Stack

| Layer | Tools |
| --- | --- |
| Backend API | FastAPI, Pydantic v2, SQLAlchemy, uvicorn |
| Database | SQLite (local/demo) or Postgres + pgvector (production); Alembic migrations; SQLite schema auto-upgrades on startup |
| Retrieval | Paragraph-aware token-window chunker, keyword search (stopword-aware) + vector search fused with weighted RRF, relevance thresholds on raw scores, local reranker |
| LLM / embeddings | Gemini (`GEMINI_API_KEY`) or OpenAI (`OPENAI_API_KEY`); deterministic local mode for offline tests |
| Evaluation | LLM-as-judge or heuristic judge, ground-truth datasets, background evaluation via FastAPI background tasks |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS, Recharts |
| CI | GitHub Actions (pytest suite + Postgres migrations + frontend build) |

## Project Structure

```text
app/
├── api/            routes.py               # health, documents, ingestion jobs, query, trace
│                   observability_routes.py # history, analytics, explain, re-evaluate
│                   evaluation_routes.py    # datasets, runs, comparison, benchmark report
├── core/           auth, config, errors, logging, rate_limit
├── models/         document, chunk, citation, query_log, evaluation (datasets/cases/runs/results)
├── services/       query_pipeline   # traced end-to-end pipeline (Module 2)
│                   evaluation_service, analytics (Modules 3 and 5)
│                   diagnostics, diagnosis_explainer (Module 4)
│                   ingestion, retrieval, reranker, llm, embedding, pdf_parser, chunker, ...
└── workers/        ingestion_worker.py
alembic/            Postgres migrations (0008 adds evaluation + diagnosis schema)
evals/              diagnosis_benchmark.py, run_eval.py, golden_qa.example.jsonl
frontend/app/       dashboard, upload (documents), chat, history, trace, evaluations, settings
tests/              API flow, diagnosis rules, metrics, retrieval scoring, citations, benchmark, schema upgrade
```

## Quickstart

### 1. Install

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

### 2. Configure

Create `.env` (see [Environment Variables](#environment-variables)). Minimal local setup:

```bash
APP_ENV=local
DATABASE_URL=sqlite:///./trace.db
ADMIN_API_KEYS=dev-admin-key
USER_API_KEYS=dev-user-key:user-1:default
CORS_ALLOWED_ORIGINS=http://localhost:3000
INGESTION_MODE=sync
AI_PROVIDER=gemini                 # or openai, or local (offline, deterministic)
GEMINI_API_KEY=...
GEMINI_CHAT_MODEL=gemini-3-flash-preview
```

```bash
python scripts/init_local_db.py
```

### 3. Run

```bash
uvicorn app.main:app --reload
```

```bash
cd frontend && npm install && npm run dev
```

Open `http://localhost:3000`, set the API URL and key on the Settings page (or in `frontend/.env.local`), upload a document, and ask a question in RAG Chat. API docs are at `http://localhost:8000/docs`.

### Postgres + pgvector

```bash
docker compose up -d postgres redis
export DATABASE_URL=postgresql+psycopg://rag_user:rag_password@localhost:5432/rag_db
alembic upgrade head
uvicorn app.main:app --reload
python -m app.workers.ingestion_worker   # only when INGESTION_MODE is not "sync"
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `local`, `demo`, `test`, or `production` |
| `DATABASE_URL` | `sqlite:///...` or `postgresql+psycopg://...` |
| `ADMIN_API_KEYS` / `USER_API_KEYS` | Auth keys; user keys use `key:user_id:group1,group2`. Admin uploads are public to all keys; user uploads are private to the uploader and their groups. |
| `AI_PROVIDER` | `gemini`, `openai`, or `local` |
| `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL` | Gemini settings |
| `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL` | OpenAI settings |
| `INGESTION_MODE` | `sync` (inline) or unset (background worker) |
| `RETRIEVAL_MODE` / `RERANKING_ENABLED` | `hybrid` (default) or `vector`; reranker toggle |
| `MIN_VECTOR_SIMILARITY` | Cosine threshold for a vector hit to count as relevant (default 0.55 for Gemini, `MIN_RETRIEVAL_SCORE` otherwise) |
| `MIN_KEYWORD_SCORE` | Share of non-stopword query terms a keyword hit must contain (default 0.5) |
| `MIN_CITATION_SCORE`, `MAX_CONTEXT_CHARS` | Citation gate threshold; LLM context size limit |
| `EVALUATION_ENABLED` | Evaluate live queries in the background (default `true`) |
| `EVALUATION_JUDGE` | `auto` (LLM judge when a provider is configured), `llm`, or `heuristic` |
| `FAITHFULNESS_THRESHOLD`, `ANSWER_RELEVANCE_THRESHOLD`, `REFERENCE_OVERLAP_THRESHOLD` | Diagnosis thresholds (defaults 0.7 / 0.5 / 0.5) |
| `STORAGE_BACKEND`, `RATE_LIMIT_*`, `REDIS_URL` | Storage and rate limiting |
| `NEXT_PUBLIC_RAG_API_BASE_URL`, `NEXT_PUBLIC_RAG_API_KEY` | Frontend defaults (overridable in Settings) |

## API

All endpoints are under `/api/v1` and require `X-API-Key` except health checks. Non-admin keys only see their own traces.

| Method & path | Purpose |
|---|---|
| `POST /documents/ingest` · `GET /documents` · `GET /ingestion-jobs/{id}` | Upload and list documents, job status |
| `POST /query` | Ask a question; returns answer, citations, `query_log_id`; evaluation runs afterwards |
| `GET /query/{id}/trace` | Full trace: stages, retrieval candidates, context, evaluation, diagnosis |
| `POST /query/{id}/evaluate` · `POST /query/{id}/explain` | Re-run evaluation; add an explanation to the diagnosis |
| `GET /queries` | Trace history (`source`, `status`, `category`, `search`, `limit`, `offset`) |
| `GET /analytics/summary` · `GET /analytics/timeseries` | Dashboard aggregates |
| `POST /evaluation/datasets` · `GET /evaluation/datasets[/{id}]` | Ground-truth datasets |
| `POST /evaluation/runs` · `GET /evaluation/runs[/{id}]` | Start a run (top-K, retrieval mode, reranking, judge) and read results |
| `GET /evaluation/compare?run_ids=1,2` | Side-by-side run comparison |
| `GET /evaluation/diagnosis-benchmark` | Latest diagnosis benchmark report |

Dataset case format (JSON; legacy `golden_qa` fields `expected_source_filename`, `expected_page`, `expected_answer` are also accepted):

```json
{"id": "q1", "question": "What minimum attendance must students maintain?",
 "expected_documents": ["attendance_policy.pdf"], "expected_pages": [2],
 "expected_evidence": ["minimum attendance of 75"], "reference_answer": "75 percent"}
{"id": "q2", "question": "Who won the 2018 football world cup?", "should_answer": false}
```

## Testing

```bash
python -m pytest                          # 47 tests, isolated SQLite + local AI, no API key needed
python -m evals.diagnosis_benchmark       # diagnosis accuracy report
cd frontend && npm run lint && npm run typecheck && npm run build
```

## Deployment

**Vercel (frontend + backend).** `vercel.json` builds `frontend/` and routes `/api/v1/*` to `serverless.py`. Set `APP_ENV=demo`, `DATABASE_URL=sqlite:////tmp/trace-storage/trace.db`, `STORAGE_BACKEND=local`, `INGESTION_MODE=sync`, `CORS_ALLOWED_ORIGINS`, and API keys. Serverless storage is ephemeral, and evaluation runs execute as background tasks inside the request's function, so long runs may be cut off there.

**Own infrastructure.** `Dockerfile` + `docker-compose.prod.yml` with Postgres + pgvector and Redis; run `alembic upgrade head`. See `DEPLOYMENT.md` and `RUNBOOK.md`.

## Known Limitations

- Live-traffic diagnoses are *suspected*: without ground truth the rules reach 61.7% on the benchmark scenarios.
- The benchmark uses synthetic, single-fault scenarios; real failures can combine several causes.
- LLM-judge scores depend on the judge model and add token cost; the heuristic judge is cheaper but cannot detect paraphrased contradictions.
- Evaluation runs and live evaluation run in-process (FastAPI background tasks); a server restart interrupts them.
- Scanned PDFs need OCR (not implemented).
- No user login system; access control is key-and-group-based.

## License

MIT License. See [LICENSE](LICENSE) for details.
