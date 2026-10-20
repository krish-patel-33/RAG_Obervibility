import type {
  AnalyticsSummary,
  ApiErrorPayload,
  BenchmarkReport,
  Diagnosis,
  DocumentSummary,
  EvalCaseInput,
  EvalDataset,
  EvalRun,
  EvalRunCreate,
  EvalRunDetail,
  HealthResponse,
  IngestResponse,
  IngestionJob,
  QueryListParams,
  QueryListResponse,
  QueryRequest,
  QueryResponse,
  QueryTrace,
  ReadinessResponse,
  RunComparison,
  TimeseriesPoint
} from "@/lib/types";

export class RagApiError extends Error {
  status: number;
  payload: ApiErrorPayload | null;

  constructor(message: string, status: number, payload: ApiErrorPayload | null) {
    super(message);
    this.name = "RagApiError";
    this.status = status;
    this.payload = payload;
  }
}

export type RagClientConfig = {
  baseUrl: string;
  apiKey: string;
};

type Params = Record<string, string | number | boolean | null | undefined>;

export class RagApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: RagClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  health() {
    return this.request<HealthResponse>("/api/v1/health", { auth: false });
  }

  readiness() {
    return this.request<ReadinessResponse>("/api/v1/health/ready", { auth: false });
  }

  async ingest(file: File, onProgress?: (progress: number) => void) {
    onProgress?.(12);
    const form = new FormData();
    form.append("file", file);
    onProgress?.(35);
    const response = await this.request<IngestResponse>("/api/v1/documents/ingest", {
      method: "POST",
      body: form
    });
    onProgress?.(100);
    return response;
  }

  documents() {
    return this.request<DocumentSummary[]>("/api/v1/documents");
  }

  deleteDocument(documentId: number) {
    return this.request<{ deleted: boolean; document_id: number; filename: string }>(`/api/v1/documents/${documentId}`, {
      method: "DELETE"
    });
  }

  job(jobId: string) {
    return this.request<IngestionJob>(`/api/v1/ingestion-jobs/${jobId}`);
  }

  query(payload: QueryRequest) {
    return this.post<QueryResponse>("/api/v1/query", payload);
  }

  trace(queryLogId: number) {
    return this.request<QueryTrace>(`/api/v1/query/${queryLogId}/trace`);
  }

  explain(queryLogId: number) {
    return this.post<Diagnosis>(`/api/v1/query/${queryLogId}/explain`);
  }

  reevaluate(queryLogId: number) {
    return this.post<QueryTrace>(`/api/v1/query/${queryLogId}/evaluate`);
  }

  queries(params: QueryListParams = {}) {
    return this.request<QueryListResponse>(`/api/v1/queries${toQuery(params)}`);
  }

  summary(params: { source?: string; days?: number } = {}) {
    return this.request<AnalyticsSummary>(`/api/v1/analytics/summary${toQuery(params)}`);
  }

  timeseries(params: { source?: string; days?: number; bucket?: "day" | "hour" } = {}) {
    return this.request<{ bucket: string; points: TimeseriesPoint[] }>(`/api/v1/analytics/timeseries${toQuery(params)}`);
  }

  datasets() {
    return this.request<EvalDataset[]>("/api/v1/evaluation/datasets");
  }

  dataset(datasetId: number) {
    return this.request<EvalDataset>(`/api/v1/evaluation/datasets/${datasetId}`);
  }

  createDataset(payload: { name: string; description?: string; cases: EvalCaseInput[] }) {
    return this.post<EvalDataset>("/api/v1/evaluation/datasets", payload);
  }

  runs(datasetId?: number) {
    return this.request<EvalRun[]>(`/api/v1/evaluation/runs${toQuery({ dataset_id: datasetId })}`);
  }

  run(runId: number) {
    return this.request<EvalRunDetail>(`/api/v1/evaluation/runs/${runId}`);
  }

  createRun(payload: EvalRunCreate) {
    return this.post<EvalRun>("/api/v1/evaluation/runs", payload);
  }

  compare(runIds: number[]) {
    return this.request<RunComparison>(`/api/v1/evaluation/compare${toQuery({ run_ids: runIds.join(",") })}`);
  }

  benchmark() {
    return this.request<BenchmarkReport>("/api/v1/evaluation/diagnosis-benchmark");
  }

  private post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { "Content-Type": "application/json" }
    });
  }

  private async request<T>(path: string, init: RequestInit & { auth?: boolean } = {}) {
    if (init.auth !== false && !this.apiKey) {
      throw new RagApiError("Not connected yet. Add your access key in Settings.", 0, null);
    }

    // An empty base URL is valid: it means the RAG API is served on the
    // same origin (for example a combined Vercel deployment), so relative
    // paths resolve automatically against the console URL.
    const headers = new Headers(init.headers);
    if (init.auth !== false) headers.set("X-API-Key", this.apiKey);

    let response: Response;
    try {
      response = await fetch(this.baseUrl ? `${this.baseUrl}${path}` : path, {
        ...init,
        headers,
        cache: "no-store"
      });
    } catch (error) {
      throw new RagApiError(error instanceof Error ? error.message : "Network request failed", 0, null);
    }

    const text = await response.text();
    let payload: T | ApiErrorPayload | null = null;
    if (text) {
      try {
        payload = JSON.parse(text) as T | ApiErrorPayload;
      } catch {
        // Proxies and crashed servers can answer with HTML or plain text.
        throw new RagApiError(`Unexpected non-JSON response (HTTP ${response.status})`, response.status, null);
      }
    }
    if (!response.ok) {
      const apiPayload = payload as ApiErrorPayload | null;
      const message = apiPayload?.error?.message || `Request failed with HTTP ${response.status}`;
      throw new RagApiError(message, response.status, apiPayload);
    }
    return payload as T;
  }
}

function toQuery(params: Params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
