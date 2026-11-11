/**
 * Test helpers: fake OpenAI-compatible providers and a router server on a random port.
 */
import http from 'node:http';
import { Router, createHandler, serve } from '../src/index.js';

/**
 * Start a fake provider. `mode` decides how /chat/completions answers:
 *   'ok' (default) | 'ratelimit' | 'error500' | 'badrequest'
 * Every request body is recorded in `calls`.
 */
export async function fakeProvider({ name, models, mode = 'ok' }) {
    const calls = [];
    const server = http.createServer(async (req, res) => {
        let raw = '';
        for await (const c of req) raw += c;
        if (req.method === 'GET' && req.url === '/v1/models') {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ object: 'list', data: models.map(id => ({ id, object: 'model' })) }));
        }
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
            const body = JSON.parse(raw || '{}');
            calls.push(body);
            const m = server.mode;
            if (m === 'ratelimit') {
                res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '30' });
                return res.end(JSON.stringify({ error: { message: 'Rate limit reached for requests', type: 'rate_limit' } }));
            }
            if (m === 'error500') {
                res.writeHead(500, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ error: { message: 'internal error' } }));
            }
            if (m === 'badrequest') {
                res.writeHead(400, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ error: { message: 'messages[0].role is invalid' } }));
            }
            const wantsTool = Array.isArray(body.tools) && body.tools.length && !body.messages.some(x => x.role === 'tool');
            const text = `Hello from ${name}`;
            if (body.stream) {
                res.writeHead(200, { 'content-type': 'text/event-stream' });
                const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
                const base = { id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 1, model: body.model };
                send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
                if (wantsTool) {
                    // like some providers: no index on the tool call, arguments split in two
                    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":' } }] }, finish_reason: null }] });
                    send({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }] }, finish_reason: null }] });
                    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
                } else {
                    for (const piece of ['Hello', ' from ', name]) send({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
                    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
                }
                send({ ...base, choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
                res.write('data: [DONE]\n\n');
                return res.end();
            }
            const message = wantsTool
                // like some providers: object arguments, no id/type, finish_reason "stop"
                ? { role: 'assistant', content: null, tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }] }
                : { role: 'assistant', content: text };
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({
                id: 'chatcmpl-y', object: 'chat.completion', created: 1, model: body.model,
                choices: [{ index: 0, message, finish_reason: 'stop' }],
                usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }));
        }
        res.writeHead(404);
        res.end();
    });
    server.mode = mode;
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    return { server, url, calls, setMode: (m) => { server.mode = m; }, close: () => new Promise(r => server.close(r)) };
}

/** Start a router (builtins off, only the given providers) behind a real HTTP server. */
export async function startRouter(providers, options = {}, handlerOptions = {}) {
    const router = new Router({ builtins: false, env: {}, providers, ...options });
    await router.refresh();
    const server = await serve(createHandler(router, handlerOptions), { port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${server.address().port}`;
    return { router, server, base, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

export async function postJSON(url, body, headers = {}) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* streaming or text */ }
    return { res, text, json };
}

/** Parse an SSE body into [{event, data}] with data JSON-parsed when possible. */
export function parseSSEText(text) {
    return text.split('\n\n').filter(Boolean).map(block => {
        let event = null, data = '';
        for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
        }
        let parsed = data;
        try { parsed = JSON.parse(data); } catch { /* [DONE] */ }
        return { event, data: parsed };
    });
}
