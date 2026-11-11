/**
 * Small, dependency-free helpers shared by every module.
 * Everything here uses web-standard APIs only, so the router runs on
 * Node >= 18, Bun, Deno and Cloudflare Workers unchanged.
 */

export const VERSION = '2.0.0';

/** ~4 characters per token is the usual English approximation. */
export function estimateTokens(text) {
    if (!text) return 0;
    return Math.max(1, Math.ceil(String(text).length / 4));
}

/** Plain text of one OpenAI-style message content (string or content parts). */
export function contentText(content) {
    if (content == null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(p => {
            if (typeof p === 'string') return p;
            if (p && (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text')) return p.text || '';
            return '';
        }).join('');
    }
    if (typeof content === 'object' && typeof content.text === 'string') return content.text;
    return '';
}

/** All text in a chat request, used for token/size estimates. */
export function requestText(body) {
    const parts = [];
    for (const m of body.messages || []) {
        parts.push(contentText(m.content));
        if (m.tool_calls) parts.push(JSON.stringify(m.tool_calls));
    }
    if (body.tools) parts.push(JSON.stringify(body.tools));
    return parts.join('\n');
}

/** Last user-authored text in a conversation ('' if none). */
export function lastUserText(messages = []) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'user') {
            const t = contentText(m.content).trim();
            if (t) return t;
        }
    }
    return '';
}

/** True when any message carries an image part. */
export function hasImages(messages = []) {
    return messages.some(m => Array.isArray(m.content) && m.content.some(p =>
        p && (p.type === 'image_url' || p.type === 'input_image' || p.type === 'image')));
}

export function randomId(prefix = '') {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return prefix + c.randomUUID().replace(/-/g, '').slice(0, 24);
    let s = '';
    for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
    return prefix + s;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function jsonResponse(obj, status = 200, headers = {}) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

/** OpenAI-shaped error body: { error: { message, type, param, code } } */
export function openaiError(status, message, type = 'invalid_request_error', code = null, extra = {}) {
    return jsonResponse({ error: { message, type, param: null, code, ...extra } }, status);
}

export class RouterError extends Error {
    constructor(message, { status = 500, type = 'router_error', code = null, attempts = [] } = {}) {
        super(message);
        this.status = status;
        this.type = type;
        this.code = code;
        this.attempts = attempts;
    }
}

/** Shallow-clone a request body, dropping keys whose value is undefined. */
export function cleanObject(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = v;
    return out;
}

/** Glob match supporting '*' wildcards (used by allow/deny lists and CORS). */
export function globMatch(pattern, value) {
    if (pattern === '*') return true;
    const re = new RegExp('^' + String(pattern).split('*').map(escapeRegExp).join('.*') + '$', 'i');
    return re.test(String(value));
}

export function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Promise that resolves after ms, or rejects early if the signal aborts. */
export function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    });
}

/** Combine several AbortSignals (+ optional timeout) into one controller. */
export function linkedAbort(signals = [], timeoutMs = 0) {
    const ctl = new AbortController();
    const onAbort = (reason) => { if (!ctl.signal.aborted) ctl.abort(reason); };
    for (const s of signals) {
        if (!s) continue;
        if (s.aborted) onAbort(s.reason);
        else s.addEventListener('abort', () => onAbort(s.reason), { once: true });
    }
    let timer = null;
    if (timeoutMs > 0) {
        timer = setTimeout(() => onAbort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();   // never keep a CLI process alive just for a timeout
    }
    return { signal: ctl.signal, abort: onAbort, clear: () => timer && clearTimeout(timer) };
}

/** USD cost for usage at per-1M-token prices (0 for free models). */
export function costUsd(model, inputTokens = 0, outputTokens = 0) {
    if (!model || model.free) return 0;
    const pin = model.pricing?.input ?? 0, pout = model.pricing?.output ?? 0;
    return (inputTokens * pin + outputTokens * pout) / 1e6;
}

/** Pretty-print a USD amount for logs and headers. */
export function fmtUsd(x) {
    if (!x) return '$0';
    if (x < 0.0001) return '<$0.0001';
    return '$' + x.toFixed(x < 0.01 ? 5 : 4);
}
