export type HealthResponse = {
  status: string;
  app: string;
};

export type ReadinessResponse = {
  status: "ready" | "not_ready";
  ready: boolean;
  checks: Record<string, { ok: boolean; error?: string; backend?: string; environment?: string; skipped?: boolean; reason?: string }>;
};

export type IngestResponse = {
  job_id: string;
  document_id: number;
  document_version_id: number | null;
  filename: string;
  chunk_count: number;
  status: IngestionStatus;
};

export type IngestionStatus = "queued" | "processing" | "completed" | "failed";

export type IngestionJob = {
  job_id: string;
  status: IngestionStatus;
  document_id: number | null;
  error_message: string | null;
  chunk_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
};

export type DocumentSummary = {
  id: number;
  filename: string;
  content_type: string;
  content_hash: string;
  created_at: string;
  visibility: string;
  owner_id: string | null;
  file_size_bytes: number | null;
  chunk_count: number;
};

export type QueryRequest = {
  question: string;
  top_k?: number;
};

export type Citation = {
  label: string;
  chunk_id: number;
  document_id?: number;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  score: number;
  snippet: string;
};

export type QueryResponse = {
  trace_id: string;
  query_log_id: number | null;
  answer: string;
  citations: Citation[];
  no_answer: boolean;
};

export type RetrievedChunk = {
  chunk_id: number;
  document_id: number;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  score: number;
  source: string;
  snippet: string;
};

export type StageTiming = {
  name: string;
  label: string;
  ms: number;
  status: string;
  async?: boolean;
};

export type ClaimVerdict = {
  claim: string;
  verdict: "supported" | "contradicted" | "unsupported";
  source: string | null;
  reason: string;
};

export type AnswerQuality = {
  method: string;
  faithfulness: number | null;
  answer_relevance: number | null;
  relevance_reason?: string;
  contradiction: boolean;
  claims?: ClaimVerdict[];
  skipped_reason?: string;
  judge_error?: string;
  usage?: { total_tokens: number | null };
};

export type RetrievalQuality = {
  available: boolean;
  requires?: string;
  k?: number;
  relevant_total?: number;
  relevant_retrieved?: number;
  recall_at_k?: number | null;
  precision_at_k?: number | null;
  mrr?: number | null;
  hit_at_k?: number | null;
};

export type GroundTruthInfo = {
  case_id: number;
  should_answer: boolean;
  expected_documents: string[];
  relevant_chunk_ids: number[];
  relevant_in_context: number;
  evidence_in_context: boolean | null;
  reference_overlap: number | null;
  answered: boolean;
  answer_decision_correct: boolean;
};

export type Evaluation = {
  answer_quality?: AnswerQuality;
  retrieval_quality?: RetrievalQuality;
  ground_truth?: GroundTruthInfo;
  system?: { latency_ms: number; total_tokens: number | null; judge_tokens: number | null; error: boolean };
  evaluated_at?: string;
  duration_ms?: number;
  error?: string;
};

export type FailureCategory = "retrieval_failure" | "context_construction_failure" | "generation_failure" | "system_error" | "none";

export type Diagnosis = {
  category: FailureCategory;
  category_label: string;
  subtype: string;
  confidence: "confirmed" | "suspected";
  rule: string;
  summary: string;
  reasons: string[];
  recommendation: string;
  ground_truth: boolean;
  signals?: Record<string, unknown>;
  explanation?: { method: string; text: string; generated_at: string };
};

export type TraceContext = {
  chunk_ids: number[];
  labels: Record<string, number>;
  dropped_chunk_ids: number[];
  chars: number;
  max_chars: number;
  text?: string;
};

export type QueryTrace = {
  query_log_id: number;
  trace_id: string;
  created_at: string | null;
  source: string;
  original_query: string;
  rewritten_query: string | null;
  retrieval_mode: string | null;
  top_k: number | null;
  retrieved_chunks: RetrievedChunk[];
  reranked_chunks: RetrievedChunk[];
  vector_chunks: RetrievedChunk[];
  keyword_chunks: RetrievedChunk[];
  context: TraceContext | null;
  raw_answer: string | null;
  final_citations: Citation[];
  validation_result: Record<string, unknown>;
  model_usage: {
    model: string;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    estimated_cost: number | null;
  };
  metrics: {
    query_latency_ms?: number;
    retrieval_latency_ms?: number;
    embedding_latency_ms?: number;
    llm_latency_ms?: number;
    empty_retrieval?: boolean;
    no_answer?: boolean;
    citation_failure?: boolean;
    estimated_cost?: number;
  };
  stages: StageTiming[];
  latency_ms: number;
  answer: string | null;
  status: string;
  error_message: string | null;
  evaluation_status: "pending" | "completed" | "skipped" | "failed";
  evaluation: Evaluation;
  diagnosis: Diagnosis | Record<string, never>;
  auth: {
    user_id: string | null;
    groups: string[];
    role: string | null;
  };
  denied_retrieval_count: number;
};

export type QueryListItem = {
  id: number;
  trace_id: string;
  query: string;
  status: string;
  source: string;
  latency_ms: number;
  total_tokens: number | null;
  model: string;
  evaluation_status: string;
  faithfulness: number | null;
  answer_relevance: number | null;
  failure_category: FailureCategory | null;
  failure_subtype: string | null;
  confidence: string | null;
  user_id: string | null;
  created_at: string | null;
};

export type QueryListResponse = { total: number; items: QueryListItem[] };

export type QueryListParams = {
  limit?: number;
  offset?: number;
  source?: "api" | "evaluation" | "all";
  status?: string;
  category?: string;
  search?: string;
};

export type AnalyticsSummary = {
  total_queries: number;
  answered: number;
  no_answer: number;
  errors: number;
  error_rate: number | null;
  no_answer_rate: number | null;
  avg_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  avg_faithfulness: number | null;
  avg_answer_relevance: number | null;
  evaluated: number;
  pending_evaluations: number;
  total_tokens: number;
  avg_tokens: number | null;
  estimated_cost: number;
  failure_categories: { category: FailureCategory; label: string; count: number }[];
  undiagnosed: number;
  failure_subtypes: { key: string; count: number }[];
  stage_latency: { name: string; label: string; avg_ms: number; samples: number }[];
};

export type TimeseriesPoint = {
  bucket: string;
  queries: number;
  errors: number;
  error_rate: number | null;
  avg_latency_ms: number;
  p95_latency_ms: number | null;
  avg_faithfulness: number | null;
  avg_answer_relevance: number | null;
  tokens: number;
  failures: number;
};

export type EvalCase = {
  id: number;
  external_id: string | null;
  question: string;
  should_answer: boolean;
  expected_documents: string[];
  expected_pages: number[];
  expected_evidence: string[];
  reference_answer: string | null;
  tags: string[];
};

export type EvalDataset = {
  id: number;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string | null;
  case_count: number;
  cases?: EvalCase[];
};

export type EvalCaseInput = Partial<Omit<EvalCase, "id">> & { id?: string; question: string; expected_source_filename?: string; expected_page?: number; expected_answer?: string };

export type EvalRunSummary = {
  case_count?: number;
  retrieval?: { recall_at_k: number | null; precision_at_k: number | null; mrr: number | null; hit_at_k: number | null; measured_cases: number };
  answer?: { faithfulness: number | null; answer_relevance: number | null; reference_overlap: number | null; answer_decision_accuracy: number | null; judged_cases: number };
  system?: { avg_latency_ms: number | null; p95_latency_ms: number | null; error_rate: number | null; total_tokens: number; judge_tokens: number };
  failure_categories?: Record<FailureCategory, number>;
};

export type EvalRun = {
  id: number;
  dataset_id: number;
  label: string;
  status: "queued" | "running" | "completed" | "failed";
  config: Record<string, string | number | boolean | null>;
  summary: EvalRunSummary;
  case_count: number;
  completed_count: number;
  error_message: string | null;
  created_by: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type EvalResult = {
  id: number;
  case_id: number | null;
  question: string | null;
  should_answer: boolean | null;
  expected_documents: string[];
  query_log_id: number | null;
  answer: string | null;
  status: string | null;
  latency_ms: number | null;
  retrieval_quality: RetrievalQuality | null;
  answer_quality: AnswerQuality | null;
  ground_truth: GroundTruthInfo | null;
  failure_category: FailureCategory | null;
  diagnosis: Diagnosis;
};

export type EvalRunDetail = EvalRun & { results: EvalResult[] };

export type EvalRunCreate = {
  dataset_id: number;
  label?: string;
  top_k?: number;
  retrieval_mode?: "hybrid" | "vector";
  reranking_enabled?: boolean;
  judge?: "auto" | "llm" | "heuristic";
};

export type RunComparison = {
  runs: EvalRun[];
  cases: {
    case_id: number;
    question: string;
    runs: Record<string, { failure_category: FailureCategory | null; subtype: string | null; recall_at_k: number | null; mrr: number | null; faithfulness: number | null }>;
  }[];
};

export type BenchmarkSection = {
  accuracy: number;
  labels: FailureCategory[];
  confusion_matrix: Record<string, Record<string, number>>;
  per_class: Record<string, { support: number; precision: number | null; recall: number | null; f1: number }>;
  rules_fired: Record<string, number>;
  misclassified: { scenario: string; expected: string; predicted: string; rule: string }[];
};

export type BenchmarkReport =
  | { available: false; command: string }
  | ({ available: true; judge: string; scenario_count: number; without_ground_truth: BenchmarkSection } & BenchmarkSection);

export type ApiErrorPayload = {
  error?: {
    code: string;
    message: string;
    trace_id?: string;
  };
  detail?: unknown;
};

export type StoredQuery = QueryResponse & {
  question: string;
  createdAt: string;
  trace?: QueryTrace;
};

export type StoredJob = IngestionJob & {
  filename: string;
};
