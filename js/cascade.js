/**
 * Cost Cascade - FrugalGPT-style execution.
 *
 * Instead of paying for a frontier model on every query, the cascade runs the
 * CHEAPEST capable model first, has a small/cheap model GRADE the answer, and
 * only ESCALATES to a stronger (pricier) model when the answer falls short of a
 * complexity-aware quality bar. The last rung is always the most capable model
 * you have access to, so quality never regresses below "just use the best model".
 *
 * The result is frontier-grade answers at a fraction of the cost — and every
 * decision (what it tried, what it scored, what it cost, what it saved) is shown.
 */

import { MODELS } from './models.js';

/** Estimated USD cost for a model given input/output token counts. */
export function costFor(model, inputTokens, outputTokens) {
    return (inputTokens / 1000) * model.costPer1kInput
        + (outputTokens / 1000) * model.costPer1kOutput;
}

/** Normalize the many provider usage shapes to { input, output } or null. */
export function normUsage(u) {
    if (!u) return null;
    const input = u.input ?? u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount;
    const output = u.output ?? u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount;
    if (input == null && output == null) return null;
    return { input: Number(input) || 0, output: Number(output) || 0 };
}

const approxTokens = (s) => Math.max(1, Math.ceil((s || '').length / 4));

/** Free, blunt fallback grader used only when the judge model is unavailable. */
function heuristicScore(query, answer) {
    const a = (answer || '').trim();
    if (!a) return 0;
    let s = 72;
    if (/\b(i (can'?t|cannot|am unable|won'?t|do not have)|i'?m sorry|as an ai|i cannot help)\b/i.test(a)) s -= 45;
    if (a.length < 40) s -= 28;
    if (a.length > 220) s += 8;
    // Code-ish asks should produce code-ish answers
    if (/\b(code|function|implement|script|debug|refactor|class|algorithm)\b/i.test(query)
        && !/```|def |class |function |=>|;\n/.test(a)) s -= 16;
    return Math.max(0, Math.min(100, s));
}

export class CostCascade {
    constructor(executor) {
        this.executor = executor;
    }

    /** Models the user can actually call right now (native key or OpenRouter). */
    availableModels() {
        return MODELS.filter(m => this.executor.hasKeyFor(m));
    }

    /** Cheapest available model — used as the answer grader to keep judging costs tiny. */
    pickJudge(available) {
        return [...available].sort((a, b) =>
            (a.costPer1kInput + a.costPer1kOutput) - (b.costPer1kInput + b.costPer1kOutput))[0];
    }

    /**
     * Build the escalation ladder: cheapest-capable models first, with the most
     * capable available model guaranteed as the final safety net. Capped at 4 rungs
     * so worst-case cost/latency stays bounded.
     */
    buildLadder(analysis, available) {
        const inT = analysis.tokenEstimate, outT = analysis.expectedOutputLength;
        let capable = available.filter(m => m.complexityRange[1] >= analysis.complexity - 0.12);
        if (!capable.length) capable = available.slice();

        const top = capable.reduce((a, b) => (b.qualityScore > a.qualityScore ? b : a), capable[0]);
        const byCost = [...capable].sort((a, b) => costFor(a, inT, outT) - costFor(b, inT, outT));

        const picked = [];
        const seen = new Set();
        for (const m of byCost) {
            if (picked.length >= 3) break;
            if (!seen.has(m.id)) { picked.push(m); seen.add(m.id); }
        }
        if (!seen.has(top.id)) { picked.push(top); seen.add(top.id); }
        picked.sort((a, b) => costFor(a, inT, outT) - costFor(b, inT, outT));
        return { ladder: picked, top };
    }

    /** Complexity-aware acceptance threshold (0-100), nudged by the user's quality bar. */
    qualityBar(analysis, userBar) {
        const base = 55 + analysis.complexity * 33;          // 55 (trivial) .. 88 (very hard)
        const shift = ((userBar == null ? 0.5 : userBar) - 0.5) * 30; // +/- 15
        return Math.round(Math.max(40, Math.min(96, base + shift)));
    }

    /** Have the cheap judge score an answer 0-100. Falls back to a heuristic. */
    async grade(query, answer, judge) {
        const prompt =
            `You are a strict grader. A user asked:\n"""${query}"""\n\n` +
            `A model answered:\n"""${answer}"""\n\n` +
            `Score the answer 0-100 for correctness, completeness, and how well it follows the ` +
            `request. Be critical. Reply with ONLY compact JSON: {"score": <int 0-100>, "reason": "<≤12 words>"}`;
        try {
            const r = await this.executor.execute(judge, prompt, {
                maxTokens: 120,
                system: 'You are a precise grader that outputs only minified JSON.',
                temperature: 0,
            });
            const match = (r.content || '').match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(match ? match[0] : r.content);
            let score = Number(parsed.score);
            if (!Number.isFinite(score)) throw new Error('no score');
            score = Math.max(0, Math.min(100, score));
            const u = normUsage(r.usage) || { input: approxTokens(prompt), output: approxTokens(r.content) };
            return { score, reason: String(parsed.reason || '').slice(0, 80), judgeCost: costFor(judge, u.input, u.output), heuristic: false };
        } catch (e) {
            return { score: heuristicScore(query, answer), reason: 'heuristic grade (judge unavailable)', judgeCost: 0, heuristic: true };
        }
    }

    /**
     * Run the cascade. Calls opts.onStep(state) after every state change so the UI
     * can animate the ladder live. Returns the full result with cost & savings.
     */
    async run(query, analysis, opts = {}) {
        const onStep = opts.onStep || (() => {});
        const available = this.availableModels();
        if (!available.length) {
            throw new Error('No API key set. Add an OpenRouter key (one key unlocks every model) in Settings to start.');
        }

        const { ladder, top } = this.buildLadder(analysis, available);
        const judge = this.pickJudge(available);
        const target = this.qualityBar(analysis, opts.qualityBar);

        const steps = [];
        let totalCost = 0;
        let accepted = null;

        const emit = () => onStep({ steps, target, judge, top, ladder, done: false });

        for (let i = 0; i < ladder.length; i++) {
            const model = ladder[i];
            const isLast = i === ladder.length - 1;
            const step = { model, status: 'running', cost: 0, score: null };
            steps.push(step);
            emit();

            let exec;
            try {
                exec = await this.executor.execute(model, query, { maxTokens: 4096 });
            } catch (err) {
                step.status = 'error';
                step.error = err.message;
                emit();
                if (isLast && !accepted) throw err; // nothing left to fall back to
                continue;
            }

            const u = normUsage(exec.usage) || { input: approxTokens(query), output: approxTokens(exec.content) };
            step.usage = u;
            step.answer = exec.content;
            step.latencyMs = exec.latencyMs;
            step.cost = costFor(model, u.input, u.output);
            totalCost += step.cost;

            // No higher rung to escalate to → accept without spending on a grade.
            if (isLast) {
                step.status = 'accepted';
                step.accepted = true;
                step.score = null;
                accepted = step;
                emit();
                break;
            }

            step.status = 'grading';
            emit();
            const g = await this.grade(query, exec.content, judge);
            step.score = g.score;
            step.gradeReason = g.reason;
            step.heuristic = g.heuristic;
            if (g.judgeCost) { step.judgeCost = g.judgeCost; totalCost += g.judgeCost; }

            if (g.score >= target) {
                step.status = 'accepted';
                step.accepted = true;
                accepted = step;
                emit();
                break;
            }
            step.status = 'escalated';
            emit();
        }

        if (!accepted) accepted = steps[steps.length - 1];

        // Baseline = what the most capable model alone would have cost for this exact
        // query (priced on the accepted answer's actual token counts).
        const baseIn = accepted.usage?.input ?? analysis.tokenEstimate;
        const baseOut = accepted.usage?.output ?? analysis.expectedOutputLength;
        const baselineCost = costFor(top, baseIn, baseOut);
        const savings = Math.max(0, baselineCost - totalCost);
        const savingsPct = baselineCost > 0 ? savings / baselineCost : 0;

        const result = {
            steps, accepted, target, judge, top, ladder,
            totalCost, baselineCost, savings, savingsPct,
            attempts: steps.length,
            done: true,
        };
        onStep(result);
        return result;
    }
}
