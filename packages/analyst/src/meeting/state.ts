import { Annotation } from '@langchain/langgraph';
import type { MeetingMetric, MeetingTurn } from '@roofle/shared';

// Shared state flowing through the meeting-analysis graph. This is a separate
// graph from the questions agent; it consumes the full session transcription
// and produces a dashboard-ready meeting report.
export const MeetingState = Annotation.Root({
  // Full session transcription, mic and speaker interleaved by time.
  transcription: Annotation<string>({ reducer: (a, b) => b ?? a, default: () => '' }),

  // Selected persona shaping the evaluator and summarizer prompts.
  persona: Annotation<string | undefined>({ reducer: (a, b) => b ?? a, default: () => undefined }),
  personaContext: Annotation<string | undefined>({
    reducer: (a, b) => b ?? a,
    default: () => undefined,
  }),

  // Turns extracted by the extractor agent.
  turns: Annotation<MeetingTurn[]>({ reducer: (a, b) => b ?? a, default: () => [] }),

  // Scored metrics produced by the evaluator agent.
  metrics: Annotation<MeetingMetric[]>({ reducer: (a, b) => b ?? a, default: () => [] }),

  // Actionable recommendations produced by the summarizer agent.
  recommendations: Annotation<string[]>({ reducer: (a, b) => b ?? a, default: () => [] }),

  // One-paragraph executive summary produced by the summarizer agent.
  summary: Annotation<string>({ reducer: (a, b) => b ?? a, default: () => '' }),
});
