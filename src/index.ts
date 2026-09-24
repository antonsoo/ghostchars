// Public library entry point. Works in Node and in the browser (no Node
// built-ins are imported anywhere under src/core) so it can run inside LLM
// input pipelines on either side.
export * from './core/index.js';
