# LLM Router

> Frontier-quality answers at a fraction of the cost. Bring your own API keys and the **Smart Cost Cascade** runs the cheapest capable model first, grades the answer, and escalates to a stronger model only when it must.

**[Try it live](https://sugeerth.github.io/llm-router/)** | No backend required — runs entirely in your browser, your keys never leave your device.

---

## ⚡ Smart Cost Cascade (the headline feature)

Paste one API key (an [OpenRouter](https://openrouter.ai) key unlocks every model in-browser) and hit **Smart Cascade**. Instead of paying frontier prices on every query, the cascade:

1. **Tries the cheapest capable model first** for your query.
2. **Grades the answer** with a small, cheap judge model against a complexity-aware quality bar.
3. **Escalates** to the next-stronger model only if the answer falls short — stopping the moment the bar is met.
4. The most capable model you have access to is always the final rung, so quality never drops below "just use the best model."

You watch the whole decision live: which models it tried, what each scored, what each cost, and **how much you saved versus always calling the frontier model** (often 80–99% on easy and medium queries). A running session total tracks cumulative savings, and you can tune the quality bar from *thrifty* to *strict* in Settings.

> This is the [FrugalGPT](https://arxiv.org/abs/2305.05176) idea made usable: cascade-with-grading in your browser — no backend, your keys only on your device.

---

## How It Works

LLM Router analyzes your query through a multi-signal pipeline and scores every model to find the best match:

### 1. Query Analysis
- **Task Classification** - Identifies the task type (code generation, creative writing, math reasoning, analysis, etc.) using pattern matching across 12 task categories
- **Complexity Estimation** - Multi-signal scoring: query length, vocabulary sophistication, structural complexity, domain signals, explicit markers, and cross-domain detection
- **Constraint Extraction** - Detects language, format, length, and style requirements

### 2. Model Scoring
Each model is scored across 5 weighted dimensions:

| Signal | What it measures |
|--------|-----------------|
| **Task Match** | How well the model performs on the identified task type |
| **Complexity Fit** | Whether the query falls in the model's complexity sweet spot |
| **Cost Efficiency** | Cost per estimated input + output tokens |
| **Speed** | First-token latency + generation throughput |
| **Context Fit** | Whether the model's context window accommodates the query |

Plus a **Reasoning Bonus** for queries that benefit from chain-of-thought models (o3-mini, DeepSeek R1, etc).

### 3. Priority Modes
- **Balanced** - Default weights across all signals
- **Max Quality** - Heavily weights task match and complexity fit
- **Max Speed** - Prioritizes low-latency, high-throughput models
- **Min Cost** - Favors the cheapest model that can handle the task

## Supported Models

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-4o, GPT-4o Mini, o3-mini |
| **Anthropic** | Claude Opus 4, Claude Sonnet 4, Claude Haiku 3.5 |
| **Google** | Gemini 2.5 Pro, Gemini 2.0 Flash |
| **Meta** | Llama 3.3 70B |
| **Mistral** | Mistral Large |
| **DeepSeek** | DeepSeek R1, DeepSeek V3 |

## Features

- **Smart Cost Cascade** - Cheapest-capable-first execution with answer grading and automatic escalation; live cost trace + savings vs. always-frontier
- **Session savings tracker** - Cumulative "you saved $X (Y%)" across all your queries
- **Instant routing** - Sub-millisecond analysis and scoring
- **Route & Execute** - Optionally call a single recommended model with your API keys
- **Benchmark mode** - Test the router against 18 curated queries spanning all task types
- **Configurable weights** - Fine-tune the scoring algorithm via sliders
- **Model registry** - Browse all models with capabilities, pricing, and strengths
- **OpenRouter support** - Use a single API key to access all models
- **Privacy-first** - No data leaves your browser. API keys stored in localStorage only.

## Running Locally

```bash
# Clone the repo
git clone https://github.com/sugeerth/llm-router.git
cd llm-router

# Serve with any static server
python3 -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080

## API Keys (Optional)

To use the "Route & Execute" feature, add API keys in Settings:

- **OpenRouter** (recommended) - Single key accesses all models
- **OpenAI** - For GPT-4o, GPT-4o Mini, o3-mini
- **Anthropic** - For Claude models
- **Google AI** - For Gemini models

Keys are stored in your browser's localStorage and never sent anywhere except to the respective API providers.

## Architecture

```
index.html          - Single page app shell
js/
  models.js         - Model registry with capabilities, pricing, strengths
  analyzer.js       - Query analysis: task classification, complexity, constraints
  router.js         - Core routing engine: multi-signal scoring algorithm
  cascade.js        - Smart Cost Cascade: cheapest-first execution, grading, escalation, savings
  executor.js       - API client for OpenAI, Anthropic, Google, OpenRouter
  ui.js             - DOM rendering and visualization
  app.js            - Event handlers and app orchestration
css/
  style.css         - Dark theme UI
```

## License

MIT
