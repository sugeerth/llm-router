/**
 * Anthropic Messages API <-> OpenAI Chat Completions translation.
 * Lets Anthropic clients (Claude Code, the Anthropic SDKs) use any model the
 * router can reach. Covers text, images, tools (incl. streaming tool input),
 * stop reasons and usage. Thinking blocks from the client are dropped.
 */

import { contentText, estimateTokens, randomId } from './util.js';
import { sseEvent } from './sse.js';

function imageURL(source = {}) {
    if (source.type === 'base64') return `data:${source.media_type || 'image/png'};base64,${source.data}`;
    if (source.type === 'url') return source.url;
    return null;
}

function toolResultText(block) {
    const c = block.content;
    let text = typeof c === 'string' ? c
        : Array.isArray(c) ? c.map(b => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : '')).join('\n')
            : c == null ? '' : JSON.stringify(c);
    if (block.is_error) text = `Error: ${text}`;
    return text;
}

/** Anthropic request body -> OpenAI chat completions body. */
export function anthropicToOpenAI(body = {}) {
    const messages = [];
    if (body.system) {
        const sys = typeof body.system === 'string' ? body.system
            : (body.system || []).map(b => b.text || '').join('\n\n');
        if (sys.trim()) messages.push({ role: 'system', content: sys });
    }
    for (const m of body.messages || []) {
        const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
        if (m.role === 'assistant') {
            let text = '';
            const toolCalls = [];
            for (const b of blocks) {
                if (b.type === 'text') text += b.text || '';
                else if (b.type === 'tool_use') {
                    toolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
                }
                // thinking / redacted_thinking: not portable across models, dropped
            }
            const msg = { role: 'assistant', content: text || (toolCalls.length ? null : '') };
            if (toolCalls.length) msg.tool_calls = toolCalls;
            messages.push(msg);
            continue;
        }
        // user turn: tool results become OpenAI "tool" messages, which must come first
        const parts = [];
        for (const b of blocks) {
            if (b.type === 'tool_result') {
                messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: toolResultText(b) });
            } else if (b.type === 'text') {
                parts.push({ type: 'text', text: b.text || '' });
            } else if (b.type === 'image') {
                const url = imageURL(b.source);
                if (url) parts.push({ type: 'image_url', image_url: { url } });
            } else if (b.type === 'document' && b.source?.type === 'text') {
                parts.push({ type: 'text', text: b.source.data || '' });
            }
        }
        if (parts.length) {
            const textOnly = parts.every(p => p.type === 'text');
            messages.push({ role: 'user', content: textOnly ? parts.map(p => p.text).join('\n') : parts });
        }
    }

    const out = { model: body.model, messages, stream: !!body.stream };
    if (body.max_tokens != null) out.max_tokens = body.max_tokens;
    if (body.temperature != null) out.temperature = body.temperature;
    if (body.top_p != null) out.top_p = body.top_p;
    if (body.stop_sequences?.length) out.stop = body.stop_sequences;

    // Client tools only (server tools like web_search have no input_schema and can't be forwarded).
    const tools = (body.tools || []).filter(t => t && t.name && (t.input_schema || !t.type || t.type === 'custom'));
    if (tools.length) {
        out.tools = tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } },
        }));
        const tc = body.tool_choice;
        if (tc?.type === 'any') out.tool_choice = 'required';
        else if (tc?.type === 'tool') out.tool_choice = { type: 'function', function: { name: tc.name } };
        else if (tc?.type === 'none') out.tool_choice = 'none';
        if (tc?.disable_parallel_tool_use) out.parallel_tool_calls = false;
    }
    return out;
}

function stopReason(finish, hadTools) {
    if (hadTools || finish === 'tool_calls' || finish === 'function_call') return 'tool_use';
    if (finish === 'length') return 'max_tokens';
    return 'end_turn';
}

function parseArgs(s) {
    if (s && typeof s === 'object') return s;
    try { return JSON.parse(s || '{}'); } catch { return { _raw: String(s) }; }
}

/** OpenAI chat completion -> Anthropic message. */
export function openAIToAnthropic(json, model) {
    const choice = json.choices?.[0] || {};
    const msg = choice.message || {};
    const content = [];
    const text = typeof msg.content === 'string' ? msg.content : contentText(msg.content);
    if (text) content.push({ type: 'text', text });
    for (const tc of msg.tool_calls || []) {
        content.push({ type: 'tool_use', id: tc.id || randomId('toolu_'), name: tc.function?.name || '', input: parseArgs(tc.function?.arguments) });
    }
    if (!content.length) content.push({ type: 'text', text: '' });
    return {
        id: randomId('msg_'),
        type: 'message',
        role: 'assistant',
        model: model || json.model,
        content,
        stop_reason: stopReason(choice.finish_reason, !!msg.tool_calls?.length),
        stop_sequence: null,
        usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 },
    };
}

/**
 * OpenAI chunk stream -> Anthropic SSE event stream (as encoded bytes):
 * message_start, content_block_start/delta/stop (text_delta, input_json_delta),
 * message_delta (stop_reason, usage), message_stop.
 */
export async function* openAIStreamToAnthropic(chunks, { model, inputTokens = 0 }) {
    yield sseEvent('message_start', {
        type: 'message_start',
        message: {
            id: randomId('msg_'), type: 'message', role: 'assistant', model, content: [],
            stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
    });
    let index = -1, open = false, finish = null, usage = null, outChars = 0;
    const toolBlocks = new Map();   // OpenAI tool index -> Anthropic block index
    let openKind = null;
    const stopOpen = () => { open = false; openKind = null; return sseEvent('content_block_stop', { type: 'content_block_stop', index }); };

    try {
        for await (const chunk of chunks) {
            if (chunk.usage) usage = chunk.usage;
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const d = choice.delta || {};
            if (typeof d.content === 'string' && d.content) {
                if (openKind !== 'text') {
                    if (open) yield stopOpen();
                    index += 1; open = true; openKind = 'text';
                    yield sseEvent('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
                }
                outChars += d.content.length;
                yield sseEvent('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: d.content } });
            }
            for (const tc of d.tool_calls || []) {
                const ti = tc.index ?? 0;
                if (!toolBlocks.has(ti)) {
                    if (open) yield stopOpen();
                    index += 1; open = true; openKind = 'tool';
                    toolBlocks.set(ti, index);
                    yield sseEvent('content_block_start', {
                        type: 'content_block_start', index,
                        content_block: { type: 'tool_use', id: tc.id || randomId('toolu_'), name: tc.function?.name || '', input: {} },
                    });
                }
                const args = tc.function?.arguments;
                if (args) {
                    outChars += args.length;
                    yield sseEvent('content_block_delta', { type: 'content_block_delta', index: toolBlocks.get(ti), delta: { type: 'input_json_delta', partial_json: args } });
                }
            }
            if (choice.finish_reason) finish = choice.finish_reason;
        }
    } catch (err) {
        if (open) yield stopOpen();
        yield sseEvent('error', { type: 'error', error: { type: 'api_error', message: String(err.message || err) } });
        return;
    }
    if (open) yield stopOpen();
    if (index < 0) {   // nothing came back: emit an empty text block for strict clients
        index = 0;
        yield sseEvent('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        yield sseEvent('content_block_stop', { type: 'content_block_stop', index });
    }
    yield sseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason(finish, toolBlocks.size > 0), stop_sequence: null },
        usage: { output_tokens: usage?.completion_tokens ?? Math.ceil(outChars / 4) },
    });
    yield sseEvent('message_stop', { type: 'message_stop' });
}

/** Approximate token count for /v1/messages/count_tokens. */
export function countTokens(body = {}) {
    return { input_tokens: estimateTokens(JSON.stringify([body.system || '', body.messages || [], body.tools || []])) };
}

/** Anthropic-shaped error body. */
export function anthropicError(status, message) {
    const type = status === 429 ? 'rate_limit_error'
        : status === 401 ? 'authentication_error'
            : status === 403 ? 'permission_error'
                : status === 404 ? 'not_found_error'
                    : status === 400 ? 'invalid_request_error'
                        : status === 503 || status === 529 ? 'overloaded_error'
                            : 'api_error';
    return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
        status, headers: { 'content-type': 'application/json' },
    });
}
