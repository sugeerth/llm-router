import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyKey, inferProfile } from '../src/profiles.js';
import { retryAfterSecs, diversify } from '../src/router.js';
import { parseModelList, resolveProviders } from '../src/providers.js';
import { normalizePath } from '../src/server.js';
import { anthropicToOpenAI } from '../src/anthropic.js';

test('familyKey matches the same model across providers', () => {
    const ids = ['llama-3.3-70b-versatile', 'meta-llama/llama-3.3-70b-instruct:free', 'llama-3.3-70b',
        'Meta-Llama-3.3-70B-Instruct', 'meta/Llama-3.3-70B-Instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
    for (const id of ids) assert.equal(familyKey(id), 'llama-3.3-70b', id);
    assert.equal(familyKey('llama3.1:8b'), familyKey('llama-3.1-8b-instant'));
    assert.equal(familyKey('openai/gpt-4o'), 'gpt-4o');
    assert.notEqual(familyKey('gpt-4o-mini'), familyKey('gpt-4o'));
});

test('inferProfile: known families, size fallback, metadata wins', () => {
    assert.ok(inferProfile('openai/gpt-oss-120b').quality > inferProfile('llama-3.1-8b-instant').quality);
    assert.equal(inferProfile('qwen3:8b').reasoning, true);
    assert.equal(inferProfile('some-new-model-32b').quality, 0.81);
    assert.equal(inferProfile('mystery').quality, 0.75);
    assert.equal(inferProfile('gemini-2.5-flash').vision, true);
    assert.equal(inferProfile('x', { tools: false, context: 4096 }).tools, false);
    assert.equal(inferProfile('x', { context: 4096 }).context, 4096);
});

test('retryAfterSecs understands the common header styles', () => {
    assert.equal(retryAfterSecs(new Headers({ 'retry-after': '12' })), 12);
    assert.equal(retryAfterSecs(new Headers({ 'x-ratelimit-reset-requests': '2m59.5s' })), 180);
    assert.equal(retryAfterSecs(new Headers({ 'x-ratelimit-reset-tokens': '6ms' })), 1);
    assert.equal(retryAfterSecs(new Headers({})), null);
});

test('diversify spreads attempts across providers first', () => {
    const c = (provider, id) => ({ provider, id });
    const out = diversify([c('a', 1), c('a', 2), c('b', 3), c('c', 4)]).map(x => x.id);
    assert.deepEqual(out, [1, 3, 4, 2]);
});

test('parseModelList: OpenRouter free filter, non-chat models dropped, Mistral dedupe', () => {
    const or = { id: 'openrouter', freeOnly: true };
    const models = parseModelList(or, {
        data: [
            { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, context_length: 131072, supported_parameters: ['tools'] },
            { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
            { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
        ],
    });
    assert.deepEqual(models.map(m => m.id), ['meta-llama/llama-3.3-70b-instruct:free']);
    assert.equal(models[0].context, 131072);
    assert.equal(models[0].tools, true);
    const paid = parseModelList(or, { data: [{ id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } }] }, { allowPaid: true });
    assert.equal(paid[0].pricing.input, 2.5);
    const mixed = parseModelList({ id: 'x' }, { data: [{ id: 'whisper-large-v3' }, { id: 'text-embedding-3-small' }, { id: 'llama-guard-4-12b' }, { id: 'qwen3-32b' }] });
    assert.deepEqual(mixed.map(m => m.id), ['qwen3-32b']);
    const mistral = parseModelList({ id: 'mistral' }, { data: [{ id: 'mistral-large-2411' }, { id: 'mistral-large-latest' }, { id: 'codestral-2501' }] });
    assert.deepEqual(mistral.map(m => m.id), ['mistral-large-latest', 'codestral-2501']);
    const gh = parseModelList({ id: 'github' }, [{ id: 'openai/gpt-4.1', capabilities: ['tool-calling'], supported_input_modalities: ['text', 'image'], limits: { max_input_tokens: 1048576 } }]);
    assert.deepEqual(gh[0], { id: 'openai/gpt-4.1', context: 1048576, tools: true, vision: true });
});

test('resolveProviders: env keys, ${ENV} URLs, custom providers, overrides', () => {
    const env = { GROQ_API_KEY: 'g', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acc', OLLAMA_HOST: '0.0.0.0:11434' };
    const ps = resolveProviders([{ id: 'mybox', baseURL: 'http://gpu:8000/v1' }, { id: 'mistral', enabled: false }], env);
    const by = Object.fromEntries(ps.map(p => [p.id, p]));
    assert.equal(by.groq.ready, true);
    assert.equal(by.gemini.ready, false);
    assert.equal(by.cloudflare.baseURL, 'https://api.cloudflare.com/client/v4/accounts/acc/ai/v1');
    assert.equal(by.ollama.baseURL, 'http://127.0.0.1:11434/v1');
    assert.equal(by.mybox.ready, true);
    assert.equal(by.mybox.free, true);
    assert.equal(by.mistral, undefined);
    assert.equal(resolveProviders([], {}, { builtins: false }).length, 0);
});

test('normalizePath', () => {
    assert.equal(normalizePath('/chat/completions'), '/v1/chat/completions');
    assert.equal(normalizePath('/v1/v1/chat/completions/'), '/v1/chat/completions');
    assert.equal(normalizePath('/messages'), '/v1/messages');
    assert.equal(normalizePath('/v1/models/groq/llama'), '/v1/models/groq/llama');
});

test('anthropicToOpenAI: images, server tools dropped, tool_choice mapping', () => {
    const out = anthropicToOpenAI({
        model: 'claude', max_tokens: 10, stop_sequences: ['END'],
        tools: [{ name: 'f', input_schema: { type: 'object' } }, { type: 'web_search_20250305', name: 'web_search' }],
        tool_choice: { type: 'any', disable_parallel_tool_use: true },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }],
    });
    assert.equal(out.tools.length, 1);
    assert.equal(out.tool_choice, 'required');
    assert.equal(out.parallel_tool_calls, false);
    assert.deepEqual(out.stop, ['END']);
    assert.equal(out.messages[0].content[1].image_url.url, 'data:image/png;base64,AAAA');
});
