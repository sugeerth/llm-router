/**
 * Model knowledge: turn any model id ("llama-3.3-70b-versatile",
 * "meta-llama/llama-3.3-70b-instruct:free", "qwen3:8b") into a routing profile.
 *
 * Quality numbers are hand-set PRIORS (0-1), not benchmarks. They only need to
 * rank models sensibly; override any of them in config ("profiles").
 * Unknown models fall back to their parameter count ("70b" -> 0.84).
 */

import { TASK_TYPES } from '../js/models.js';
import { clamp } from './util.js';

/** Normalized family key, so the same model matches across providers. */
export function familyKey(id) {
    return String(id).toLowerCase()
        .replace(/^.*\//, '')                         // drop vendor prefix: meta-llama/...
        .replace(/:free$|:latest$/, '')
        .replace(/^meta-/, '')
        .replace(/[-_.:](instruct|versatile|instant|turbo|chat|it|hf|fp8|fast|preview|latest|exp)\b/g, '')
        .replace(/[-_.](\d{4}|\d{6}|\d{8})$/, '')     // date stamps: -2507, -20250514
        .replace(/llama(\d)/, 'llama-$1')             // llama3.1 -> llama-3.1
        .replace(/[_\s:]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// First match wins. q = quality prior. Flags: tools, vision, reasoning, coder. ctx = context window.
const FAMILIES = [
    [/claude.*opus/, { q: 0.97, tools: true, vision: true, reasoning: true, ctx: 200000 }],
    [/claude.*sonnet/, { q: 0.95, tools: true, vision: true, reasoning: true, ctx: 200000 }],
    [/claude.*haiku/, { q: 0.86, tools: true, vision: true, ctx: 200000 }],
    [/gpt-5.*nano/, { q: 0.80, tools: true, vision: true, reasoning: true, ctx: 400000 }],
    [/gpt-5.*mini/, { q: 0.89, tools: true, vision: true, reasoning: true, ctx: 400000 }],
    [/gpt-5/, { q: 0.95, tools: true, vision: true, reasoning: true, ctx: 400000 }],
    [/gpt-4\.1-nano/, { q: 0.76, tools: true, vision: true, ctx: 1000000 }],
    [/gpt-4\.1-mini/, { q: 0.85, tools: true, vision: true, ctx: 1000000 }],
    [/gpt-4\.1/, { q: 0.91, tools: true, vision: true, ctx: 1000000 }],
    [/gpt-4o-mini/, { q: 0.80, tools: true, vision: true, ctx: 128000 }],
    [/gpt-4o/, { q: 0.89, tools: true, vision: true, ctx: 128000 }],
    [/^o[134](-mini)?$/, { q: 0.92, tools: true, reasoning: true, ctx: 200000 }],
    [/gpt-oss-120b/, { q: 0.89, tools: true, reasoning: true, ctx: 131072 }],
    [/gpt-oss-20b/, { q: 0.82, tools: true, reasoning: true, ctx: 131072 }],
    [/gemini-3.*pro/, { q: 0.96, tools: true, vision: true, reasoning: true, ctx: 1000000 }],
    [/gemini-3.*flash-lite/, { q: 0.85, tools: true, vision: true, ctx: 1000000 }],
    [/gemini-3.*flash/, { q: 0.92, tools: true, vision: true, reasoning: true, ctx: 1000000 }],
    [/gemini-2\.5-pro/, { q: 0.94, tools: true, vision: true, reasoning: true, ctx: 1000000 }],
    [/gemini-2\.5-flash-lite/, { q: 0.82, tools: true, vision: true, ctx: 1000000 }],
    [/gemini-2\.5-flash/, { q: 0.89, tools: true, vision: true, reasoning: true, ctx: 1000000 }],
    [/gemini-2\.0-flash-lite/, { q: 0.78, tools: true, vision: true, ctx: 1000000 }],
    [/gemini-2\.0-flash/, { q: 0.84, tools: true, vision: true, ctx: 1000000 }],
    [/gemini/, { q: 0.85, tools: true, vision: true, ctx: 1000000 }],
    [/grok-4/, { q: 0.94, tools: true, vision: true, reasoning: true, ctx: 256000 }],
    [/grok-3-mini|grok-code/, { q: 0.85, tools: true, reasoning: true, ctx: 131072 }],
    [/grok/, { q: 0.90, tools: true, ctx: 131072 }],
    [/deepseek-r1-distill/, { reasoning: true, tools: false }],          // quality from size
    [/deepseek.*(r1|reasoner)/, { q: 0.91, reasoning: true, ctx: 128000 }],
    [/deepseek.*(v3|chat)/, { q: 0.90, tools: true, ctx: 128000 }],
    [/kimi-k2.*thinking/, { q: 0.92, tools: true, reasoning: true, ctx: 256000 }],
    [/kimi-k2/, { q: 0.90, tools: true, ctx: 131072 }],
    [/glm-4\.[5-9]v/, { q: 0.84, tools: true, vision: true, reasoning: true, ctx: 64000 }],
    [/glm-4\.[5-9].*(air|flash)/, { q: 0.84, tools: true, reasoning: true, ctx: 128000 }],
    [/glm-4\.[5-9]/, { q: 0.89, tools: true, reasoning: true, ctx: 128000 }],
    [/minimax-m[12]/, { q: 0.89, tools: true, reasoning: true, ctx: 200000 }],
    [/qwen3-coder/, { q: 0.88, tools: true, coder: true, ctx: 256000 }],
    [/qwen3.*235b/, { q: 0.90, tools: true, reasoning: true, ctx: 131072 }],
    [/qwen3.*vl/, { tools: true, vision: true }],
    [/qwen3-next|qwen3.*80b/, { q: 0.88, tools: true, reasoning: true, ctx: 131072 }],
    [/qwen3/, { tools: true, reasoning: true }],                         // quality from size
    [/qwq/, { q: 0.86, tools: true, reasoning: true }],
    [/qwen.*vl/, { vision: true }],
    [/qwen.*coder/, { tools: true, coder: true }],
    [/qwen/, { tools: true }],
    [/llama-4.*maverick/, { q: 0.86, tools: true, vision: true, ctx: 1000000 }],
    [/llama-4.*scout/, { q: 0.82, tools: true, vision: true, ctx: 1000000 }],
    [/llama-3\.2.*vision/, { vision: true }],
    [/llama-3\.[123]/, { tools: true, ctx: 128000 }],                   // quality from size
    [/mistral-large|mistral-medium/, { q: 0.88, tools: true, vision: true, ctx: 128000 }],
    [/magistral/, { q: 0.86, tools: true, reasoning: true, ctx: 40000 }],
    [/codestral|devstral/, { q: 0.85, tools: true, coder: true, ctx: 128000 }],
    [/pixtral/, { q: 0.84, tools: true, vision: true, ctx: 128000 }],
    [/mistral-small/, { q: 0.80, tools: true, vision: true, ctx: 128000 }],
    [/ministral|mistral-nemo|open-mistral/, { q: 0.72, tools: true, ctx: 128000 }],
    [/gemma-3n/, { q: 0.62, ctx: 32000 }],
    [/gemma-3/, { vision: true, ctx: 128000 }],
    [/phi-4.*reasoning/, { q: 0.80, reasoning: true, ctx: 32000 }],
    [/phi-4/, { q: 0.77, ctx: 16000 }],
    [/command-a|command-r/, { q: 0.85, tools: true, ctx: 128000 }],
    [/nemotron.*ultra/, { q: 0.89, tools: true, reasoning: true, ctx: 128000 }],
    [/nemotron.*super/, { q: 0.86, tools: true, reasoning: true, ctx: 128000 }],
    [/(llava|minicpm-v|moondream|vision)/, { vision: true }],
];

/** Quality prior from parameter count ("70b", "8b", "235b-a22b"). */
function qualityFromSize(id) {
    const m = String(id).toLowerCase().match(/(\d+(?:\.\d+)?)\s*b(?![a-z])/);
    if (!m) return null;
    const b = parseFloat(m[1]);
    if (b < 2) return 0.5;
    if (b < 5) return 0.62;
    if (b < 10) return 0.70;
    if (b < 21) return 0.76;
    if (b < 41) return 0.81;
    if (b < 81) return 0.84;
    if (b < 201) return 0.87;
    return 0.89;
}

/**
 * Infer a profile from the id plus whatever metadata the provider's /models
 * returned (context length, tool/vision support). Metadata always wins.
 */
export function inferProfile(id, meta = {}) {
    const key = familyKey(id);
    const lower = String(id).toLowerCase();
    let fam = {};
    for (const [re, p] of FAMILIES) {
        if (re.test(key) || re.test(lower)) { fam = p; break; }
    }
    const quality = meta.quality ?? fam.q ?? qualityFromSize(lower) ?? 0.75;
    return {
        family: key,
        quality,
        tools: meta.tools ?? fam.tools ?? null,          // null = unknown
        vision: meta.vision ?? fam.vision ?? false,
        reasoning: meta.reasoning ?? fam.reasoning ?? /(\br1\b|reason|think|qwq)/.test(lower),
        coder: meta.coder ?? fam.coder ?? /(coder|codestral|devstral)/.test(lower),
        context: meta.context || fam.ctx || null,
    };
}

/**
 * A routable candidate: provider + model id + inferred profile.
 *   strengths[task]  task-aware quality (coders a bit better at code, reasoners at math)
 *   speedScore       0-1 from latency (3s+ = 0) and log-scaled throughput (10..1000 tok/s)
 */
export function toCandidate(provider, modelId, meta = {}) {
    const p = inferProfile(modelId, meta);
    const q = p.quality;
    const strengths = {};
    for (const t of Object.values(TASK_TYPES)) {
        let d = 0;
        if ((t === TASK_TYPES.CODE_GENERATION || t === TASK_TYPES.CODE_DEBUG) && p.coder) d += 0.04;
        if (t === TASK_TYPES.MATH_REASONING) d += p.reasoning ? 0.04 : (q < 0.85 ? -0.04 : 0);
        if (t === TASK_TYPES.SYSTEM_DESIGN && p.reasoning) d += 0.02;
        if ((t === TASK_TYPES.CREATIVE_WRITING || t === TASK_TYPES.CONVERSATION) && p.coder) d -= 0.05;
        strengths[t] = clamp(q + d, 0.3, 0.99);
    }
    const speed = provider.speed || {};
    const latencyMs = (speed.latencyMs || 600) * (p.reasoning ? 2 : 1);              // reasoners think first
    const tps = (speed.tps || 60) * (q < 0.72 ? 1.6 : q < 0.8 ? 1.3 : q >= 0.9 ? 0.8 : 1); // small = faster
    return {
        id: `${provider.id}/${modelId}`,   // what clients send as "model"
        upstreamId: modelId,                // what the provider expects
        provider: provider.id,
        free: meta.free ?? !!provider.free,
        local: !!provider.local,
        family: p.family,
        quality: q,
        strengths,
        tools: p.tools,
        vision: p.vision,
        reasoning: p.reasoning,
        contextWindow: p.context || (provider.local ? 8192 : 32768),
        speedScore: 0.4 * clamp(1 - latencyMs / 3000, 0, 1) + 0.6 * clamp((Math.log10(tps) - 1) / 2, 0, 1),
        pricing: meta.pricing || null,
        providerRef: provider,
    };
}
