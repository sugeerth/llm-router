#!/usr/bin/env node
/**
 * llm-router CLI
 *   llm-router [serve]        start the OpenAI + Anthropic compatible server (default)
 *   llm-router ask "prompt"   answer one prompt in the terminal (stdin is appended)
 *   llm-router models         show providers and every routable model
 */

import { Router, createHandler, serve, loadConfig, VERSION } from '../src/index.js';
import { STRATEGIES } from '../src/router.js';
import { DEFAULT_CORS } from '../src/server.js';

// Node 18 prints an ExperimentalWarning the first time fetch() runs; it is noise here.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => {
    if (String(w?.message || w).includes('Fetch API')) return;
    return emitWarning.call(process, w, ...rest);
};

const HELP = `llm-router ${VERSION} — one free endpoint for every LLM

Usage
  llm-router [serve] [--port 4000] [--host 127.0.0.1]   start the server
  llm-router ask "prompt" [--model auto|fast|best|local|<id>]
  llm-router models [--json]

Options
  --config <file>     config file (default ./llm-router.json or ~/.config/llm-router/config.json)
  --allow-paid        also route to paid models (off by default: you never pay)
  --api-key <key>     require clients to send this key (recommended with --host 0.0.0.0)
  --cors <origins>    comma-separated browser origins to allow ("*" for any)
  --quiet             no per-request log lines
  -v, --version       print version

Free providers are picked up from env vars (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY,
CEREBRAS_API_KEY, MISTRAL_API_KEY, GITHUB_TOKEN, ...). Local servers (Ollama, LM Studio,
llama.cpp, vLLM) are detected automatically. Docs: https://github.com/sugeerth/llm-router`;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), green = c(32), yellow = c(33), red = c(31), cyan = c(36);

function parseArgs(argv) {
    const flags = {}, rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') flags.help = true;
        else if (a === '-v' || a === '--version') flags.version = true;
        else if (a.startsWith('--')) {
            const [k, inline] = a.slice(2).split(/=(.*)/s);
            const boolean = ['allow-paid', 'quiet', 'json'].includes(k);
            flags[k] = boolean ? true : (inline ?? argv[++i]);
        } else rest.push(a);
    }
    const commands = ['serve', 'ask', 'models', 'help'];
    const cmd = commands.includes(rest[0]) ? rest.shift() : 'serve';
    return { cmd, flags, rest };
}

function buildOptions(flags, config) {
    const env = process.env;
    return {
        env,
        providers: config.providers || [],
        aliases: config.aliases || {},
        profiles: config.profiles || {},
        builtins: config.builtins,
        allowPaid: !!(flags['allow-paid'] || config.allowPaid || env.LLM_ROUTER_ALLOW_PAID === '1'),
        maxAttempts: config.maxAttempts,
        timeoutMs: config.timeoutMs,
    };
}

function providerLines(router) {
    const lines = [];
    for (const p of router.providers) {
        const s = router.status[p.id] || {};
        const tag = p.local ? 'local' : p.free ? 'free tier' : 'paid';
        if (s.state === 'ready') {
            lines.push(`  ${green('✓')} ${p.id.padEnd(11)} ${String(s.models).padStart(3)} model${s.models === 1 ? ' ' : 's'}  ${dim(`${tag} · ${p.baseURL}`)}`);
        } else if (s.state === 'error') {
            lines.push(`  ${red('✗')} ${p.id.padEnd(11)}       ${dim(s.error || 'error')}`);
        } else if (s.state === 'no-key' && p.free) {
            const key = [].concat(p.keyEnv)[0];
            lines.push(`  ${dim('·')} ${dim(p.id.padEnd(11))}       ${dim(`set ${key} (free: ${p.signup})`)}`);
        } else if (s.state === 'paid-off' && p.apiKey) {
            lines.push(`  ${dim('·')} ${dim(p.id.padEnd(11))}       ${dim('paid — key found, enable with --allow-paid')}`);
        }
    }
    const offline = router.providers.filter(p => p.local && router.status[p.id]?.state !== 'ready').map(p => p.id);
    if (offline.length) lines.push(`  ${dim('·')} ${dim(`local not running: ${offline.join(', ')} (auto-detected when started)`)}`);
    return lines.join('\n');
}

async function cmdServe(flags, config) {
    const port = Number(flags.port || config.port || process.env.LLM_ROUTER_PORT || process.env.PORT || 4000);
    const host = flags.host || config.host || process.env.LLM_ROUTER_HOST || '127.0.0.1';
    const apiKey = flags['api-key'] || config.apiKey || process.env.LLM_ROUTER_API_KEY || null;
    const corsArg = flags.cors || config.cors || process.env.LLM_ROUTER_CORS;
    const cors = corsArg ? [].concat(corsArg).flatMap(s => String(s).split(',')).map(s => s.trim()).filter(Boolean) : DEFAULT_CORS;

    const router = new Router({
        ...buildOptions(flags, config),
        onLog: flags.quiet ? null : (e) => {
            const status = e.status === 200 ? green(e.status) : red(e.status);
            const via = e.model ? cyan(e.model) : red('no model');
            const extra = [e.strategy, `${e.ms}ms`, e.attempts > 1 ? yellow(`${e.attempts} attempts`) : null, e.requested ? dim(`asked for ${e.requested}`) : null]
                .filter(Boolean).join(dim(' · '));
            console.error(`${dim(new Date().toLocaleTimeString())} ${status} ${via} ${dim('·')} ${extra}`);
            if (e.failed?.length) for (const f of e.failed) console.error(dim(`         ↳ skipped ${f.model}: ${f.status || 'network'} ${String(f.error || '').slice(0, 100)}`));
        },
    });
    await router.refresh();

    let server;
    try {
        server = await serve(createHandler(router, { apiKey, cors }), { port, host });
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            console.error(red(`Port ${port} is already in use. Try: llm-router --port ${port + 1}`));
            process.exit(1);
        }
        throw err;
    }
    router.startAutoRefresh();

    const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
    console.log(`\n${bold('llm-router')} ${VERSION} ${dim('— one free endpoint for every LLM')}\n`);
    console.log(providerLines(router));
    console.log(`\n  ${router.candidates.length ? green(`${router.candidates.length} models ready`) : yellow('No models yet — start Ollama/LM Studio or set a free key (see above). Local servers are picked up automatically.')}` +
        `  ${dim(router.options.allowPaid ? '· paid models allowed' : '· free models only')}`);
    console.log(`\n  ${bold('Chat app')}   ${cyan(base)}  ${dim('(open in your browser)')}`);
    console.log(`  ${bold('OpenAI')}     base_url ${cyan(`${base}/v1`)}   model ${cyan('"auto"')}  ${dim('(or fast · best · local · any id)')}`);
    console.log(`  ${bold('Anthropic')}  base_url ${cyan(base)}       ${dim('e.g. ANTHROPIC_BASE_URL=' + base + ' claude')}`);
    console.log(`  ${bold('API key')}    ${apiKey ? 'required (the one you set)' : dim('any value (none required)')}`);
    if (host !== '127.0.0.1' && host !== 'localhost' && !apiKey) {
        console.log(yellow(`\n  ! Listening on ${host} without --api-key: anyone on your network can use your providers.`));
    }
    console.log(dim(`\n  Try: curl ${base}/v1/chat/completions -H "content-type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'\n`));
    const stop = () => { server.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

async function readStdin() {
    if (process.stdin.isTTY) return '';
    const chunks = [];
    for await (const ch of process.stdin) chunks.push(ch);
    return Buffer.concat(chunks).toString('utf8').trim();
}

async function cmdAsk(flags, config, rest) {
    const prompt = rest.join(' ').trim();
    const stdin = await readStdin();
    const content = [prompt, stdin].filter(Boolean).join('\n\n');
    if (!content) {
        console.error('Usage: llm-router ask "your question"   (or pipe text in: cat file | llm-router ask "summarize")');
        process.exit(1);
    }
    const router = new Router(buildOptions(flags, config));
    await router.refresh();
    const t0 = Date.now();
    try {
        const { chunks, route } = await router.stream({ model: flags.model || 'auto', messages: [{ role: 'user', content }] });
        for await (const ch of chunks) {
            const d = ch.choices?.[0]?.delta?.content;
            if (d) process.stdout.write(d);
        }
        process.stdout.write('\n');
        const note = [route.model, route.strategy, `${((Date.now() - t0) / 1000).toFixed(1)}s`, route.attempts > 1 ? `${route.attempts} attempts` : null].filter(Boolean).join(' · ');
        process.stderr.write(dim(`↳ ${note}\n`));
    } catch (err) {
        console.error(red(err.message || String(err)));
        if (!router.candidates.length) console.error('\n' + providerLines(router));
        process.exit(1);
    }
}

async function cmdModels(flags, config) {
    const router = new Router(buildOptions(flags, config));
    await router.refresh();
    if (flags.json) {
        console.log(JSON.stringify(router.listModels(), null, 2));
        return;
    }
    console.log(`\n${bold('Providers')}\n${providerLines(router)}\n`);
    console.log(bold('Virtual models'));
    for (const [id, s] of Object.entries(STRATEGIES)) console.log(`  ${cyan(id.padEnd(8))} ${dim(s.about)}`);
    for (const [id, to] of Object.entries(router.aliases)) console.log(`  ${cyan(id.padEnd(8))} ${dim(`alias → ${to}`)}`);
    if (!router.candidates.length) {
        console.log(yellow('\nNo models available yet.'));
        return;
    }
    console.log(`\n${bold('Models')} ${dim('(quality = rough prior, not a benchmark)')}`);
    const sorted = [...router.candidates].sort((a, b) => a.provider.localeCompare(b.provider) || b.quality - a.quality);
    for (const m of sorted) {
        const flagsStr = [m.free ? green('free') : yellow('paid'), m.local ? 'local' : null, m.tools ? 'tools' : null, m.vision ? 'vision' : null, m.reasoning ? 'reasoning' : null]
            .filter(Boolean).join(' ');
        console.log(`  ${m.id.padEnd(58)} ${dim(`q${m.quality.toFixed(2)} · ${Math.round(m.contextWindow / 1000)}k ·`)} ${flagsStr}`);
    }
    console.log('');
}

async function main() {
    const { cmd, flags, rest } = parseArgs(process.argv.slice(2));
    if (flags.version) return console.log(VERSION);
    if (flags.help || cmd === 'help') return console.log(HELP);
    let config;
    try {
        config = loadConfig(flags.config);
    } catch (err) {
        console.error(red(err.message));
        process.exit(1);
    }
    if (cmd === 'ask') return cmdAsk(flags, config, rest);
    if (cmd === 'models') return cmdModels(flags, config);
    return cmdServe(flags, config);
}

main().catch((err) => {
    console.error(red(err.stack || err.message || String(err)));
    process.exit(1);
});
