/**
 * Provider catalog. A provider is a plain object — adding one is a few lines,
 * either here or in llm-router.json ("providers": [{ id, baseURL, keyEnv }]).
 *
 * Fields:
 *   id, name     identifiers (id is the prefix in "groq/llama-3.3-70b-versatile")
 *   baseURL      OpenAI-compatible base (the router POSTs {baseURL}/chat/completions).
 *                May contain ${ENV_VAR} placeholders.
 *   keyEnv       env var(s) holding the key; first one set wins
 *   local        true = no key, auto-detected by probing {baseURL}/models
 *   free         true = has a free tier (treated as $0). false = paid, used only with allowPaid
 *   signup       where to get a free key
 *   discover     fetch {modelsURL || baseURL/models} to learn models (default true)
 *   models       fallback / curated model ids when discovery is off or fails
 *   freeOnly     keep only $0 models from discovery (OpenRouter)
 *   speed        { latencyMs, tps } priors; replaced by observed latency over time
 *   headers      extra request headers
 */

export const BUILTIN_PROVIDERS = [
    // ── Local servers: free, private, auto-detected ─────────────────────────
    { id: 'ollama', name: 'Ollama', local: true, free: true, baseURL: 'http://127.0.0.1:11434/v1', baseURLEnv: 'OLLAMA_HOST', speed: { latencyMs: 300, tps: 40 } },
    { id: 'lmstudio', name: 'LM Studio', local: true, free: true, baseURL: 'http://127.0.0.1:1234/v1', speed: { latencyMs: 300, tps: 40 } },
    { id: 'llamacpp', name: 'llama.cpp / MLX', local: true, free: true, baseURL: 'http://127.0.0.1:8080/v1', speed: { latencyMs: 300, tps: 40 } },
    { id: 'vllm', name: 'vLLM', local: true, free: true, baseURL: 'http://127.0.0.1:8000/v1', speed: { latencyMs: 250, tps: 60 } },

    // ── Free cloud tiers: free key, no credit card ──────────────────────────
    {
        id: 'groq', name: 'Groq', free: true, keyEnv: 'GROQ_API_KEY',
        baseURL: 'https://api.groq.com/openai/v1', signup: 'https://console.groq.com/keys',
        speed: { latencyMs: 250, tps: 450 },
        // production models per console.groq.com/docs/models (2026-11); live discovery adds previews
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    },
    {
        id: 'cerebras', name: 'Cerebras', free: true, keyEnv: 'CEREBRAS_API_KEY',
        baseURL: 'https://api.cerebras.ai/v1', signup: 'https://cloud.cerebras.ai',
        speed: { latencyMs: 250, tps: 1200 },
        models: ['gpt-oss-120b', 'llama-3.3-70b', 'llama3.1-8b', 'qwen-3-32b', 'qwen-3-235b-a22b-instruct-2507'],
    },
    {
        id: 'gemini', name: 'Google Gemini', free: true, keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', signup: 'https://aistudio.google.com/apikey',
        speed: { latencyMs: 600, tps: 180 },
        // Discovery lists paid-only models too, so we keep a curated free-tier list
        // (per ai.google.dev pricing, 2026-11; free limits are per project).
        discover: false,
        models: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'],
    },
    {
        id: 'openrouter', name: 'OpenRouter', free: true, freeOnly: true, keyEnv: 'OPENROUTER_API_KEY',
        baseURL: 'https://openrouter.ai/api/v1', signup: 'https://openrouter.ai/keys',
        speed: { latencyMs: 1200, tps: 60 },
        headers: { 'HTTP-Referer': 'https://github.com/sugeerth/llm-router', 'X-OpenRouter-Title': 'llm-router', 'X-Title': 'llm-router' },
        models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free', 'qwen/qwen3-coder:free'],
    },
    {
        id: 'mistral', name: 'Mistral', free: true, keyEnv: 'MISTRAL_API_KEY',
        baseURL: 'https://api.mistral.ai/v1', signup: 'https://console.mistral.ai/api-keys',
        speed: { latencyMs: 500, tps: 90 },
        models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'codestral-latest', 'ministral-8b-latest'],
    },
    {
        id: 'github', name: 'GitHub Models', free: true, keyEnv: ['GITHUB_TOKEN', 'GITHUB_MODELS_TOKEN'],
        baseURL: 'https://models.github.ai/inference', modelsURL: 'https://models.github.ai/catalog/models',
        signup: 'https://github.com/settings/personal-access-tokens', speed: { latencyMs: 900, tps: 70 },
        models: ['openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/gpt-4o', 'openai/gpt-4o-mini', 'meta/Llama-3.3-70B-Instruct', 'deepseek/DeepSeek-V3-0324'],
    },
    {
        id: 'nvidia', name: 'NVIDIA NIM', free: true, keyEnv: 'NVIDIA_API_KEY',
        baseURL: 'https://integrate.api.nvidia.com/v1', signup: 'https://build.nvidia.com',
        speed: { latencyMs: 800, tps: 60 },
        discover: false,   // the catalog has 100+ niche models; keep a curated list
        models: ['meta/llama-3.3-70b-instruct', 'openai/gpt-oss-120b', 'deepseek-ai/deepseek-r1', 'qwen/qwen3-235b-a22b', 'moonshotai/kimi-k2-instruct'],
    },
    {
        id: 'sambanova', name: 'SambaNova', free: true, keyEnv: 'SAMBANOVA_API_KEY',
        baseURL: 'https://api.sambanova.ai/v1', signup: 'https://cloud.sambanova.ai',
        speed: { latencyMs: 400, tps: 350 },
        models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3-0324', 'gpt-oss-120b', 'Llama-4-Maverick-17B-128E-Instruct'],
    },
    {
        id: 'cloudflare', name: 'Cloudflare Workers AI', free: true, keyEnv: 'CLOUDFLARE_API_TOKEN',
        baseURL: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1',
        signup: 'https://dash.cloudflare.com/profile/api-tokens', speed: { latencyMs: 700, tps: 60 },
        discover: false,
        models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.1-8b-instruct'],
    },

    // ── Paid: only used when allowPaid is on ────────────────────────────────
    { id: 'openai', name: 'OpenAI', free: false, keyEnv: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', openaiNative: true, speed: { latencyMs: 500, tps: 100 }, include: /^(gpt-|o\d|chatgpt)/, exclude: /(codex|deep-research|-pro\b)/, models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'] },
    { id: 'anthropic', name: 'Anthropic', free: false, keyEnv: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1', speed: { latencyMs: 700, tps: 70 }, headers: { 'anthropic-version': '2023-06-01' }, keyHeader: 'x-api-key', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'] },
    { id: 'deepseek', name: 'DeepSeek', free: false, keyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com/v1', speed: { latencyMs: 900, tps: 40 }, models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'xai', name: 'xAI', free: false, keyEnv: 'XAI_API_KEY', baseURL: 'https://api.x.ai/v1', speed: { latencyMs: 600, tps: 80 }, models: ['grok-4', 'grok-3-mini'] },
    { id: 'together', name: 'Together AI', free: false, keyEnv: 'TOGETHER_API_KEY', baseURL: 'https://api.together.xyz/v1', speed: { latencyMs: 500, tps: 100 }, models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
];

/** Models that are not chat models (embeddings, speech, images, guards...). */
export const NON_CHAT = /(embed|whisper|tts|transcri|speech|audio|realtime|moderation|guard|rerank|dall-e|gpt-image|imagen|veo|sora|davinci|babbage|search|computer-use|playai|orpheus|compound|ocr|\baqa\b|-live\b|native-audio|lyria|-image\b|flux|stable-diffusion|sdxl)/i;

/** Replace ${ENV} placeholders; returns null if any placeholder is unset. */
export function expandEnv(str, env) {
    let missing = false;
    const out = String(str).replace(/\$\{(\w+)\}/g, (_, k) => {
        if (!env[k]) missing = true;
        return env[k] || '';
    });
    return missing ? null : out;
}

/** First non-empty env var from a name or list of names. */
function firstEnv(names, env) {
    for (const n of [].concat(names || [])) if (env[n]) return env[n];
    return null;
}

/** OLLAMA_HOST may be "0.0.0.0:11434", "http://host:11434" or a full /v1 URL. */
function normalizeBaseURL(url) {
    let u = String(url).trim();
    if (!/^https?:\/\//.test(u)) u = 'http://' + u;
    u = u.replace(/\/+$/, '');
    u = u.replace('://0.0.0.0', '://127.0.0.1');
    if (!/\/v\d+(beta)?(\/openai)?$|\/inference$|\/ai\/v1$/.test(u)) u += '/v1';
    return u;
}

/**
 * Resolve the provider list: built-ins (minus disabled), merged with config
 * overrides by id, plus custom providers. Attaches the API key and final URL.
 */
export function resolveProviders(configProviders = [], env = {}, { builtins = true } = {}) {
    const byId = new Map(builtins ? BUILTIN_PROVIDERS.map(p => [p.id, { ...p }]) : []);
    for (const c of configProviders) {
        if (!c || !c.id) continue;
        byId.set(c.id, { ...(byId.get(c.id) || { free: true, custom: true }), ...c });
    }
    const out = [];
    for (const p of byId.values()) {
        if (p.enabled === false) continue;
        let baseURL = p.baseURLEnv && env[p.baseURLEnv] ? normalizeBaseURL(env[p.baseURLEnv]) : p.baseURL;
        if (!baseURL) continue;
        baseURL = expandEnv(baseURL, env);
        if (!baseURL) continue;                       // e.g. Cloudflare without an account id
        const apiKey = p.apiKey || firstEnv(p.keyEnv, env);
        // Cloud providers need a key (unless the config says the endpoint is keyless).
        const needsKey = !p.local && p.keyless !== true && (p.keyEnv || !p.custom);
        out.push({ ...p, baseURL: baseURL.replace(/\/+$/, ''), apiKey, ready: !needsKey || !!apiKey });
    }
    return out;
}

/** Request headers for a provider (auth + extras). */
export function providerHeaders(p) {
    const h = { 'content-type': 'application/json', ...(p.headers || {}) };
    if (p.apiKey) {
        if (p.keyHeader) h[p.keyHeader] = p.apiKey;
        h.authorization = `Bearer ${p.apiKey}`;
    }
    return h;
}

/**
 * Parse any /models response shape into [{ id, context, tools, vision, free, pricing }].
 * Handles OpenAI ({data:[...]}), GitHub (array), Ollama/Gemini quirks and OpenRouter metadata.
 */
export function parseModelList(p, json, { allowPaid = false } = {}) {
    const arr = Array.isArray(json) ? json : (json?.data || json?.models || []);
    let models = arr.map(m => (typeof m === 'string' ? { id: m } : m)).map(m => {
        const id = String(m.id || m.name || m.model || '').replace(/^models\//, '');
        const out = { id };
        const ctx = m.context_length || m.context_window || m.max_context_length
            || m.limits?.max_input_tokens || m.top_provider?.context_length;
        if (ctx) out.context = Number(ctx);
        if (Array.isArray(m.supported_parameters)) out.tools = m.supported_parameters.includes('tools');
        if (Array.isArray(m.capabilities)) out.tools = m.capabilities.includes('tool-calling') || m.capabilities.includes('tools');
        const inputs = m.architecture?.input_modalities || m.supported_input_modalities;
        if (Array.isArray(inputs)) out.vision = inputs.includes('image');
        if (m.pricing && m.pricing.prompt != null) {
            const pin = Number(m.pricing.prompt), pout = Number(m.pricing.completion);
            out.free = pin === 0 && pout === 0;
            out.pricing = { input: pin * 1e6, output: pout * 1e6 };   // per 1M tokens
        }
        return out;
    }).filter(m => m.id && !NON_CHAT.test(m.id));
    if (p.include) models = models.filter(m => p.include.test(m.id));
    if (p.exclude) models = models.filter(m => !p.exclude.test(m.id));
    if (p.id === 'openrouter') models = models.filter(m => !m.id.startsWith('openrouter/'));
    if (p.freeOnly && !allowPaid) models = models.filter(m => m.free === true || m.id.endsWith(':free'));
    // Drop dated duplicates when a "-latest" alias exists (Mistral style).
    const ids = new Set(models.map(m => m.id));
    models = models.filter(m => {
        const base = m.id.replace(/-\d{4}$/, '');
        return base === m.id || !ids.has(`${base}-latest`);
    });
    return models;
}
