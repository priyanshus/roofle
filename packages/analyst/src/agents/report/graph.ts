import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { END, START, StateGraph } from '@langchain/langgraph';

import { Evaluator } from './evaluator.js';
import { MeetingState } from './state.js';

// Builds the meeting-analysis graph:
//   START -> evaluator -> END
// The evaluator scores quality metrics directly from the raw transcription.
export function buildMeetingGraph(model: BaseChatModel) {
  const evaluator = new Evaluator(model);

  const graph = new StateGraph(MeetingState)
    .addNode('evaluator', (state) => evaluator.run(state))
    .addEdge(START, 'evaluator')
    .addEdge('evaluator', END);

  return graph.compile();
}
