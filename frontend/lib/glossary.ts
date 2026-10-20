// Plain-language definitions shown next to metrics, for readers who have never seen the backend.
export const GLOSSARY: Record<string, { title: string; text: string }> = {
  total_queries: { title: "Total queries", text: "How many questions the system received in the selected period." },
  latency: {
    title: "Response latency",
    text: "Time from receiving a question to sending the answer. p95 means 95% of answers were faster than this value."
  },
  error_rate: {
    title: "Error rate",
    text: "Share of questions where the pipeline broke (for example the language model was unreachable). Declined questions are not errors."
  },
  no_answer_rate: {
    title: "No-answer rate",
    text: "Share of questions where the system said it could not find the answer instead of guessing."
  },
  faithfulness: {
    title: "Faithfulness",
    text: "Of the facts stated in an answer, the share that the retrieved documents actually support. 100% means nothing was made up."
  },
  answer_relevance: {
    title: "Answer relevance",
    text: "How directly the answer addresses the question that was asked, from 0% (off topic) to 100%."
  },
  tokens: {
    title: "Token usage",
    text: "Tokens are the word pieces a language model reads and writes. They drive cost and speed."
  },
  recall_at_k: {
    title: "Recall@K",
    text: "Of all document passages that contain the answer, the share found in the top K results. Needs a dataset that says which passages are relevant."
  },
  precision_at_k: {
    title: "Precision@K",
    text: "Of the top K passages retrieved, the share that are relevant. Low precision means the model is given lots of noise."
  },
  mrr: {
    title: "Mean Reciprocal Rank",
    text: "How high the first relevant passage is ranked: 1.0 when it is first, 0.5 when second, 0.33 when third, and so on."
  },
  hit_at_k: { title: "Hit@K", text: "Share of questions where at least one relevant passage appeared in the top K." },
  answer_decision_accuracy: {
    title: "Answer/decline accuracy",
    text: "Share of questions where the system correctly chose to answer (when the answer exists) or to decline (when it does not)."
  },
  reference_overlap: {
    title: "Reference overlap",
    text: "Share of the key terms in the expected answer that also appear in the system's answer."
  },
  retrieval_failure: {
    title: "Retrieval failure",
    text: "The passage needed to answer was not found by the search step."
  },
  context_construction_failure: {
    title: "Context construction problem",
    text: "The right passage was found, but it, or its key sentence, did not make it into the text given to the language model."
  },
  generation_failure: {
    title: "Generation failure",
    text: "The evidence was given to the language model, but its answer was missing, unsupported, contradictory or wrong."
  },
  system_error: { title: "System error", text: "A technical error stopped the pipeline before an answer could be judged." },
  confidence: {
    title: "Confirmed vs suspected",
    text: "Confirmed diagnoses use a ground-truth dataset. Suspected ones are inferred from the trace alone, so they can be wrong."
  },
  stages: {
    title: "Pipeline stages",
    text: "Each question goes through these steps in order. Evaluation runs after the answer is sent, so users never wait for it."
  }
};
