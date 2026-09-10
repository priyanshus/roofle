# Question Agent Workflow

This document describes the end-to-end pipeline that turns live transcription
into clarifying questions surfaced during a conversation. It lives in the
`@roofle/analyst` package and is built on LangGraph.

```
Transcription events
      │
      ▼
ParagraphBuilder ──► SQLite (paragraphs) ──► AnalysisScheduler
                                                   │
                                                   ▼
                                          SessionState (per session+source)
                                                   │  (interval + gates)
                                                   ▼
                                          ParagraphAnalyst
                                                   │
                                                   ▼
                    ┌────────────────  Question Graph  ───────────────┐
                    │                                                  │
                    │   START ──► summarizer ──► investigator          │
                    │                              │                   │
                    │                    ┌─────────┴─────────┐         │
                    │                    ▼                   ▼         │
                    │               validator          (empty: END)    │
                    │                    │                              │
                    │                    ▼                              │
                    │                resolver ──► END                   │
                    └──────────────────────────────────────────────────┘
                                                   │
                            ┌──────────────────────┼──────────────────┐
                            ▼                      ▼                  ▼
                       validated          answered / stale        rolling summary
                       questions          question ids            (persisted to SQLite)
                            │                      │
                            ▼                      ▼
                   onQuestion events        resolveQuestion(id)
```

## Overview

The analyst consumes finalized transcription events and, on a cost-aware
schedule, runs an agent graph that:

1. **Summarizes** the whole conversation so far (rolling summary).
2. **Investigates** the newest chunk and proposes clarifying questions.
3. **Validates** those questions, keeping only strong, non-redundant ones.
4. **Resolves** previously-open questions that have now been answered or
   gone stale.

The graph runs per `(sessionId, source)`. There are two sources: the **system
audio** (the other party / speaker) and the **microphone** (your own voice).

---

## 1. Ingest and paragraph building

Transcription flows from the transcriber into the analyst via
[`Analyst.ingest()`](packages/analyst/src/index.ts):

```ts
ingest(transcription) {
  this.db.touchSession(transcription.sessionId);
  this.db.insertStream(transcription);
  this.paragraphBuilder.add(transcription);
}
```

[`ParagraphBuilder`](packages/analyst/src/services/paragraphBuilder.ts) groups
finalized transcription events into a single accumulated `Paragraph` per
`(sessionId, source)`. The paragraph text is persisted via
`upsertParagraph` and handed to the scheduler on every update. Sequence
numbers are tracked so out-of-order events are buffered and replayed in order.

## 2. Scheduling

[`AnalysisScheduler`](packages/analyst/src/services/analysisScheduler.ts) owns
one [`SessionState`](packages/analyst/src/services/sessionState.ts) per
`(sessionId, source)` and a shared [`AnalysisWorker`](packages/analyst/src/services/analysisWorker.ts)
queue with bounded concurrency and retry.

`SessionState` is a small state machine:

```
accumulating ──(interval + gates pass)──► analyzing ──(done)──► cooldown
     ^                                                            │
     └────────────────────(cooldown elapsed)─────────────────────┘
```

The LLM is only invoked when the paragraph is **long enough** (`minChars`) and
has **grown enough** since the last run (`minNewChars`). This bounds cost to at
most one LLM call per interval per session. When the gates pass, the session
enqueues a job that collects the inputs for the graph:

- `delta` — the new transcription since the last analysis (`text.substring(lastAnalyzedLength)`).
- `openQuestions` — currently-open questions for this session+source.
- `context` / `contextLabel` — the **other** source's accumulated transcription
  and its human label, so the agents know what your own voice already said.
- `sourceLabel` — human label for this source.
- `prevSummary` — the stored rolling conversation summary from the previous run.

## 3. The question graph

The graph is defined in
[`agents/questions/graph.ts`](packages/analyst/src/agents/questions/graph.ts).
It shares state via
[`agents/questions/state.ts`](packages/analyst/src/agents/questions/state.ts).

### State fields

| Field | Purpose |
| --- | --- |
| `paragraph` | The new transcription delta under investigation. |
| `sourceLabel` | Human label for the paragraph's source. |
| `context` | The other source's transcription (your own voice). |
| `contextLabel` | Human label for the context. |
| `prevSummary` | Stored rolling summary from the previous run (input). |
| `summary` | Freshly computed rolling summary (output, injected into agents). |
| `enableSummary` | Whether the summarizer node should run. |
| `questions` | Questions produced by the investigator. |
| `validatedQuestions` | Questions that survived the validator. |
| `openQuestions` | Open question ids + text fed to the resolver. |
| `answered` / `stale` | Open questions the resolver marked answered / stale. |

### Routing

- `START` routes to the **summarizer** when `enableSummary` is true, otherwise
  straight to the **investigator**.
- After the investigator, if it produced no questions, the graph ends; otherwise
  it proceeds to the **validator**, then the **resolver**.

## 4. The agents

### Summarizer (new)

[`agents/summary/summarizer.ts`](packages/analyst/src/agents/summary/summarizer.ts)
maintains a single **rolling summary of the whole conversation**. Its update
rule is the cheapest possible:

```
summary = summarize(prevSummary + newDelta + otherSourceContext)
```

Because both `SessionState`s (system + mic) fold in their own delta and the
other source's context, the single per-session summary stays whole-conversation.
Its prompt
([`prompts/summarizer.txt`](packages/analyst/src/agents/summary/prompts/summarizer.txt))
tells it to compress while preserving claims, numbers, commitments, names, and
open threads — the facts the downstream agents need to avoid re-asking.

### Investigator

[`agents/questions/investigator.ts`](packages/analyst/src/agents/questions/investigator.ts)
reads the new paragraph plus the microphone context **plus the running summary**
and proposes 2–5 sharp clarifying questions a professional would actually ask
next, using an 8-lens framework (unstated assumptions, incentive & motive,
claim-vs-evidence gaps, second-order consequences, alternatives, accountability,
contradiction, conspicuous absences). With the summary, it can now:

- Avoid re-asking what the speaker already covered in earlier chunks.
- Ground questions in the broader conversation, not just this chunk.

Output is structured (`{ questions, reasoning }`) via the model's native tool
calling.

### Validator

[`agents/questions/validator.ts`](packages/analyst/src/agents/questions/validator.ts)
is a skeptical filter that rejects weak, lazy, or unfounded questions. Each
candidate must pass **all** checks to be approved:

1. Not basic/definitional
2. Grounded, not hallucinated
3. Passes the "expert in the room" test
4. Specific, not generic
5. Non-redundant within the candidate list
6. Actionable
7. Correctly justified
8. Appropriate tone
9. Not already asked/answered in the microphone
10. **Not already covered in the summary** (new — added for the summary agent)

Output is `{ questions }` — only the approved questions.

### Resolver

[`agents/questions/resolver.ts`](packages/analyst/src/agents/questions/resolver.ts)
performs **one-way** resolution: it decides which currently-open questions are
now **answered** or **stale** given the new transcription, the microphone
context, and now the **running summary**. It never generates new questions, so
there is no feedback loop. Output is `{ answered, stale }`, each entry carrying
the question `id` and a terse `reason`.

## 5. Persisting results

When the graph finishes, [`SessionState.onResult()`](packages/analyst/src/services/sessionState.ts)
applies the results:

- **Answered / stale** questions are resolved in SQLite via
  `resolveQuestion(id, status, reason)` — a one-way transition.
- **New questions** are inserted via `insertQuestions(...)`, returning their ids.
- **The new rolling summary** is persisted via `upsertSummary(sessionId, summary)`
  so the next run can read it back as `prevSummary`.

The scheduler then emits `onUpdate`, which
[`Analyst.handleUpdate()`](packages/analyst/src/index.ts) turns into `QuestionEvent`s
(open / answered / stale) forwarded to the UI over WebSocket.

## 6. Configuration

Scheduling and the summary step are controlled by
[`AnalysisConfig`](packages/analyst/src/config.ts) and
[`config.json`](packages/analyst/config.json):

| Key | Default | Description |
| --- | --- | --- |
| `analysis.intervalMs` | `60000` | How often each session's paragraph is checked. |
| `analysis.minChars` | `200` | Minimum accumulated text before the analyst runs. |
| `analysis.minNewChars` | `100` | Minimum new text since the last run before running again. |
| `analysis.cooldownMs` | `10000` | Cooldown between runs per session. |
| `analysis.concurrency` | `2` | Max parallel LLM analysis jobs. |
| `analysis.maxRetries` | `2` | Retries per job on failure. |
| `analysis.enableSummary` | `true` | When `true`, run the summarizer before the question agents. Set to `false` to save an LLM call per analysis. |

## 7. Data model

Relevant SQLite tables (see
[`db/schema.ts`](packages/analyst/src/db/schema.ts)):

| Table | Purpose |
| --- | --- |
| `streams` | Raw finalized transcription events. |
| `paragraphs` | Accumulated paragraph text per `(session_id, source)`. |
| `questions` | Clarifying questions and their status (`open` / `answered` / `stale`). |
| `session_summaries` | One rolling conversation summary per `session_id` (new). |
| `sessions` | Session metadata. |

## 8. Key files

| File | Role |
| --- | --- |
| `packages/analyst/src/agents/summary/summarizer.ts` | Rolling summary agent. |
| `packages/analyst/src/agents/questions/investigator.ts` | Proposes questions. |
| `packages/analyst/src/agents/questions/validator.ts` | Filters weak questions. |
| `packages/analyst/src/agents/questions/resolver.ts` | Resolves open questions. |
| `packages/analyst/src/agents/questions/graph.ts` | LangGraph wiring + routing. |
| `packages/analyst/src/agents/questions/state.ts` | Shared graph state. |
| `packages/analyst/src/services/paragraphBuilder.ts` | Groups events into paragraphs. |
| `packages/analyst/src/services/analysisScheduler.ts` | Per-session scheduling. |
| `packages/analyst/src/services/sessionState.ts` | Per-session state machine + gating. |
| `packages/analyst/src/services/paragraphAnalyst.ts` | Invokes the graph per analysis. |
| `packages/analyst/src/db/summaryRepository.ts` | Persists rolling summaries. |
| `packages/analyst/src/index.ts` | Top-level `Analyst` facade + event emission. |
