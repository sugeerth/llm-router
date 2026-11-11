/**
 * Streaming helpers: parse Server-Sent Events and NDJSON from a fetch body,
 * and encode them back out. Web-standard streams only.
 */

const enc = new TextEncoder();

/** Async-iterate decoded text lines from a ReadableStream<Uint8Array>. */
async function* lines(stream) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                let line = buf.slice(0, i);
                buf = buf.slice(i + 1);
                if (line.endsWith('\r')) line = line.slice(0, -1);
                yield line;
            }
        }
        buf += dec.decode();
        if (buf) yield buf;
    } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
    }
}

/**
 * Parse an SSE stream into { event, data } records. `data` is the raw string
 * (multi-line data fields are joined with '\n'). Comments (":") are skipped.
 */
export async function* parseSSE(stream) {
    let event = null, data = [];
    for await (const line of lines(stream)) {
        if (line === '') {
            if (data.length) yield { event, data: data.join('\n') };
            event = null; data = [];
            continue;
        }
        if (line.startsWith(':')) continue;
        const idx = line.indexOf(':');
        const field = idx < 0 ? line : line.slice(0, idx);
        let value = idx < 0 ? '' : line.slice(idx + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
    }
    if (data.length) yield { event, data: data.join('\n') };
}

/**
 * Parse an OpenAI-style chat completion stream into chunk objects.
 * Stops at [DONE]. Non-JSON data lines are ignored; `{error}` payloads are
 * yielded as { __error: ... } so callers can decide what to do.
 */
export async function* parseOpenAIStream(stream) {
    for await (const { data } of parseSSE(stream)) {
        const d = data.trim();
        if (!d) continue;
        if (d === '[DONE]') return;
        let obj;
        try { obj = JSON.parse(d); } catch { continue; }
        if (obj && obj.error && !obj.choices) { yield { __error: obj.error }; continue; }
        yield obj;
    }
}

/** Parse newline-delimited JSON (Ollama native streaming). */
export async function* parseNDJSON(stream) {
    for await (const line of lines(stream)) {
        const t = line.trim();
        if (!t) continue;
        try { yield JSON.parse(t); } catch { /* skip partial/garbage line */ }
    }
}

export function sseData(obj) {
    return enc.encode(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`);
}

export function sseEvent(event, obj) {
    return enc.encode(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
}

export function ndjsonLine(obj) {
    return enc.encode(JSON.stringify(obj) + '\n');
}

/**
 * Build a streaming Response from an async generator of Uint8Array chunks.
 * `onCancel` runs if the client disconnects (lets us abort the upstream call).
 */
export function streamResponse(gen, headers = {}, onCancel) {
    const iterator = gen[Symbol.asyncIterator] ? gen[Symbol.asyncIterator]() : gen;
    const body = new ReadableStream({
        async pull(controller) {
            try {
                const { value, done } = await iterator.next();
                if (done) controller.close();
                else controller.enqueue(value);
            } catch (err) {
                controller.error(err);
            }
        },
        async cancel(reason) {
            try { onCancel?.(reason); } catch { /* ignore */ }
            try { await iterator.return?.(); } catch { /* ignore */ }
        },
    });
    return new Response(body, {
        status: 200,
        headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            ...headers,
        },
    });
}
