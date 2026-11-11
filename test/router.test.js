import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeProvider, startRouter, postJSON, parseSSEText } from './helpers.js';

// Two fake free providers: "big" serves a strong 70B model, "small" an 8B one.
let big, small, r;
const hello = { model: 'auto', messages: [{ role: 'user', content: 'Explain the trade-offs of microservices vs a monolith in detail.' }] };
const weatherTool = [{ type: 'function', function: { name: 'get_weather', description: 'Weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }];

before(async () => {
    big = await fakeProvider({ name: 'big', models: ['llama-3.3-70b-versatile'] });
    small = await fakeProvider({ name: 'small', models: ['llama-3.1-8b-instant'] });
    r = await startRouter([
        { id: 'big', name: 'Big', baseURL: big.url, free: true, speed: { latencyMs: 300, tps: 300 } },
        { id: 'small', name: 'Small', baseURL: small.url, free: true, speed: { latencyMs: 300, tps: 300 } },
    ]);
});
after(async () => { await r.close(); await big.close(); await small.close(); });
beforeEach(() => {
    big.setMode('ok'); small.setMode('ok');
    big.calls.length = 0; small.calls.length = 0;
    r.router.health.models.clear(); r.router.health.providers.clear();
});

test('GET /v1/models lists virtual and real models', async () => {
    const res = await fetch(`${r.base}/v1/models`);
    const { data } = await res.json();
    const ids = data.map(m => m.id);
    for (const id of ['auto', 'fast', 'best', 'local', 'big/llama-3.3-70b-versatile', 'small/llama-3.1-8b-instant']) assert.ok(ids.includes(id), id);
});

test('auto: complex question goes to the stronger model, response looks like OpenAI', async () => {
    const { res, json } = await postJSON(`${r.base}/v1/chat/completions`, hello);
    assert.equal(res.status, 200);
    assert.equal(json.object, 'chat.completion');
    assert.equal(json.model, 'big/llama-3.3-70b-versatile');
    assert.equal(json.choices[0].message.content, 'Hello from big');
    assert.equal(res.headers.get('x-llm-router-provider'), 'big');
    assert.equal(big.calls[0].model, 'llama-3.3-70b-versatile', 'upstream gets its own model id');
});

test('auto: trivial question goes to the small model', async () => {
    const { json } = await postJSON(`${r.base}/v1/chat/completions`, { model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(json.model, 'small/llama-3.1-8b-instant');
});

test('failover: 429 on the first choice falls through to the next provider, then cooldown skips it', async () => {
    big.setMode('ratelimit');
    const first = await postJSON(`${r.base}/v1/chat/completions`, hello);
    assert.equal(first.res.status, 200);
    assert.equal(first.json.model, 'small/llama-3.1-8b-instant');
    assert.equal(first.res.headers.get('x-llm-router-attempts'), '2');
    const second = await postJSON(`${r.base}/v1/chat/completions`, hello);
    assert.equal(second.res.headers.get('x-llm-router-attempts'), '1', 'rate-limited model is cooling down');
    assert.equal(big.calls.length, 1);
});

test('failover also works for streaming (before the first byte)', async () => {
    big.setMode('error500');
    const { res, text } = await postJSON(`${r.base}/v1/chat/completions`, { ...hello, stream: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const events = parseSSEText(text);
    assert.equal(events.at(-1).data, '[DONE]');
    const content = events.map(e => e.data?.choices?.[0]?.delta?.content || '').join('');
    assert.equal(content, 'Hello from small');
    assert.ok(events.filter(e => e.data?.model).every(e => e.data.model === 'small/llama-3.1-8b-instant'));
    assert.ok(!events.some(e => e.data?.usage), 'usage-only chunk hidden unless include_usage');
});

test('all candidates rate-limited -> 429 with retry-after and the attempt list', async () => {
    big.setMode('ratelimit'); small.setMode('ratelimit');
    const { res, json } = await postJSON(`${r.base}/v1/chat/completions`, hello);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '5');
    assert.equal(json.error.type, 'rate_limit_error');
    assert.equal(json.error.attempts.length, 2);
});

test('plain bad requests are returned as-is, not retried elsewhere', async () => {
    big.setMode('badrequest');
    const { res, json } = await postJSON(`${r.base}/v1/chat/completions`, hello);
    assert.equal(res.status, 400);
    assert.match(json.error.message, /role is invalid/);
    assert.equal(small.calls.length, 0);
});

test('explicit provider/model is honored; bare model id matches across providers', async () => {
    const a = await postJSON(`${r.base}/v1/chat/completions`, { ...hello, model: 'small/llama-3.1-8b-instant' });
    assert.equal(a.json.model, 'small/llama-3.1-8b-instant');
    const b = await postJSON(`${r.base}/v1/chat/completions`, { ...hello, model: 'llama-3.3-70b' });
    assert.equal(b.json.model, 'big/llama-3.3-70b-versatile');
});

test('unknown hardcoded model names still work (routed by intent)', async () => {
    const { res, json } = await postJSON(`${r.base}/v1/chat/completions`, { ...hello, model: 'gpt-4o-mini' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-llm-router-substituted'), 'gpt-4o-mini');
    assert.equal(res.headers.get('x-llm-router-strategy'), 'fast');
    assert.ok(json.model);
});

test('compatibility fixes are applied to the upstream request', async () => {
    await postJSON(`${r.base}/v1/chat/completions`, {
        model: 'big/llama-3.3-70b-versatile',
        max_completion_tokens: 50,
        messages: [{ role: 'developer', content: 'Be brief.' }, { role: 'user', content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there' }] }],
    });
    const sent = big.calls[0];
    assert.equal(sent.max_tokens, 50);
    assert.equal(sent.max_completion_tokens, undefined);
    assert.equal(sent.messages[0].role, 'system');
    assert.equal(sent.messages[1].content, 'Hi there');
});

test('tool calls are normalized (ids, string arguments, finish_reason)', async () => {
    const { json } = await postJSON(`${r.base}/v1/chat/completions`, { ...hello, tools: weatherTool });
    const ch = json.choices[0];
    assert.equal(ch.finish_reason, 'tool_calls');
    const tc = ch.message.tool_calls[0];
    assert.ok(tc.id);
    assert.equal(tc.type, 'function');
    assert.equal(tc.function.name, 'get_weather');
    assert.deepEqual(JSON.parse(tc.function.arguments), { city: 'Paris' });
});

test('streamed tool calls get an index and id on every new call', async () => {
    const { text } = await postJSON(`${r.base}/v1/chat/completions`, { ...hello, tools: weatherTool, stream: true });
    const deltas = parseSSEText(text).flatMap(e => e.data?.choices?.[0]?.delta?.tool_calls || []);
    assert.ok(deltas.every(d => d.index === 0));
    assert.equal(deltas[0].id, 'call_1');
    assert.equal(deltas.map(d => d.function?.arguments || '').join(''), '{"city":"Paris"}');
});

test('Anthropic /v1/messages: text answer', async () => {
    const { res, json } = await postJSON(`${r.base}/v1/messages`, {
        model: 'claude-sonnet-4-5', max_tokens: 100,
        system: [{ type: 'text', text: 'You are terse.' }],
        messages: [{ role: 'user', content: 'Explain the trade-offs of microservices vs a monolith in detail.' }],
    }, { 'anthropic-version': '2023-06-01', 'x-api-key': 'anything' });
    assert.equal(res.status, 200);
    assert.equal(json.type, 'message');
    assert.equal(json.role, 'assistant');
    assert.equal(json.content[0].type, 'text');
    assert.equal(json.content[0].text, 'Hello from big');
    assert.equal(json.stop_reason, 'end_turn');
    assert.equal(json.usage.input_tokens, 5);
    assert.equal(big.calls[0].messages[0].role, 'system');
});

test('Anthropic tools: tool_use out, tool_result back in', async () => {
    const tools = [{ name: 'get_weather', description: 'Weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }];
    const first = await postJSON(`${r.base}/v1/messages`, {
        model: 'claude-sonnet-4-5', max_tokens: 100, tools,
        messages: [{ role: 'user', content: 'Weather in Paris? Explain the trade-offs in detail.' }],
    });
    assert.equal(first.json.stop_reason, 'tool_use');
    const use = first.json.content.find(b => b.type === 'tool_use');
    assert.deepEqual(use.input, { city: 'Paris' });

    const second = await postJSON(`${r.base}/v1/messages`, {
        model: 'claude-sonnet-4-5', max_tokens: 100, tools,
        messages: [
            { role: 'user', content: 'Weather in Paris? Explain the trade-offs in detail.' },
            { role: 'assistant', content: first.json.content },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: use.id, content: '18C, sunny' }, { type: 'text', text: 'Thanks' }] },
        ],
    });
    assert.equal(second.res.status, 200);
    const sent = (big.calls.at(-1) || small.calls.at(-1)).messages;
    const toolMsg = sent.find(m => m.role === 'tool');
    assert.equal(toolMsg.tool_call_id, use.id);
    assert.equal(toolMsg.content, '18C, sunny');
    assert.equal(sent.at(-1).content, 'Thanks');
    assert.ok(sent.find(m => m.role === 'assistant').tool_calls[0].function.arguments.includes('Paris'));
});

test('Anthropic streaming emits the standard event sequence', async () => {
    const { res, text } = await postJSON(`${r.base}/v1/messages`, {
        model: 'claude-haiku-4-5', max_tokens: 100, stream: true,
        messages: [{ role: 'user', content: 'Explain the trade-offs of microservices vs a monolith in detail.' }],
    });
    assert.equal(res.status, 200);
    const events = parseSSEText(text);
    const names = events.map(e => e.event);
    assert.deepEqual([names[0], names[1], names.at(-3), names.at(-2), names.at(-1)],
        ['message_start', 'content_block_start', 'content_block_stop', 'message_delta', 'message_stop']);
    const text2 = events.filter(e => e.event === 'content_block_delta').map(e => e.data.delta.text).join('');
    assert.ok(text2.startsWith('Hello from'));
    assert.equal(events.find(e => e.event === 'message_delta').data.delta.stop_reason, 'end_turn');
});

test('Anthropic streaming tool use emits input_json_delta', async () => {
    const tools = [{ name: 'get_weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }];
    const { text } = await postJSON(`${r.base}/v1/messages`, {
        model: 'claude-sonnet-4-5', max_tokens: 100, stream: true, tools,
        messages: [{ role: 'user', content: 'Weather in Paris? Explain the trade-offs in detail.' }],
    });
    const events = parseSSEText(text);
    const start = events.find(e => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use');
    assert.equal(start.data.content_block.name, 'get_weather');
    const json = events.filter(e => e.data?.delta?.type === 'input_json_delta').map(e => e.data.delta.partial_json).join('');
    assert.deepEqual(JSON.parse(json), { city: 'Paris' });
    assert.equal(events.find(e => e.event === 'message_delta').data.delta.stop_reason, 'tool_use');
});

test('count_tokens and forgiving paths', async () => {
    const ct = await postJSON(`${r.base}/v1/messages/count_tokens`, { model: 'x', messages: [{ role: 'user', content: 'hello world' }] });
    assert.ok(ct.json.input_tokens > 0);
    for (const p of ['/chat/completions', '/v1/v1/chat/completions', '/v1/chat/completions/']) {
        const { res } = await postJSON(`${r.base}${p}`, hello);
        assert.equal(res.status, 200, p);
    }
    const m = await fetch(`${r.base}/models`);
    assert.equal(m.status, 200);
});

test('CORS: localhost allowed, unknown origins refused, preflight answered', async () => {
    const ok = await postJSON(`${r.base}/v1/chat/completions`, hello, { origin: 'http://localhost:3000' });
    assert.equal(ok.res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const bad = await postJSON(`${r.base}/v1/chat/completions`, hello, { origin: 'https://evil.example' });
    assert.equal(bad.res.status, 403);
    const pre = await fetch(`${r.base}/v1/chat/completions`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
});

test('chat app is served to browsers at /, and its same-origin calls are allowed', async () => {
    const page = await fetch(`${r.base}/`, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /one free endpoint for every LLM/);
    const json = await fetch(`${r.base}/`);
    assert.equal((await json.json()).name, 'llm-router');
    const same = await postJSON(`${r.base}/v1/chat/completions`, hello, { origin: r.base });
    assert.equal(same.res.status, 200);
});

test('DNS-rebinding style origins are refused even if they look same-origin', async () => {
    const { createHandler } = await import('../src/server.js');
    const handle = createHandler(r.router);
    const res = await handle(new Request('http://evil.example:4000/v1/chat/completions', {
        method: 'POST', headers: { origin: 'http://evil.example:4000', 'content-type': 'application/json' }, body: JSON.stringify(hello),
    }));
    assert.equal(res.status, 403);
});

test('optional API key protects the server', async () => {
    const locked = await startRouter([{ id: 'small', baseURL: small.url, free: true }], {}, { apiKey: 'secret' });
    try {
        const no = await postJSON(`${locked.base}/v1/chat/completions`, hello);
        assert.equal(no.res.status, 401);
        const yes = await postJSON(`${locked.base}/v1/chat/completions`, hello, { authorization: 'Bearer secret' });
        assert.equal(yes.res.status, 200);
        const anth = await postJSON(`${locked.base}/v1/messages`, { model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, { 'x-api-key': 'secret' });
        assert.equal(anth.res.status, 200);
        assert.equal((await fetch(`${locked.base}/health`)).status, 200);
    } finally {
        await locked.close();
    }
});

test('no models -> helpful 503', async () => {
    const empty = await startRouter([]);
    try {
        const { res, json } = await postJSON(`${empty.base}/v1/chat/completions`, hello);
        assert.equal(res.status, 503);
        assert.match(json.error.message, /GROQ_API_KEY/);
    } finally {
        await empty.close();
    }
});
