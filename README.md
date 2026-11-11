# LLM Router

**One free endpoint for every LLM.** Point any OpenAI- or Anthropic-compatible app at `http://localhost:4000`, use `model: "auto"`, and each request goes to the best **free** model you have: local (Ollama, LM Studio, llama.cpp, MLX, vLLM) or a free cloud tier (Groq, Gemini, OpenRouter, Cerebras, Mistral, GitHub Models, …). If a provider is rate-limited or down, it fails over to the next one automatically.

- **Free by default.** Paid models are never used unless you pass `--allow-paid`.
- **Works with anything.** OpenAI Chat Completions API (streaming, tools, images) and the Anthropic Messages API (Claude Code, Anthropic SDKs).
- **Zero dependencies.** One command, Node 18+. MIT licensed.
- **Easy to extend.** Any OpenAI-compatible URL becomes a provider with a few lines of JSON.

## Quickstart

```bash
# 1. Have at least one free source: a local server (e.g. Ollama) or a free key (no credit card):
export GROQ_API_KEY=...        # https://console.groq.com/keys

# 2. Start the router
npx github:sugeerth/llm-router

# 3. Use it from anything
curl http://localhost:4000/v1/chat/completions -H "content-type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'
```

Or ask straight from the terminal (no server needed):

```bash
npx github:sugeerth/llm-router ask "Explain CAP theorem in 3 lines"
cat error.log | npx github:sugeerth/llm-router ask "what went wrong?"
```

Every response says which model answered: the `model` field, plus `x-llm-router-model`, `x-llm-router-reason` and `x-llm-router-attempts` headers.

## Models you can ask for

| `model` | What happens |
|---|---|
| `auto` (default) | The **fastest model that is good enough** for the request. Simple asks go to small, fast models; code, math and analysis go to strong ones. |
| `fast` | The fastest model available. |
| `best` | The strongest model available. |
| `local` | Like `auto`, but only local models (fully private). |
| `groq/llama-3.3-70b-versatile` | Exactly that model (`GET /v1/models` lists them all). |
| `llama-3.3-70b` | That model on whichever provider has it free right now. |
| anything else (`gpt-4o-mini`, `claude-sonnet-4-5`, …) | Routed by intent (`mini`/`haiku`/`flash` → `fast`, `opus`/`pro` → `best`, otherwise `auto`), so apps with hard-coded model names just work. |

**How `auto` decides, in one sentence:** it classifies the request (task type and difficulty, using the same analyzer as the [browser playground](https://sugeerth.github.io/llm-router/)), sets a quality bar `need = 0.68 + 0.27 × complexity`, and picks the fastest model whose quality clears it. Requests with tools or images only go to models that support them, and long prompts only to models whose context fits. Model quality numbers are hand-set priors by model family (not benchmarks); you can override them in config.

## Free providers

Set any of these environment variables (all free, no credit card). Local servers need nothing; they're detected automatically, even if you start them later.

| Provider | Env var | Get a key |
|---|---|---|
| Ollama · LM Studio · llama.cpp / MLX · vLLM | — (auto-detected on ports 11434 · 1234 · 8080 · 8000) | — |
| Groq | `GROQ_API_KEY` | https://console.groq.com/keys |
| Google Gemini | `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| OpenRouter (`:free` models only) | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Cerebras | `CEREBRAS_API_KEY` | https://cloud.cerebras.ai |
| Mistral | `MISTRAL_API_KEY` | https://console.mistral.ai/api-keys |
| GitHub Models | `GITHUB_TOKEN` | https://github.com/settings/personal-access-tokens |
| NVIDIA NIM | `NVIDIA_API_KEY` | https://build.nvidia.com |
| SambaNova | `SAMBANOVA_API_KEY` | https://cloud.sambanova.ai |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | https://dash.cloudflare.com/profile/api-tokens |

More keys = more free capacity: when one provider hits its rate limit, requests flow to the next. Paid providers (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `TOGETHER_API_KEY`) are only used with `--allow-paid`. Free tiers change often; the router reads each provider's live model list where it can. If you enable billing on a provider's account, its calls may be billed.

Run `npx github:sugeerth/llm-router models` to see what is connected.

## Works with

OpenAI-compatible apps use `base_url = http://localhost:4000/v1`. Anthropic-compatible apps use `http://localhost:4000`. Any API key works unless you set one with `--api-key`.

**OpenAI SDK (Python / JS)**
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:4000/v1", api_key="anything")
client.chat.completions.create(model="auto", messages=[{"role": "user", "content": "hi"}])
```
```js
const client = new OpenAI({ baseURL: 'http://localhost:4000/v1', apiKey: 'anything' });
```
Or set `OPENAI_BASE_URL=http://localhost:4000/v1` for any tool built on the OpenAI SDK.

**Claude Code**
```bash
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_AUTH_TOKEN=anything
export ANTHROPIC_MODEL=auto                 # or best
export ANTHROPIC_DEFAULT_HAIKU_MODEL=fast   # background tasks
claude
```
Free models are much weaker than Claude at agentic coding, but this works for experiments and light tasks. Long prompts with tools need a cloud model with a big context window (e.g. Groq), not a small local one.

**Anthropic SDK**: `anthropic.Anthropic(base_url="http://localhost:4000", api_key="anything")`

**LangChain**: `ChatOpenAI(base_url="http://localhost:4000/v1", api_key="anything", model="auto")`

**Aider**: `aider --openai-api-base http://localhost:4000/v1 --openai-api-key anything --model openai/auto`

**Open WebUI (Docker)**: `-e OPENAI_API_BASE_URL=http://host.docker.internal:4000/v1 -e OPENAI_API_KEY=anything`. The router's models appear in the model picker.

**Anything else** that lets you set an OpenAI base URL (LlamaIndex `OpenAILike`, Vercel AI SDK, LiteLLM `openai/auto`, n8n, Continue, …).

Known limits: **Codex CLI** speaks only OpenAI's newer Responses API, which this router doesn't implement yet. **Cursor** sends requests from its own servers, so it can't reach `localhost`; it needs a public tunnel plus `--api-key`. LiteLLM's proxy also defaults to port 4000, so use `--port` if you run both.

## Configuration (optional)

Everything works with env vars alone. For more, create `llm-router.json` in the folder where you run it (or pass `--config file`):

```json
{
  "providers": [
    { "id": "gpu-box", "baseURL": "http://192.168.1.20:8000/v1" },
    { "id": "my-cloud", "baseURL": "https://api.example.com/v1", "keyEnv": "MY_CLOUD_KEY", "models": ["some-model-70b"] },
    { "id": "mistral", "enabled": false }
  ],
  "aliases": { "coder": "best", "gpt-4o": "github/openai/gpt-4o" },
  "profiles": { "gpu-box/my-finetune": { "quality": 0.88, "tools": true, "context": 32768 } }
}
```

- **Add a provider**: `id` + `baseURL` (any OpenAI-compatible server). Optional: `keyEnv` / `apiKey`, `free` (default `true`), `models` (used when the server has no `/models`), `headers`, `discover: false`.
- **Override or disable a built-in**: use its `id` (`groq`, `ollama`, …) with the fields to change, or `"enabled": false`.
- **Aliases**: your own model names → any model name above.
- **Profiles**: correct a model's quality/capabilities if the router guesses wrong.
- Other keys: `allowPaid`, `port`, `host`, `apiKey`, `cors`, `maxAttempts` (default 4), `timeoutMs`, `builtins: false` (use only your own providers).

**Security:** the server listens on `127.0.0.1` only. If you use `--host 0.0.0.0`, also set `--api-key`. Browser requests are accepted only from localhost and the playground origin (`--cors` to change), so random websites can't spend your quota.

## Use it as a library

```js
import { createRouter, createHandler, serve } from '@sugeerth/llm-router';

const router = await createRouter({ providers: [{ id: 'mine', baseURL: 'http://localhost:8000/v1' }] });
const { json, route } = await router.complete({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] });
console.log(json.choices[0].message.content, route.model);

await serve(createHandler(router), { port: 4000 });   // or mount createHandler(router) in Bun/Deno: it's (Request) => Response
```

## Endpoints

| Endpoint | |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible: streaming, tools, images, JSON mode |
| `GET /v1/models` | `auto`, `fast`, `best`, `local`, your aliases, and every routable model |
| `POST /v1/messages` | Anthropic-compatible: streaming, tools, images |
| `POST /v1/messages/count_tokens` | approximate token count |
| `GET /v1/router` | provider status + recent routing decisions (never shows keys or prompts) |
| `GET /health` | liveness |

## Browser playground

The original in-browser demo still lives at **https://sugeerth.github.io/llm-router/** (`index.html`, `js/`). It shows the analyzer and scoring behind every decision and runs the FrugalGPT-style Smart Cost Cascade with your own keys. The server reuses its analyzer (`js/analyzer.js`).

## Development

```bash
npm test                          # 29 tests: unit + fake providers over real HTTP (no keys, no network)
node bin/llm-router.js models     # what's connected
node bin/llm-router.js --help
```

Layout: `src/router.js` (routing + failover), `src/providers.js` (provider catalog: add one here), `src/profiles.js` (model knowledge), `src/anthropic.js` (Messages API translation), `src/server.js` (HTTP), `bin/llm-router.js` (CLI).

## License

MIT
