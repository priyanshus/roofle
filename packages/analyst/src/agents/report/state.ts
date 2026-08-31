import { Annotation } from '@langchain/langgraph';
import type { MeetingMetric } from '@roofle/shared';

// Shared state flowing through the meeting-analysis graph. This is a separate
// graph from the questions agent; it consumes the full session transcription
// and produces scored metrics for the dashboard.
export const MeetingState = Annotation.Root({
  // Full session transcription, mic and speaker interleaved by time.
  transcription: Annotation<string>({ reducer: (a, b) => b ?? a, default: () => '' }),

  // Selected persona shaping the evaluator prompt.
  persona: Annotation<string | undefined>({ reducer: (a, b) => b ?? a, default: () => undefined }),
  personaContext: Annotation<string | undefined>({
    reducer: (a, b) => b ?? a,
    default: () => undefined,
  }),

  // Scored metrics produced by the evaluator agent.
  metrics: Annotation<MeetingMetric[]>({ reducer: (a, b) => b ?? a, default: () => [] }),
});
