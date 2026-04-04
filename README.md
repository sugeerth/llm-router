# LLM Router

> Intelligent model routing for every query. Automatically selects the optimal LLM based on task type, complexity, cost, speed, and capability matching.

**[Try it live](https://your-username.github.io/llm-router/)** | No backend required - runs entirely in your browser.

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

- **Instant routing** - Sub-millisecond analysis and scoring
- **Route & Execute** - Optionally call the recommended model with your API keys
- **Benchmark mode** - Test the router against 18 curated queries spanning all task types
- **Configurable weights** - Fine-tune the scoring algorithm via sliders
- **Model registry** - Browse all models with capabilities, pricing, and strengths
- **OpenRouter support** - Use a single API key to access all models
- **Privacy-first** - No data leaves your browser. API keys stored in localStorage only.

## Running Locally

```bash
# Clone the repo
git clone https://github.com/your-username/llm-router.git
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
  executor.js       - API client for OpenAI, Anthropic, Google, OpenRouter
  ui.js             - DOM rendering and visualization
  app.js            - Event handlers and app orchestration
css/
  style.css         - Dark theme UI
```

## License

MIT
