/**
 * HTTP layer: one fetch-style handler (Request -> Response) plus a tiny Node
 * adapter. Endpoints:
 *
 *   POST /v1/chat/completions        OpenAI-compatible (stream + non-stream, tools)
 *   GET  /v1/models                  virtual models (auto, fast, best, local) + every real model
 *   POST /v1/messages                Anthropic-compatible (Claude Code, Anthropic SDKs)
 *   POST /v1/messages/count_tokens   Anthropic token count (approximate)
 *   GET  /v1/router                  provider status + recent routing decisions
 *   GET  /health
 *
 * Paths are forgiving: "/chat/completions" and "/v1/v1/chat/completions" work too.
 */

import http from 'node:http';
import { anthropicToOpenAI, openAIToAnthropic, openAIStreamToAnthropic, countTokens, anthropicError } from './anthropic.js';
import { sseData, streamResponse } from './sse.js';
import { jsonResponse, openaiError, RouterError, globMatch, VERSION } from './util.js';

export const DEFAULT_CORS = [
    'http://localhost', 'http://localhost:*', 'https://localhost:*',
    'http://127.0.0.1', 'http://127.0.0.1:*', 'https://sugeerth.github.io',
];

const EXPOSE = 'x-llm-router-model, x-llm-router-provider, x-llm-router-strategy, x-llm-router-attempts, x-llm-router-reason, x-llm-router-substituted';

export function normalizePath(p) {
    let path = (p || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    path = path.replace(/^(\/v1)+(?=\/|$)/, '/v1');
    if (/^\/(chat\/completions|models(\/.*)?|messages(\/count_tokens)?)$/.test(path)) path = '/v1' + path;
    return path;
}

function routeHeaders(route) {
    const h = {
        'x-llm-router-model': route.model,
        'x-llm-router-provider': route.provider,
        'x-llm-router-strategy': route.strategy,
        'x-llm-router-attempts': String(route.attempts),
    };
    if (route.reason) h['x-llm-router-reason'] = route.reason;
    if (route.requested) h['x-llm-router-substituted'] = route.requested;
    return h;
}

async function readJSON(request) {
    const text = await request.text();
    try { return JSON.parse(text || '{}'); }
    catch { throw new RouterError('Request body must be valid JSON.', { status: 400, type: 'invalid_request_error' }); }
}

function withHeaders(response, extra) {
    if (!extra || !Object.keys(extra).length) return response;
    try {
        for (const [k, v] of Object.entries(extra)) response.headers.set(k, v);
        return response;
    } catch {
        const headers = new Headers(response.headers);
        for (const [k, v] of Object.entries(extra)) headers.set(k, v);
        return new Response(response.body, { status: response.status, headers });
    }
}

function errorToResponse(err, anthropic) {
    const status = err.status || 500;
    const message = err.message || String(err);
    const res = anthropic ? anthropicError(status, message)
        : jsonResponse({ error: { message, type: err.type || 'router_error', param: null, code: err.code || null, attempts: err.attempts || undefined } }, status);
    if (status === 429) res.headers.set('retry-after', '5');
    return res;
}

function authorized(request, key) {
    const h = request.headers;
    const bearer = (h.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    return bearer === key || h.get('x-api-key') === key || h.get('api-key') === key;
}

function corsHeadersFor(origin, allowed) {
    if (!allowed.some(a => a === '*' || globMatch(a, origin))) return null;
    return {
        'access-control-allow-origin': allowed.includes('*') ? '*' : origin,
        'access-control-expose-headers': EXPOSE,
        vary: 'origin',
    };
}

/** Public status (never includes keys). */
export function routerStatus(router) {
    return {
        name: 'llm-router',
        version: VERSION,
        allowPaid: !!router.options.allowPaid,
        models: router.candidates.length,
        providers: router.providers.map(p => ({
            id: p.id, name: p.name, local: !!p.local, free: !!p.free,
            state: router.status[p.id]?.state || 'unknown',
            models: router.status[p.id]?.models || 0,
            ...(router.status[p.id]?.error ? { error: router.status[p.id].error } : {}),
            ...(p.signup ? { signup: p.signup } : {}),
            ...(p.keyEnv ? { keyEnv: [].concat(p.keyEnv)[0] } : {}),
        })),
        recent: router.log.slice(0, 20),
    };
}

/**
 * Create the request handler. Works anywhere with web-standard Request/Response
 * (Node >= 18 via serve(), Bun.serve, Deno.serve, ...).
 *   apiKey  require clients to send this key (Authorization: Bearer / x-api-key)
 *   cors    allowed browser origins (globs). Requests from other origins are refused.
 */
export function createHandler(router, { apiKey = null, cors = DEFAULT_CORS } = {}) {
    async function chat(request) {
        const body = await readJSON(request);
        if (!Array.isArray(body.messages)) throw new RouterError('"messages" must be an array.', { status: 400, type: 'invalid_request_error' });
        if (body.stream) {
            const { chunks, route } = await router.stream(body, { signal: request.signal });
            const wantUsage = !!body.stream_options?.include_usage;
            async function* events() {
                try {
                    for await (const c of chunks) {
                        if (!wantUsage && c.usage && !(c.choices || []).length) continue;
                        yield sseData(c);
                    }
                } catch (err) {
                    yield sseData({ error: { message: String(err.message || err), type: 'upstream_error' } });
                }
                yield sseData('[DONE]');
            }
            return streamResponse(events(), routeHeaders(route));
        }
        const { json, route } = await router.complete(body, { signal: request.signal });
        return jsonResponse(json, 200, routeHeaders(route));
    }

    async function messages(request) {
        const abody = await readJSON(request);
        if (!Array.isArray(abody.messages)) throw new RouterError('"messages" must be an array.', { status: 400, type: 'invalid_request_error' });
        const body = anthropicToOpenAI(abody);
        if (body.stream) {
            const { chunks, route } = await router.stream(body, { signal: request.signal });
            const events = openAIStreamToAnthropic(chunks, { model: route.model, inputTokens: countTokens(abody).input_tokens });
            return streamResponse(events, routeHeaders(route));
        }
        const { json, route } = await router.complete(body, { signal: request.signal });
        return jsonResponse(openAIToAnthropic(json, route.model), 200, routeHeaders(route));
    }

    async function dispatch(request, path) {
        const m = request.method;
        if (m === 'GET' && path === '/') {
            const origin = new URL(request.url).origin;
            return jsonResponse({
                name: 'llm-router', version: VERSION, ok: true, models: router.candidates.length,
                openai_base_url: `${origin}/v1`, anthropic_base_url: origin,
                try: `curl ${origin}/v1/chat/completions -H "content-type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'`,
                docs: 'https://github.com/sugeerth/llm-router',
            });
        }
        if (m === 'GET' && path === '/health') return jsonResponse({ ok: true, models: router.candidates.length });
        if (m === 'GET' && path === '/v1/models') return jsonResponse({ object: 'list', data: router.listModels() });
        if (m === 'GET' && path.startsWith('/v1/models/')) {
            const id = decodeURIComponent(path.slice('/v1/models/'.length)).toLowerCase();
            const found = router.listModels().find(x => x.id.toLowerCase() === id);
            return found ? jsonResponse(found) : openaiError(404, `Model "${id}" not found. GET /v1/models lists them.`, 'invalid_request_error', 'model_not_found');
        }
        if (m === 'GET' && path === '/v1/router') return jsonResponse(routerStatus(router));
        if (m === 'POST' && path === '/v1/chat/completions') return chat(request);
        if (m === 'POST' && path === '/v1/messages') return messages(request);
        if (m === 'POST' && path === '/v1/messages/count_tokens') return jsonResponse(countTokens(await readJSON(request)));
        return openaiError(404, `Unknown endpoint ${m} ${path}. Try POST /v1/chat/completions, POST /v1/messages or GET /v1/models.`, 'invalid_request_error', 'not_found');
    }

    return async function handle(request) {
        const path = normalizePath(new URL(request.url).pathname);
        const anthropic = path.startsWith('/v1/messages');
        const origin = request.headers.get('origin');
        const corsHeaders = origin ? corsHeadersFor(origin, cors) : {};
        if (origin && !corsHeaders) {
            return openaiError(403, `Browser origin ${origin} is not allowed. Restart with --cors "${origin}" (or "*") to allow it.`, 'permission_error');
        }
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    ...corsHeaders,
                    'access-control-allow-methods': 'GET, POST, OPTIONS',
                    'access-control-allow-headers': request.headers.get('access-control-request-headers') || '*',
                    'access-control-allow-private-network': 'true',
                    'access-control-max-age': '86400',
                },
            });
        }
        let response;
        try {
            if (apiKey && path !== '/' && path !== '/health' && !authorized(request, apiKey)) {
                response = anthropic ? anthropicError(401, 'Invalid API key for this llm-router.')
                    : openaiError(401, 'Invalid API key for this llm-router (it was started with an API key).', 'authentication_error');
            } else {
                response = await dispatch(request, path);
            }
        } catch (err) {
            response = errorToResponse(err, anthropic);
        }
        return withHeaders(response, corsHeaders);
    };
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer', 'host', 'content-length', 'expect']);

/** Serve a fetch-style handler with Node's http module. Resolves once listening. */
export function serve(handler, { port = 4000, host = '127.0.0.1' } = {}) {
    const server = http.createServer(async (req, res) => {
        const ctl = new AbortController();
        let reader = null;
        res.on('close', () => {
            if (!res.writableFinished) {
                ctl.abort(new Error('client disconnected'));
                reader?.cancel().catch(() => {});
            }
        });
        try {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
                if (v == null || HOP_BY_HOP.has(k)) continue;
                headers.set(k, Array.isArray(v) ? v.join(', ') : v);
            }
            const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
            const request = new Request(`http://${req.headers.host || `${host}:${port}`}${req.url}`, {
                method: req.method,
                headers,
                body: hasBody ? Buffer.concat(chunks) : undefined,
                signal: ctl.signal,
            });
            const response = await handler(request);
            const out = {};
            response.headers.forEach((v, k) => { out[k] = v; });
            res.writeHead(response.status, out);
            if (!response.body || req.method === 'HEAD') return res.end();
            reader = response.body.getReader();
            while (true) {
                const { value, done } = await reader.read();
                if (done || res.destroyed) break;
                if (!res.write(value)) await new Promise(r => { res.once('drain', r); res.once('close', r); });
            }
            res.end();
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: { message: String(err.message || err), type: 'router_error' } }));
            } else {
                res.end();
            }
        }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server); });
    });
}
