"use client";

import { useState } from "react";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { UploadDropzone } from "@/components/upload-dropzone";
import { useConsoleSettings } from "@/lib/settings";
import { useApi } from "@/lib/use-api";
import { formatDate } from "@/lib/utils";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DocumentSummary } from "@/lib/types";

export default function UploadPage() {
  const { client } = useConsoleSettings();
  const documents = useApi((client) => client.documents(), []);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const items = documents.data ?? [];

  async function deleteDocument(doc: DocumentSummary) {
    if (!window.confirm(`Delete "${doc.filename}"? It will no longer be used to answer questions.`)) return;
    setDeletingId(doc.id);
    setDeleteError(null);
    try {
      await client.deleteDocument(doc.id);
      await documents.reload();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Documents" description="Questions are answered using the documents listed here." />
      <UploadDropzone onIndexed={documents.reload} />

      <div className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Your documents</h2>
          {items.length > 0 && <span className="text-xs text-zinc-500">{items.length} total</span>}
        </div>

        {documents.error && <div className="mb-3"><ErrorState title="Couldn't load documents" message={documents.error} /></div>}
        {deleteError && <div className="mb-3"><ErrorState title="Couldn't delete document" message={deleteError} /></div>}

        <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
          {documents.loading && !documents.data &&
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="p-4"><Skeleton className="h-5 w-1/2" /></div>
            ))}
          {documents.data && items.length === 0 && (
            <div className="p-8 text-center text-sm text-zinc-500">No documents yet. Upload one above to get started.</div>
          )}
          {items.map((doc) => (
            <div key={doc.id} className="group flex items-center gap-3 px-4 py-3">
              <FileText className="h-4 w-4 shrink-0 text-zinc-500" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-100">{doc.filename}</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {formatSize(doc.file_size_bytes)}
                  {formatSize(doc.file_size_bytes) && " · "}
                  Added {formatDate(doc.created_at)}
                  {doc.visibility === "public" && " · Shared with everyone"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-500 hover:bg-red-500/10 hover:text-red-300"
                disabled={deletingId !== null}
                onClick={() => deleteDocument(doc)}
                aria-label={`Delete ${doc.filename}`}
                title="Delete"
              >
                {deletingId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
