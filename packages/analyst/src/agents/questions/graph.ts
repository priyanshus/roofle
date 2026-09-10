import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { END, START, StateGraph } from '@langchain/langgraph';

import { Summarizer } from '../summary/summarizer.js';
import { Investigator } from './investigator.js';
import { Resolver } from './resolver.js';
import { AgentState } from './state.js';
import { Validator } from './validator.js';

// Route name for the branch that skips validation/resolution entirely.
const SKIP = 'skip';

// Routes after the investigator: run validation only when it produced
// questions. An empty result means there is nothing to filter or resolve, so
// the graph ends without calling the downstream agents.
function route(state: typeof AgentState.State): string {
  return state.questions.length > 0 ? 'validator' : SKIP;
}

// Routes from START: run the summarizer first when enabled, otherwise go
// straight to the investigator with an empty summary.
function startRoute(state: typeof AgentState.State): string {
  return state.enableSummary ? 'summarizer' : 'investigator';
}

// Builds the question-agent graph:
//   START -> (summarizer ->)? investigator -> (validator -> resolver | END)
export function buildGraph(model: BaseChatModel, _options?: { enableSummary?: boolean }) {
  const investigator = new Investigator(model);
  const validator = new Validator(model);
  const resolver = new Resolver(model);
  const summarizer = new Summarizer(model);

  const graph = new StateGraph(AgentState)
    .addNode('summarizer', async (state) => {
      const { summary } = await summarizer.run(state);
      return { summary };
    })
    .addNode('investigator', async (state) => {
      const { questions } = await investigator.run(state);
      return { questions };
    })
    .addNode('validator', (state) => validator.run(state))
    .addNode('resolver', (state) => resolver.run(state))
    .addConditionalEdges(START, startRoute, {
      summarizer: 'summarizer',
      investigator: 'investigator',
    })
    .addEdge('summarizer', 'investigator')
    .addConditionalEdges('investigator', route, {
      validator: 'validator',
      [SKIP]: END,
    })
    .addEdge('validator', 'resolver')
    .addEdge('resolver', END);

  return graph.compile();
}
