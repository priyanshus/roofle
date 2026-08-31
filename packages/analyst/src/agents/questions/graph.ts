import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { END, START, StateGraph } from '@langchain/langgraph';

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

// Builds the three-agent graph:
//   START -> investigator -> (validator -> resolver | END)
export function buildGraph(model: BaseChatModel) {
  const investigator = new Investigator(model);
  const validator = new Validator(model);
  const resolver = new Resolver(model);

  const graph = new StateGraph(AgentState)
    .addNode('investigator', (state) => investigator.run(state))
    .addNode('validator', (state) => validator.run(state))
    .addNode('resolver', (state) => resolver.run(state))
    .addEdge(START, 'investigator')
    .addConditionalEdges('investigator', route, {
      validator: 'validator',
      [SKIP]: END,
    })
    .addEdge('validator', 'resolver')
    .addEdge('resolver', END);

  return graph.compile();
}
