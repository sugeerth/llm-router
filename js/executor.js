/**
 * Model Executor - Handles actual API calls to LLM providers.
 * Used when the user clicks "Route & Execute" to get a real response.
 */

export class ModelExecutor {
    constructor() {
        this.keys = this._loadKeys();
    }

    _loadKeys() {
        try {
            return JSON.parse(localStorage.getItem('llm-router-keys') || '{}');
        } catch {
            return {};
        }
    }

    saveKeys(keys) {
        this.keys = keys;
        localStorage.setItem('llm-router-keys', JSON.stringify(keys));
    }

    clearKeys() {
        this.keys = {};
        localStorage.removeItem('llm-router-keys');
    }

    getKeys() {
        return { ...this.keys };
    }

    hasKeyFor(model) {
        const provider = model.provider;
        if (this.keys.openrouter) return true;
        return !!this.keys[provider];
    }

    /**
     * Execute a query against a specific model.
     * Tries provider-native API first, falls back to OpenRouter.
     */
    async execute(model, query) {
        const startTime = performance.now();

        // Try OpenRouter first as universal fallback
        if (this.keys.openrouter) {
            return this._executeOpenRouter(model, query, startTime);
        }

        // Try native provider API
        switch (model.provider) {
            case 'openai':
                if (this.keys.openai) return this._executeOpenAI(model, query, startTime);
                break;
            case 'anthropic':
                if (this.keys.anthropic) return this._executeAnthropic(model, query, startTime);
                break;
            case 'google':
                if (this.keys.google) return this._executeGoogle(model, query, startTime);
                break;
        }

        throw new Error(`No API key configured for ${model.provider}. Add a key in Settings, or use an OpenRouter key for universal access.`);
    }

    async _executeOpenAI(model, query, startTime) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.keys.openai}`,
            },
            body: JSON.stringify({
                model: model.id,
                messages: [{ role: 'user', content: query }],
                max_tokens: 4096,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `OpenAI API error: ${res.status}`);
        }

        const data = await res.json();
        return {
            content: data.choices[0].message.content,
            model: data.model,
            usage: data.usage,
            latencyMs: Math.round(performance.now() - startTime),
        };
    }

    async _executeAnthropic(model, query, startTime) {
        // Anthropic requires CORS proxy or backend - use OpenRouter as fallback
        // Direct Anthropic API doesn't support browser CORS
        if (this.keys.openrouter) {
            return this._executeOpenRouter(model, query, startTime);
        }

        // Try direct API with a note about CORS
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.keys.anthropic,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: model.id,
                max_tokens: 4096,
                messages: [{ role: 'user', content: query }],
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Anthropic API error: ${res.status}`);
        }

        const data = await res.json();
        return {
            content: data.content[0].text,
            model: data.model,
            usage: { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens },
            latencyMs: Math.round(performance.now() - startTime),
        };
    }

    async _executeGoogle(model, query, startTime) {
        const apiModel = model.id === 'gemini-2.0-flash' ? 'gemini-2.0-flash' : 'gemini-2.5-pro-preview-05-06';
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${this.keys.google}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: query }] }],
                generationConfig: { maxOutputTokens: 4096 },
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Google API error: ${res.status}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
        return {
            content: text,
            model: apiModel,
            usage: data.usageMetadata || {},
            latencyMs: Math.round(performance.now() - startTime),
        };
    }

    async _executeOpenRouter(model, query, startTime) {
        // Map model IDs to OpenRouter model IDs
        const orModelMap = {
            'gpt-4o': 'openai/gpt-4o',
            'gpt-4o-mini': 'openai/gpt-4o-mini',
            'o3-mini': 'openai/o3-mini',
            'claude-sonnet-4': 'anthropic/claude-sonnet-4',
            'claude-haiku-3.5': 'anthropic/claude-3.5-haiku',
            'claude-opus-4': 'anthropic/claude-opus-4',
            'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
            'gemini-2.5-pro': 'google/gemini-2.5-pro-preview',
            'llama-3.3-70b': 'meta-llama/llama-3.3-70b-instruct',
            'mistral-large': 'mistralai/mistral-large',
            'deepseek-r1': 'deepseek/deepseek-r1',
            'deepseek-v3': 'deepseek/deepseek-chat-v3-0324',
        };

        const orModel = orModelMap[model.id] || model.id;

        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.keys.openrouter}`,
                'HTTP-Referer': window.location.origin,
                'X-Title': 'LLM Router',
            },
            body: JSON.stringify({
                model: orModel,
                messages: [{ role: 'user', content: query }],
                max_tokens: 4096,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `OpenRouter API error: ${res.status}`);
        }

        const data = await res.json();
        return {
            content: data.choices[0].message.content,
            model: data.model,
            usage: data.usage,
            latencyMs: Math.round(performance.now() - startTime),
        };
    }
}
