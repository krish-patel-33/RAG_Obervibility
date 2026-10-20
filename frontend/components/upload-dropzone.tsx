"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import { RagApiError } from "@/lib/api";
import type { StoredJob } from "@/lib/types";
import { useConsoleSettings } from "@/lib/settings";
import { useConsoleStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/status-chip";

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
      throw new Error("Ingestion job timed out while polling.");
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
      <motion.div
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
        className="rounded-lg border border-dashed border-white/15 bg-zinc-950/70 p-8 text-center transition-colors data-[dragging=true]:border-cyan-300/60 data-[dragging=true]:bg-cyan-300/5"
        data-dragging={dragging}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10">
          <FileUp className="h-6 w-6 text-cyan-200" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-white">Drop documents to index</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
          Select or drop one or many PDF, plain-text and Markdown files. Each is parsed, chunked, embedded and stored for retrieval.
        </p>
        <Button className="mt-6" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Uploading…" : "Select files"}
        </Button>
      </motion.div>

      {queue.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>
                {done} of {queue.length} processed{failed ? ` · ${failed} failed` : ""}
              </span>
            </CardTitle>
            <Progress value={(done / queue.length) * 100} />
          </CardHeader>
          <CardContent className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{item.name}</div>
                  {item.error && <div className="mt-1 text-xs text-red-200">{item.error}</div>}
                  {item.status === "completed" && <div className="mt-1 text-xs text-zinc-500">{item.chunks ?? 0} chunks indexed</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {(item.status === "uploading" || item.status === "processing") && <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />}
                  {item.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
                  {item.status === "failed" && <XCircle className="h-4 w-4 text-red-300" />}
                  <StatusChip status={item.status === "waiting" ? "queued" : item.status === "uploading" ? "processing" : item.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
