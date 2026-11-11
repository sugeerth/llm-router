/**
 * llm-router — library entry.
 *
 *   import { createRouter, createHandler, serve } from '@sugeerth/llm-router';
 *
 *   const router = await createRouter();                 // discovers local + free providers
 *   const { json } = await router.complete({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
 *
 *   await serve(createHandler(router), { port: 4000 });  // OpenAI + Anthropic compatible server
 */

import { Router } from './router.js';

export { Router, STRATEGIES } from './router.js';
export { createHandler, serve, routerStatus } from './server.js';
export { BUILTIN_PROVIDERS } from './providers.js';
export { loadConfig } from './config.js';
export { anthropicToOpenAI, openAIToAnthropic } from './anthropic.js';
export { VERSION } from './util.js';

/** Create a router and discover models. Options: see README ("Configuration"). */
export async function createRouter(options = {}) {
    const router = new Router(options);
    await router.refresh();
    return router;
}
