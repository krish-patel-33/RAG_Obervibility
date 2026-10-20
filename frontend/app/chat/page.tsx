"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { RagApiError } from "@/lib/api";
import type { QueryTrace, StoredQuery } from "@/lib/types";
import { useConsoleSettings } from "@/lib/settings";
import { useConsoleStore } from "@/lib/store";
import { CitationCard } from "@/components/citation-card";
import { TraceViewer } from "@/components/trace-viewer";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  query?: StoredQuery;
};

export default function ChatPage() {
  const { client } = useConsoleSettings();
  const { addQuery } = useConsoleStore();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [trace, setTrace] = useState<QueryTrace | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // Evaluation runs after the answer is sent; refresh the trace a few times to show its result.
  const followEvaluation = async (queryLogId: number) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const refreshed = await client.trace(queryLogId);
        setTrace((current) => (current && current.query_log_id === queryLogId ? refreshed : current));
        if (refreshed.evaluation_status !== "pending") return;
      } catch {
        return;
      }
    }
  };

  const canSubmit = useMemo(() => question.trim().length >= 3 && !loading, [loading, question]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    const trimmed = question.trim();
    setQuestion("");
    setError(null);
    setLoading(true);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    try {
      const response = await client.query({ question: trimmed });
      const nextTrace = response.query_log_id ? await client.trace(response.query_log_id) : null;
      const stored: StoredQuery = { ...response, question: trimmed, createdAt: new Date().toISOString(), trace: nextTrace ?? undefined };
      addQuery(stored);
      setTrace(nextTrace);
      setMessages((current) => [...current, { role: "assistant", content: response.answer, query: stored }]);
      if (nextTrace?.evaluation_status === "pending") void followEvaluation(nextTrace.query_log_id);
    } catch (caught) {
      const message = caught instanceof RagApiError ? caught.message : caught instanceof Error ? caught.message : "Something went wrong.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const openDetails = (query?: StoredQuery) => {
    if (query?.trace) setTrace(query.trace);
    setShowDetails(true);
  };

  return (
    <div className={cn("grid gap-8", showDetails && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
      <div className="flex min-h-[calc(100vh-8rem)] flex-col">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-white">Ask</h1>
          {trace && (
            <Button variant="ghost" size="sm" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              {showDetails ? "Hide details" : "Show details"}
            </Button>
          )}
        </div>

        <div className="flex-1 space-y-8">
          {messages.length === 0 && !loading && (
            <div className="pt-16 text-center">
              <h2 className="text-lg font-medium text-zinc-100">Ask a question about your documents</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
                Answers are drawn only from the documents you have uploaded, with a reference to each source. If the documents don&apos;t cover it, you&apos;ll be told so.
              </p>
            </div>
          )}

          {messages.map((message, index) =>
            message.role === "user" ? (
              <div key={index} className="flex justify-end">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-white/[0.07] px-4 py-2.5 text-sm leading-6 text-zinc-100">{message.content}</div>
              </div>
            ) : (
              <div key={index}>
                <p className={cn("whitespace-pre-wrap text-[15px] leading-7", message.query?.no_answer ? "text-zinc-400" : "text-zinc-100")}>{message.content}</p>
                {message.query?.citations.length ? (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-medium text-zinc-500">Sources</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {message.query.citations.map((citation) => (
                        <CitationCard key={`${message.query?.trace_id}-${citation.label}`} citation={citation} onClick={() => openDetails(message.query)} />
                      ))}
                    </div>
                  </div>
                ) : null}
                {message.query?.query_log_id && (
                  <button type="button" onClick={() => openDetails(message.query)} className="mt-3 text-xs text-zinc-500 hover:text-zinc-300">
                    How was this answered?
                  </button>
                )}
              </div>
            )
          )}

          {loading && (
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 mt-8 bg-zinc-950 pb-2 pt-2">
          {error && <div className="mb-3"><ErrorState title="Couldn't get an answer" message={error} /></div>}
          <form onSubmit={submit} className="flex items-end gap-2 rounded-xl border border-white/10 bg-zinc-900/60 p-2 focus-within:border-white/20">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask anything about your documents…"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <Button type="submit" size="icon" disabled={!canSubmit} title="Send" className="h-8 w-8 rounded-lg">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </form>
          <div className="mt-2 text-center text-xs text-zinc-600">Enter to send · Shift + Enter for a new line</div>
        </div>
      </div>

      {showDetails && (
        <div className="space-y-3 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto">
          {trace && (
            <Link href={`/trace?id=${trace.query_log_id}`} className="block text-right text-xs text-zinc-400 hover:text-zinc-200">
              Open full trace →
            </Link>
          )}
          <TraceViewer trace={trace} compact onUpdate={setTrace} />
        </div>
      )}
    </div>
  );
}
