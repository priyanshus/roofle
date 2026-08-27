import { StateGraph, START, END } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import { AgentState } from './state.js';
import { Investigator } from './investigator.js';
import { Validator } from './validator.js';
import { Resolver } from './resolver.js';

// Builds the three-agent graph:
//   START -> investigator -> validator -> resolver -> END
export function buildGraph(model: BaseChatModel) {
  const investigator = new Investigator(model);
  const validator = new Validator(model);
  const resolver = new Resolver(model);

  const graph = new StateGraph(AgentState)
    .addNode('investigator', (state) => investigator.run(state))
    .addNode('validator', (state) => validator.run(state))
    .addNode('resolver', (state) => resolver.run(state))
    .addEdge(START, 'investigator')
    .addEdge('investigator', 'validator')
    .addEdge('validator', 'resolver')
    .addEdge('resolver', END);

  return graph.compile();
}
