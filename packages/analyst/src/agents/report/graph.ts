import { StateGraph, START, END } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { MeetingState } from './state.js';
import { Extractor } from './extractor.js';
import { Evaluator } from './evaluator.js';
import { Summarizer } from './summarizer.js';

// Builds the meeting-analysis graph:
//   START -> extractor -> evaluator -> summarizer -> END
export function buildMeetingGraph(model: BaseChatModel) {
  const extractor = new Extractor(model);
  const evaluator = new Evaluator(model);
  const summarizer = new Summarizer(model);

  const graph = new StateGraph(MeetingState)
    .addNode('extractor', (state) => extractor.run(state))
    .addNode('evaluator', (state) => evaluator.run(state))
    .addNode('summarizer', (state) => summarizer.run(state))
    .addEdge(START, 'extractor')
    .addEdge('extractor', 'evaluator')
    .addEdge('evaluator', 'summarizer')
    .addEdge('summarizer', END);

  return graph.compile();
}
