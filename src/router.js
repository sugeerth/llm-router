/**
 * The router: discovers models, picks the best ones for a request, and calls
 * them in order until one succeeds (failover on rate limits, outages, timeouts).
 *
 * Routing in one sentence: "auto" picks the FASTEST model whose quality clears a
 * bar that rises with the request's difficulty (need = 0.68 + 0.27 x complexity).
 * Task type + complexity come from the same analyzer the browser playground uses
 * (js/analyzer.js).
 */

import { QueryAnalyzer } from '../js/analyzer.js';
import { TASK_TYPES } from '../js/models.js';
import { resolveProviders, providerHeaders, parseModelList } from './providers.js';
import { toCandidate, familyKey } from './profiles.js';
import { parseOpenAIStream } from './sse.js';
import {
    RouterError, estimateTokens, requestText, lastUserText, contentText, hasImages,
    randomId, nowSec, linkedAbort, cleanObject,
} from './util.js';

/** Virtual model names -> scoring preset. "auto" is the default. */
export const STRATEGIES = {
    auto: { about: 'fastest model that is good enough for the request (default)' },
    fast: { about: 'fastest model available' },
    best: { about: 'strongest model available' },
    local: { localOnly: true, about: 'like auto, but only local models (private)' },
};

/** Tasks that are real work: never routed below a mid-size model. */
const WORK_TASKS = new Set([TASK_TYPES.CODE_GENERATION, TASK_TYPES.CODE_DEBUG, TASK_TYPES.MATH_REASONING, TASK_TYPES.SYSTEM_DESIGN, TASK_TYPES.ANALYSIS]);
const STRATEGY_ALIASES = { router: 'auto', default: 'auto', balanced: 'auto', speed: 'fast', quality: 'best', smart: 'best', private: 'local' };

const DEFAULTS = {
    allowPaid: false,
    maxAttempts: 4,
    timeoutMs: 120000,          // whole non-streaming call
    firstTokenTimeoutMs: 60000, // streaming: until the first chunk (local gets 3x for model load)
    refreshMs: 10 * 60 * 1000,
};

/** Tracks cooldowns + observed latency per model, and auth failures per provider. */
class Health {
    constructor() { this.models = new Map(); this.providers = new Map(); }
    _m(id) {
        if (!this.models.has(id)) this.models.set(id, { until: 0, fails: 0, lastFail: 0, latency: null });
        return this.models.get(id);
    }
    cooling(c) {
        const now = Date.now();
        return (this.models.get(c.id)?.until || 0) > now || (this.providers.get(c.provider) || 0) > now;
    }
    retryIn(c) {
        const t = Math.max(this.models.get(c.id)?.until || 0, this.providers.get(c.provider) || 0) - Date.now();
        return Math.max(0, Math.ceil(t / 1000));
    }
    recentlyFailed(c) { return Date.now() - (this.models.get(c.id)?.lastFail || 0) < 5 * 60 * 1000; }
    ok(c, ms) {
        const s = this._m(c.id);
        s.fails = 0;
        s.latency = s.latency == null ? ms : 0.7 * s.latency + 0.3 * ms;
    }
    fail(c, status, headers, text = '') {
        const s = this._m(c.id);
        s.fails += 1;
        s.lastFail = Date.now();
        let secs = 0;
        if (status === 429) secs = retryAfterSecs(headers) ?? (/(per.?day|daily|rpd|quota)/i.test(text) ? 3600 : 60);
        else if (status === 401 || status === 403) { this.providers.set(c.provider, Date.now() + 10 * 60 * 1000); return; }
        else if (status === 404) secs = 3600;
        else if (status === 0 || status >= 500 || status === 408) secs = Math.min(300, 15 * 2 ** Math.min(s.fails - 1, 4));
        if (secs) s.until = Date.now() + secs * 1000;
    }
}

/** Seconds from Retry-After or Groq/OpenAI-style "x-ratelimit-reset-*: 2m59.5s". */
export function retryAfterSecs(headers) {
    if (!headers) return null;
    const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]);
    const ra = get('retry-after');
    if (ra) {
        const n = Number(ra);
        if (Number.isFinite(n)) return Math.max(1, Math.ceil(n));
        const d = Date.parse(ra);
        if (Number.isFinite(d)) return Math.max(1, Math.ceil((d - Date.now()) / 1000));
    }
    for (const k of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset']) {
        const v = get(k);
        if (!v) continue;
        const m = String(v).match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?$/);
        if (m && m[0]) return Math.max(1, Math.ceil((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 1000));
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(1, Math.ceil(n > 1e9 ? n - Date.now() / 1000 : n));
    }
    return null;
}

/** Errors worth trying another model for. A plain bad request is returned as-is. */
function retryable(status, text = '') {
    if (status === 0 || status === 408 || status === 409 || status === 429 || status >= 500) return true;
    if (status === 401 || status === 403 || status === 404) return true;   // this provider/model is unusable
    if (status === 400 || status === 413 || status === 422) {
        return /(model|tool|function|context|too long|token|maximum|not support|unsupported|image|vision|length|capab)/i.test(text);
    }
    return false;
}

/** Guess a strategy for an unknown model name a client hardcoded ("gpt-4o-mini", "claude-opus-4"). */
function guessStrategy(name) {
    if (/(mini|nano|flash|haiku|small|lite|instant|fast|turbo|3\.5|8b)/.test(name)) return 'fast';
    if (/(opus|\bpro\b|-pro|o1|o3|reason|think|ultra|large|405b)/.test(name)) return 'best';
    return 'auto';
}

export class Router {
    constructor(options = {}) {
        this.options = { ...DEFAULTS, ...cleanObject(options) };   // undefined never overrides a default
        this.env = options.env || globalThis.process?.env || {};
        this.aliases = options.aliases || {};
        this.profiles = options.profiles || {};
        this.providers = resolveProviders(options.providers || [], this.env, { builtins: options.builtins !== false });
        this.analyzer = new QueryAnalyzer();
        this.health = new Health();
        this.candidates = [];     // every routable model
        this.status = {};         // provider id -> { state, models, error }
        this.log = [];            // last requests (no prompt content)
        this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
    }

    // ── Discovery ────────────────────────────────────────────────────────────

    /** (Re)discover models from every provider in parallel. Safe to call any time. */
    async refresh({ localOnly = false } = {}) {
        const jobs = this.providers
            .filter(p => (localOnly ? p.local : true))
            .map(p => this._discover(p).then(models => [p, models]));
        const results = await Promise.all(jobs);
        const keep = localOnly ? this.candidates.filter(c => !c.local) : [];
        const next = [...keep];
        for (const [p, models] of results) {
            for (const m of models) {
                const meta = { ...m, ...(this.profiles[`${p.id}/${m.id}`] || this.profiles[m.id] || {}) };
                const cand = toCandidate(p, m.id, meta);
                if (!cand.free && !this.options.allowPaid) continue;
                next.push(cand);
            }
        }
        this.candidates = next;
        this.byId = new Map(next.map(c => [c.id.toLowerCase(), c]));
        return this.candidates;
    }

    async _discover(p) {
        if (!p.ready) {
            this.status[p.id] = { state: p.local ? 'offline' : 'no-key', models: 0 };
            return [];
        }
        if (!p.free && !this.options.allowPaid) {
            this.status[p.id] = { state: 'paid-off', models: 0 };
            return [];
        }
        const fallback = (p.models || []).map(id => ({ id }));
        if (p.discover === false && !p.local) {
            this.status[p.id] = { state: 'ready', models: fallback.length };
            return fallback;
        }
        const url = p.modelsURL || `${p.baseURL}/models`;
        const t = linkedAbort([], p.local ? 1500 : 8000);
        try {
            const res = await this.fetch(url, { headers: providerHeaders(p), signal: t.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const models = parseModelList(p, await res.json(), { allowPaid: this.options.allowPaid });
            if (!models.length && !p.local) throw new Error('no chat models listed');
            this.status[p.id] = { state: models.length ? 'ready' : 'offline', models: models.length };
            return models;
        } catch (err) {
            if (p.local) {
                this.status[p.id] = { state: 'offline', models: 0 };
                return [];
            }
            // Cloud listing failed: fall back to the curated list and let failover sort it out.
            this.status[p.id] = { state: fallback.length ? 'ready' : 'error', models: fallback.length, error: String(err.message || err) };
            return fallback;
        } finally {
            t.clear();
        }
    }

    /** Re-probe local servers every 30s and everything else every refreshMs. */
    startAutoRefresh() {
        const a = setInterval(() => this.refresh({ localOnly: true }).catch(() => {}), 30000);
        const b = setInterval(() => this.refresh().catch(() => {}), this.options.refreshMs);
        a.unref?.(); b.unref?.();
        return () => { clearInterval(a); clearInterval(b); };
    }

    /** Model list for /v1/models: virtual strategies first, then every real model. */
    listModels() {
        const created = nowSec();
        const virtual = Object.entries(STRATEGIES).map(([id, s]) => ({ id, object: 'model', created, owned_by: 'llm-router', description: s.about }));
        const aliases = Object.keys(this.aliases).map(id => ({ id, object: 'model', created, owned_by: 'llm-router', description: `alias for ${this.aliases[id]}` }));
        const real = this.candidates.map(c => ({
            id: c.id, object: 'model', created, owned_by: c.provider,
            free: c.free, local: c.local, context_window: c.contextWindow,
            tools: c.tools, vision: c.vision,
        }));
        return [...virtual, ...aliases, ...real];
    }

    // ── Routing ──────────────────────────────────────────────────────────────

    /** Resolve a requested model name into a strategy or explicit candidates. */
    resolve(name) {
        let n = String(name ?? '').trim() || 'auto';
        for (let i = 0; i < 3 && this.aliases[n]; i++) n = String(this.aliases[n]);
        const lower = n.toLowerCase();
        const bare = lower.replace(/^(router|llm-router)\//, '');
        const strat = STRATEGY_ALIASES[bare] || bare;
        if (STRATEGIES[strat]) return { strategy: strat };

        const exact = this.byId?.get(lower);
        if (exact) return { strategy: 'auto', explicit: [exact] };

        // Bare model id ("llama-3.3-70b-versatile" or "llama-3.3-70b"): every provider serving it.
        const fam = familyKey(n);
        const matches = this.candidates.filter(c => c.upstreamId.toLowerCase() === lower || c.family === fam);
        if (matches.length) return { strategy: 'auto', explicit: matches };

        // Unknown name a client hardcoded: route by its spirit instead of failing.
        return { strategy: guessStrategy(lower), substituted: n };
    }

    /** Describe what the request needs (capabilities, size) and how hard it is. */
    analyze(body) {
        const messages = body.messages || [];
        const text = lastUserText(messages) || contentText(messages[messages.length - 1]?.content) || 'continue';
        const a = this.analyzer.analyze(text.slice(0, 20000)) || this.analyzer.analyze('continue');
        a.tokenEstimate = estimateTokens(requestText(body));
        const maxOut = body.max_completion_tokens ?? body.max_tokens;
        if (maxOut) a.expectedOutputLength = Math.min(Number(maxOut) || a.expectedOutputLength, 32768);
        // Real work and agent loops (tools, long threads) need stronger models than
        // the last message alone suggests.
        if (WORK_TASKS.has(a.primaryTask)) a.complexity = Math.max(a.complexity, 0.3);
        if (body.tools?.length) a.complexity = Math.max(a.complexity, 0.55);
        if (messages.length > 8) a.complexity = Math.min(1, a.complexity + 0.1);
        return {
            analysis: a,
            needs: {
                tools: !!(body.tools?.length),
                vision: hasImages(messages),
                minContext: a.tokenEstimate + Math.min(a.expectedOutputLength, 4096),
            },
        };
    }

    /** Pick and order candidates for a request. Throws RouterError(503) if none fit. */
    plan(body) {
        const target = this.resolve(body.model);
        const strategy = STRATEGIES[target.strategy];
        const { analysis, needs } = this.analyze(body);

        let pool = target.explicit || this.candidates.filter(c => !strategy.localOnly || c.local);
        if (!pool.length) {
            throw new RouterError(this.candidates.length
                ? `No ${strategy.localOnly ? 'local ' : ''}models available for "${body.model}".`
                : 'No models available yet. Start a local server (Ollama, LM Studio...) or add a free key, e.g. GROQ_API_KEY. Run `llm-router models` to check.',
                { status: 503, type: 'no_models' });
        }
        if (!target.explicit) {
            const fit = pool.filter(c => (!needs.vision || c.vision) && c.contextWindow >= needs.minContext);
            if (fit.length) pool = fit;
            else if (needs.vision) throw new RouterError('No vision-capable model is available for this image request.', { status: 400, type: 'no_capable_model' });
            if (needs.tools) {
                const yes = pool.filter(c => c.tools === true);
                const maybe = pool.filter(c => c.tools !== false);
                pool = yes.length ? yes : maybe.length ? maybe : pool;
            }
        }
        const live = pool.filter(c => !this.health.cooling(c));
        const allCooling = live.length === 0;
        if (!allCooling) pool = live;

        const { ordered, need } = this.rank(pool, analysis, target.strategy, allCooling);
        const reason = target.strategy === 'auto' || target.strategy === 'local'
            ? `${analysis.primaryTask}, complexity ${analysis.complexity.toFixed(2)}, needs quality >= ${need.toFixed(2)}`
            : `${target.strategy}: ${strategy.about}`;
        return {
            target, strategy: target.strategy, analysis, needs, need, reason,
            attempts: diversify(ordered).slice(0, Math.max(1, this.options.maxAttempts)),
            ranked: ordered,
        };
    }

    /**
     * Order a pool for a strategy.
     *   auto/local: models that clear the bar, fastest first; then the rest, strongest first
     *   fast:       fastest first        best: strongest first
     * Free models always beat paid ones; recently failing models sink.
     */
    rank(pool, analysis, strategy, allCooling = false) {
        const need = 0.68 + 0.27 * analysis.complexity;
        const q = (m) => (m.strengths?.[analysis.primaryTask] ?? m.quality) + (analysis.requiresReasoning && m.reasoning ? 0.03 : 0);
        const price = (m) => (m.pricing ? (m.pricing.input || 0) + (m.pricing.output || 0) : 5);
        const penalty = (m) => (this.health.recentlyFailed(m) ? 0.3 : 0)
            + (allCooling ? this.health.retryIn(m) / 3600 : 0)
            + (m.free ? 0 : 1 + price(m) / 100);
        const sortBy = (list, key) => [...list].sort((a, b) => key(b) - key(a));
        if (strategy === 'best') return { need, ordered: sortBy(pool, m => q(m) + 0.05 * m.speedScore - penalty(m)) };
        if (strategy === 'fast') return { need, ordered: sortBy(pool, m => m.speedScore + 0.1 * q(m) - penalty(m)) };
        const capable = pool.filter(m => q(m) >= need);
        const rest = pool.filter(m => q(m) < need);
        return {
            need,
            ordered: [
                ...sortBy(capable, m => m.speedScore + 0.3 * (q(m) - need) - penalty(m)),
                ...sortBy(rest, m => q(m) - penalty(m)),
            ],
        };
    }

    // ── Execution ────────────────────────────────────────────────────────────

    /** Build the upstream request body for one candidate (fixes common incompatibilities). */
    prepare(body, cand, stream) {
        const out = { ...body, model: cand.upstreamId, stream };
        delete out.router;
        const native = !!cand.providerRef.openaiNative;
        if (native) {
            if (out.max_tokens != null && out.max_completion_tokens == null) out.max_completion_tokens = out.max_tokens;
            delete out.max_tokens;
        } else {
            if (out.max_completion_tokens != null && out.max_tokens == null) out.max_tokens = out.max_completion_tokens;
            delete out.max_completion_tokens;
        }
        if (!stream) delete out.stream_options;
        if (out.messages) {
            out.messages = out.messages.map(m => {
                const msg = { ...m };
                if (!native && msg.role === 'developer') msg.role = 'system';
                // text-only part arrays -> plain string (some providers reject arrays)
                if (Array.isArray(msg.content) && msg.content.every(p => p && p.type === 'text')) {
                    msg.content = msg.content.map(p => p.text).join('');
                }
                return msg;
            });
        }
        for (const k of cand.providerRef.dropParams || []) delete out[k];
        return out;
    }

    async _call(cand, body, stream, signal, timeoutMs) {
        const p = cand.providerRef;
        const t = linkedAbort([signal], timeoutMs);
        try {
            const res = await this.fetch(`${p.baseURL}/chat/completions`, {
                method: 'POST',
                headers: providerHeaders(p),
                body: JSON.stringify(this.prepare(body, cand, stream)),
                signal: t.signal,
            });
            return { res, timer: t };
        } catch (err) {
            t.clear();
            throw err;
        }
    }

    _record(entry) {
        this.log.unshift({ time: new Date().toISOString(), ...entry });
        if (this.log.length > 100) this.log.length = 100;
        this.options.onLog?.(entry);
    }

    /** Non-streaming chat completion with failover. Returns { json, route }. */
    async complete(body, { signal } = {}) {
        const plan = this.plan(body);
        const tried = [];
        const t0 = Date.now();
        for (const cand of plan.attempts) {
            const started = Date.now();
            let res, timer;
            try {
                ({ res, timer } = await this._call(cand, body, false, signal, this.options.timeoutMs * (cand.local ? 2 : 1)));
                if (res.ok) {
                    const json = await res.json();
                    timer.clear();
                    if (json?.error && !json.choices) throw Object.assign(new Error(json.error.message || 'upstream error'), { status: 502 });
                    this.health.ok(cand, Date.now() - started);
                    normalizeCompletion(json, cand, body);
                    const route = this._route(plan, cand, tried, Date.now() - t0);
                    this._record({ ...route, status: 200, usage: json.usage });
                    return { json, route };
                }
                const text = await res.text().catch(() => '');
                timer.clear();
                this.health.fail(cand, res.status, res.headers, text);
                tried.push({ model: cand.id, status: res.status, error: errorMessage(text) || `HTTP ${res.status}` });
                if (!retryable(res.status, text)) throw upstreamError(res.status, text, cand, tried);
            } catch (err) {
                timer?.clear();
                if (err instanceof RouterError) throw err;
                if (signal?.aborted) throw err;
                if (!tried.some(t => t.model === cand.id)) {
                    this.health.fail(cand, err.status || 0);
                    tried.push({ model: cand.id, status: err.status || 0, error: String(err.message || err) });
                }
            }
        }
        throw this._exhausted(plan, tried, Date.now() - t0);
    }

    /**
     * Streaming chat completion with failover before the first chunk.
     * Returns { chunks: AsyncIterable<chunk>, route }.
     */
    async stream(body, { signal } = {}) {
        const plan = this.plan(body);
        const tried = [];
        const t0 = Date.now();
        for (const cand of plan.attempts) {
            const started = Date.now();
            let res, timer;
            try {
                ({ res, timer } = await this._call(cand, body, true, signal, this.options.firstTokenTimeoutMs * (cand.local ? 3 : 1)));
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    timer.clear();
                    this.health.fail(cand, res.status, res.headers, text);
                    tried.push({ model: cand.id, status: res.status, error: errorMessage(text) || `HTTP ${res.status}` });
                    if (!retryable(res.status, text)) throw upstreamError(res.status, text, cand, tried);
                    continue;
                }
                const ctype = res.headers.get('content-type') || '';
                if (ctype.includes('application/json')) {
                    // Provider ignored stream:true and answered in one piece — replay it as chunks.
                    const json = await res.json();
                    timer.clear();
                    if (json?.error && !json.choices) throw Object.assign(new Error(json.error.message || 'upstream error'), { status: 502 });
                    normalizeCompletion(json, cand, body);
                    this.health.ok(cand, Date.now() - started);
                    const route = this._route(plan, cand, tried, Date.now() - t0);
                    this._record({ ...route, status: 200, usage: json.usage, stream: true });
                    return { chunks: completionToChunks(json), route };
                }
                const it = parseOpenAIStream(res.body)[Symbol.asyncIterator]();
                const first = await it.next();
                if (first.done) throw Object.assign(new Error('empty stream'), { status: 502 });
                if (first.value.__error) {
                    const e = first.value.__error;
                    throw Object.assign(new Error(e.message || 'upstream stream error'), { status: Number(e.code) || 502 });
                }
                timer.clear();   // committed: no failover past this point
                this.health.ok(cand, Date.now() - started);
                const route = this._route(plan, cand, tried, Date.now() - t0);
                const self = this;
                async function* chunks() {
                    const state = { tools: new Map() };
                    let usage = null;
                    try {
                        let cur = first;
                        while (!cur.done) {
                            const c = cur.value;
                            if (c.__error) throw Object.assign(new Error(c.__error.message || 'upstream stream error'), { upstream: c.__error });
                            normalizeChunk(c, cand, state);
                            if (c.usage) usage = c.usage;
                            yield c;
                            cur = await it.next();
                        }
                        self._record({ ...route, status: 200, usage, stream: true });
                    } catch (err) {
                        self._record({ ...route, status: 502, error: String(err.message || err), stream: true });
                        throw err;
                    } finally {
                        try { await it.return?.(); } catch { /* ignore */ }
                    }
                }
                return { chunks: chunks(), route };
            } catch (err) {
                timer?.clear();
                if (err instanceof RouterError) throw err;
                if (signal?.aborted) throw err;
                this.health.fail(cand, err.status || 0);
                tried.push({ model: cand.id, status: err.status || 0, error: String(err.message || err) });
            }
        }
        throw this._exhausted(plan, tried, Date.now() - t0);
    }

    _route(plan, cand, tried, ms) {
        return {
            model: cand.id,
            provider: cand.provider,
            requested: plan.target.substituted || null,
            strategy: plan.strategy,
            reason: plan.reason,
            task: plan.analysis.primaryTask,
            complexity: Math.round(plan.analysis.complexity * 100) / 100,
            attempts: tried.length + 1,
            failed: tried,
            free: cand.free,
            ms,
        };
    }

    _exhausted(plan, tried, ms) {
        const all429 = tried.length && tried.every(t => t.status === 429);
        const detail = tried.map(t => `${t.model} -> ${t.status || 'network'}${t.error ? ` (${String(t.error).slice(0, 120)})` : ''}`).join('; ');
        this._record({ model: null, strategy: plan.strategy, status: all429 ? 429 : 502, failed: tried, ms });
        return new RouterError(`All ${tried.length} candidate model(s) failed. ${detail}`, {
            status: all429 ? 429 : 502,
            type: all429 ? 'rate_limit_error' : 'upstream_error',
            attempts: tried,
        });
    }
}

/**
 * Order fallbacks so consecutive attempts hit different providers first
 * (rate limits are usually per provider), then the rest by score.
 */
export function diversify(ranked) {
    const out = [], seen = new Set(), rest = [];
    for (const c of ranked) {
        if (!seen.has(c.provider)) { out.push(c); seen.add(c.provider); }
        else rest.push(c);
    }
    return [out[0], ...out.slice(1), ...rest].filter(Boolean);
}

function errorMessage(text) {
    try {
        const j = JSON.parse(text);
        return j.error?.message || j.message || j.detail || (typeof j.error === 'string' ? j.error : null);
    } catch {
        return text ? String(text).slice(0, 300) : null;
    }
}

function upstreamError(status, text, cand, tried) {
    return new RouterError(`${cand.id}: ${errorMessage(text) || `HTTP ${status}`}`, {
        status, type: status === 429 ? 'rate_limit_error' : 'invalid_request_error', attempts: tried,
    });
}

/** Make a non-streaming completion look exactly like OpenAI's, whoever produced it. */
export function normalizeCompletion(json, cand, body) {
    json.id = json.id || randomId('chatcmpl-');
    json.object = 'chat.completion';
    json.created = json.created || nowSec();
    json.model = cand.id;
    for (const [i, ch] of (json.choices || []).entries()) {
        ch.index = ch.index ?? i;
        const msg = ch.message || (ch.message = { role: 'assistant', content: '' });
        msg.role = msg.role || 'assistant';
        if (Array.isArray(msg.content)) msg.content = contentText(msg.content);
        if (msg.tool_calls?.length) {
            msg.tool_calls = msg.tool_calls.map((tc, j) => ({
                ...tc,
                id: tc.id || randomId('call_'),
                type: 'function',
                function: {
                    name: tc.function?.name,
                    arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
                },
                index: undefined,
            }));
            if (!ch.finish_reason || ch.finish_reason === 'stop') ch.finish_reason = 'tool_calls';
        } else if (msg.tool_calls && !msg.tool_calls.length) {
            delete msg.tool_calls;
        }
        ch.finish_reason = ch.finish_reason || 'stop';
    }
    if (!json.usage) {
        const out = (json.choices || []).map(c => contentText(c.message?.content)).join('');
        const pin = estimateTokens(requestText(body)), pout = estimateTokens(out);
        json.usage = { prompt_tokens: pin, completion_tokens: pout, total_tokens: pin + pout };
    }
    return json;
}

/** Make a streaming chunk look like OpenAI's (ids/indexes on tool calls, model name). */
export function normalizeChunk(c, cand, state) {
    c.object = 'chat.completion.chunk';
    c.model = cand.id;
    c.id = c.id || (state.id ||= randomId('chatcmpl-'));
    c.created = c.created || nowSec();
    for (const ch of c.choices || []) {
        const d = ch.delta;
        if (!d?.tool_calls) continue;
        d.tool_calls = d.tool_calls.map((tc, j) => {
            const index = tc.index ?? j;
            const out = { ...tc, index };
            if (!state.tools.has(index)) {
                state.tools.set(index, true);
                out.id = tc.id || randomId('call_');
                out.type = 'function';
            }
            if (out.function && typeof out.function.arguments === 'object' && out.function.arguments !== null) {
                out.function = { ...out.function, arguments: JSON.stringify(out.function.arguments) };
            }
            return out;
        });
        if (ch.finish_reason === 'stop' && state.tools.size) ch.finish_reason = 'tool_calls';
    }
    return c;
}

/** Turn a full completion into the chunk sequence a streaming client expects. */
async function* completionToChunks(json) {
    const base = { id: json.id, object: 'chat.completion.chunk', created: json.created, model: json.model };
    for (const ch of json.choices || []) {
        const m = ch.message || {};
        const delta = { role: 'assistant', content: m.content ?? '' };
        if (m.tool_calls?.length) delta.tool_calls = m.tool_calls.map((tc, i) => ({ index: i, ...tc }));
        yield { ...base, choices: [{ index: ch.index ?? 0, delta, finish_reason: null }] };
        yield { ...base, choices: [{ index: ch.index ?? 0, delta: {}, finish_reason: ch.finish_reason || 'stop' }] };
    }
    if (json.usage) yield { ...base, choices: [], usage: json.usage };
}
