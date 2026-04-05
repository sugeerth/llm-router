/**
 * App - Main application controller.
 * Wires up the router, UI, executor, and event handlers.
 */

import { LLMRouter } from './router.js';
import { UIRenderer } from './ui.js';
import { ModelExecutor } from './executor.js';

const router = new LLMRouter();
const ui = new UIRenderer();
const executor = new ModelExecutor();

// Benchmark queries
const BENCHMARK_QUERIES = [
    "What is the capital of France?",
    "Write a haiku about autumn leaves falling",
    "Implement a trie data structure in Python with insert, search, and prefix matching. Include type hints.",
    "Explain the geopolitical implications of the CHIPS Act on global semiconductor supply chains. Consider US, China, Taiwan, and EU perspectives.",
    "Solve: Find the eigenvalues of the matrix [[3, 1], [1, 3]] and determine if it's positive definite.",
    "Fix this code: def fibonacci(n):\n    return fibonacci(n-1) + fibonacci(n-2)",
    "Translate 'The quick brown fox jumps over the lazy dog' into French, German, and Japanese.",
    "Summarize the key differences between REST and GraphQL APIs in a comparison table.",
    "Design a real-time notification system for a social media platform with 50M daily active users. Include architecture diagram description, data flow, and failure handling.",
    "Write a short story about a programmer who discovers their code has become sentient, in the style of Isaac Asimov.",
    "What is 2 + 2?",
    "Prove that the square root of 2 is irrational using proof by contradiction.",
    "Extract all email addresses and phone numbers from this text: Contact john@example.com or call 555-0123. Also reach out to jane.doe@company.org or (555) 987-6543.",
    "Analyze the trade-offs between microservices and monolithic architecture for a startup with 5 engineers building an e-commerce platform.",
    "Hello!",
    "Write a comprehensive Python script that scrapes a website, handles pagination, respects robots.txt, implements rate limiting, stores results in SQLite, and includes proper error handling and logging.",
    "Compare and contrast the economic theories of Keynes and Hayek, explaining how each would approach a modern recession.",
    "Refactor this JavaScript to use modern async/await:\nfunction getData(url, callback) {\n  var xhr = new XMLHttpRequest();\n  xhr.open('GET', url);\n  xhr.onload = function() { callback(null, JSON.parse(xhr.responseText)); };\n  xhr.onerror = function() { callback(new Error('Failed')); };\n  xhr.send();\n}",
];

// ──────────────────────────────────────────────
// Tab Navigation
// ──────────────────────────────────────────────

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${tab}`).classList.add('active');

        // Show/hide hero based on tab
        const hero = document.getElementById('hero-section');
        if (tab === 'router') {
            hero.style.display = '';
        } else {
            hero.style.display = 'none';
        }

        if (tab === 'models') ui.renderModelRegistry();
    });
});

// ──────────────────────────────────────────────
// Router Tab
// ──────────────────────────────────────────────

const queryInput = document.getElementById('query-input');
const charCount = document.getElementById('char-count');
const tokenEstimate = document.getElementById('token-estimate');

queryInput.addEventListener('input', () => {
    const len = queryInput.value.length;
    charCount.textContent = `${len} chars`;
    tokenEstimate.textContent = `~${Math.ceil(len / 4)} tokens`;
});

// Route button
document.getElementById('route-btn').addEventListener('click', () => {
    const query = queryInput.value.trim();
    if (!query) return;

    const priority = document.getElementById('priority-select').value;
    const result = router.route(query, priority);
    if (result) {
        ui.renderRoutingResult(result);
        document.getElementById('execution-results').classList.add('hidden');
    }
});

// Route & Execute button
document.getElementById('route-and-run-btn').addEventListener('click', async () => {
    const query = queryInput.value.trim();
    if (!query) return;

    const priority = document.getElementById('priority-select').value;
    const result = router.route(query, priority);
    if (!result) return;

    ui.renderRoutingResult(result);

    // Check if we have a key
    if (!executor.hasKeyFor(result.recommended)) {
        ui.renderExecutionError(new Error(
            `No API key for ${result.recommended.provider}. Add one in Settings, or add an OpenRouter key for universal access.`
        ));
        return;
    }

    // Show loading
    const execEl = document.getElementById('execution-results');
    execEl.classList.remove('hidden');
    document.getElementById('exec-response').innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    document.getElementById('exec-model').textContent = `Calling ${result.recommended.name}...`;
    document.getElementById('exec-time').textContent = '';
    document.getElementById('exec-tokens').textContent = '';

    try {
        const execResult = await executor.execute(result.recommended, query);
        ui.renderExecutionResult(execResult);
    } catch (error) {
        ui.renderExecutionError(error);
    }
});

// Clear button
document.getElementById('clear-btn').addEventListener('click', () => {
    queryInput.value = '';
    charCount.textContent = '0 chars';
    tokenEstimate.textContent = '~0 tokens';
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('routing-results').classList.add('hidden');
    document.getElementById('execution-results').classList.add('hidden');
    document.getElementById('routing-time').classList.add('hidden');
});

// Example chips
document.querySelectorAll('.chip[data-query]').forEach(chip => {
    chip.addEventListener('click', () => {
        queryInput.value = chip.dataset.query;
        queryInput.dispatchEvent(new Event('input'));
        // Auto-route
        document.getElementById('route-btn').click();
    });
});

// Keyboard shortcut
queryInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('route-btn').click();
    }
});

// ──────────────────────────────────────────────
// Benchmark Tab
// ──────────────────────────────────────────────

document.getElementById('run-benchmark').addEventListener('click', () => {
    const results = BENCHMARK_QUERIES.map(query => router.route(query, 'balanced'));
    ui.renderBenchmarkResults(results);
});

// ──────────────────────────────────────────────
// Settings Tab
// ──────────────────────────────────────────────

// Load saved keys
const savedKeys = executor.getKeys();
if (savedKeys.openai) document.getElementById('key-openai').value = savedKeys.openai;
if (savedKeys.anthropic) document.getElementById('key-anthropic').value = savedKeys.anthropic;
if (savedKeys.google) document.getElementById('key-google').value = savedKeys.google;
if (savedKeys.openrouter) document.getElementById('key-openrouter').value = savedKeys.openrouter;

document.getElementById('save-keys').addEventListener('click', () => {
    executor.saveKeys({
        openai: document.getElementById('key-openai').value.trim(),
        anthropic: document.getElementById('key-anthropic').value.trim(),
        google: document.getElementById('key-google').value.trim(),
        openrouter: document.getElementById('key-openrouter').value.trim(),
    });
    showToast('API keys saved');
});

document.getElementById('clear-keys').addEventListener('click', () => {
    executor.clearKeys();
    document.getElementById('key-openai').value = '';
    document.getElementById('key-anthropic').value = '';
    document.getElementById('key-google').value = '';
    document.getElementById('key-openrouter').value = '';
    showToast('API keys cleared');
});

// Toggle visibility buttons
document.querySelectorAll('.toggle-vis-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        input.type = input.type === 'password' ? 'text' : 'password';
    });
});

// Weight sliders
document.querySelectorAll('.weight-control input[type="range"]').forEach(slider => {
    const valueSpan = slider.parentElement.querySelector('.weight-value');
    slider.addEventListener('input', () => {
        valueSpan.textContent = slider.value;
    });

    slider.addEventListener('change', () => {
        const weightKey = slider.id.replace('weight-', '');
        router.setWeights({ [weightKey]: parseFloat(slider.value) });
    });
});

// ──────────────────────────────────────────────
// Toast notification
// ──────────────────────────────────────────────

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}
