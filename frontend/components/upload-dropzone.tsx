"use client";

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, Loader2, Upload, XCircle } from "lucide-react";
import { RagApiError } from "@/lib/api";
import type { StoredJob } from "@/lib/types";
import { useConsoleSettings } from "@/lib/settings";
import { useConsoleStore } from "@/lib/store";
import { Progress } from "@/components/ui/progress";

const SUPPORTED = [".pdf", ".txt", ".md", ".markdown"];

type QueueItem = {
  id: string;
  name: string;
  status: "waiting" | "uploading" | "processing" | "completed" | "failed";
  chunks?: number;
  error?: string;
};

export function UploadDropzone({ onIndexed }: { onIndexed?: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const { client } = useConsoleSettings();
  const { upsertJob } = useConsoleStore();

  const update = (id: string, patch: Partial<QueueItem>) =>
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const pollJob = useCallback(
    async (jobId: string, filename: string) => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const job = await client.job(jobId);
        upsertJob({ ...job, filename });
        if (job.status === "completed" || job.status === "failed") return job;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      throw new Error("Processing is taking longer than expected. Check back in a moment.");
    },
    [client, upsertJob]
  );

  const uploadOne = useCallback(
    async (file: File, id: string) => {
      if (!SUPPORTED.some((extension) => file.name.toLowerCase().endsWith(extension))) {
        update(id, { status: "failed", error: "Only PDF, .txt and .md files are supported." });
        return;
      }
      update(id, { status: "uploading" });
      try {
        const response = await client.ingest(file);
        const initial: StoredJob = {
          job_id: response.job_id,
          status: response.status,
          document_id: response.document_id || null,
          error_message: null,
          chunk_count: response.chunk_count,
          created_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
          failed_at: null,
          filename: response.filename
        };
        upsertJob(initial);
        update(id, { status: "processing" });
        const job = await pollJob(response.job_id, response.filename);
        update(id, job.status === "completed" ? { status: "completed", chunks: job.chunk_count } : { status: "failed", error: job.error_message ?? "Ingestion failed." });
      } catch (caught) {
        const message = caught instanceof RagApiError ? caught.message : caught instanceof Error ? caught.message : "Upload failed.";
        update(id, { status: "failed", error: message });
      }
    },
    [client, pollJob, upsertJob]
  );

  const uploadMany = useCallback(
    async (fileList: FileList | null | undefined) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;
      const items = files.map((file, index) => ({ id: `${Date.now()}-${index}-${file.name}`, name: file.name, status: "waiting" as const }));
      setQueue(items);
      setBusy(true);
      // One file at a time: each upload is parsed and embedded inside the request,
      // and SQLite allows a single writer.
      for (let index = 0; index < files.length; index += 1) {
        await uploadOne(files[index], items[index].id);
      }
      setBusy(false);
      onIndexed?.();
    },
    [onIndexed, uploadOne]
  );

  const done = queue.filter((item) => item.status === "completed" || item.status === "failed").length;
  const failed = queue.filter((item) => item.status === "failed").length;

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
        onChange={(event) => {
          uploadMany(event.target.files);
          // Reset so choosing the same files again still triggers a change.
          event.target.value = "";
        }}
      />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) uploadMany(event.dataTransfer.files);
        }}
        className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/15 px-6 py-10 text-center transition-colors data-[dragging=true]:border-blue-400/60 data-[dragging=true]:bg-blue-500/5"
        data-dragging={dragging}
      >
        <Upload className="h-5 w-5 text-zinc-500" strokeWidth={1.75} />
        <p className="mt-3 text-sm text-zinc-300">
          Drag files here, or{" "}
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="font-medium text-white underline-offset-4 hover:underline disabled:opacity-50">
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-zinc-500">PDF, TXT or Markdown{busy ? " · Uploading…" : ""}</p>
      </div>

      {queue.length > 0 && (
        <div className="rounded-lg border border-white/[0.08]">
          <div className="border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>{done} of {queue.length} processed{failed ? ` · ${failed} failed` : ""}</span>
            </div>
            <Progress value={(done / queue.length) * 100} className="mt-2" />
          </div>
          <div className="divide-y divide-white/[0.06]">
            {queue.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-zinc-200">{item.name}</div>
                  {item.error && <div className="mt-0.5 text-xs text-red-300">{item.error}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                  {item.status === "waiting" && "Waiting"}
                  {(item.status === "uploading" || item.status === "processing") && (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {item.status === "uploading" ? "Uploading" : "Processing"}
                    </>
                  )}
                  {item.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                  {item.status === "failed" && <XCircle className="h-4 w-4 text-red-400" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
