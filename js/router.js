/**
 * LLM Router - The core routing engine.
 *
 * Scoring algorithm:
 *   FinalScore = w_task * TaskMatch
 *              + w_complexity * ComplexityFit
 *              + w_cost * CostScore
 *              + w_speed * SpeedScore
 *              + w_context * ContextFit
 *              + PriorityBonus
 *              + ReasoningBonus
 *
 * Each signal is normalized to [0, 1]. Weights are user-configurable.
 * Priority mode shifts weights to favor quality, speed, or cost.
 */

import { MODELS, TASK_TYPES, getProvider } from './models.js';
import { QueryAnalyzer } from './analyzer.js';

const DEFAULT_WEIGHTS = {
    task: 1.2,
    complexity: 1.0,
    cost: 0.8,
    speed: 0.7,
    context: 0.5,
};

const PRIORITY_PRESETS = {
    balanced: { task: 1.2, complexity: 1.0, cost: 0.8, speed: 0.7, context: 0.5 },
    quality:  { task: 1.5, complexity: 1.3, cost: 0.2, speed: 0.2, context: 0.5 },
    speed:    { task: 0.8, complexity: 0.5, cost: 0.4, speed: 1.5, context: 0.3 },
    cost:     { task: 0.8, complexity: 0.6, cost: 1.5, speed: 0.5, context: 0.3 },
};

export class LLMRouter {
    constructor() {
        this.analyzer = new QueryAnalyzer();
        this.weights = { ...DEFAULT_WEIGHTS };
        this.models = MODELS;
    }

    setWeights(weights) {
        this.weights = { ...this.weights, ...weights };
    }

    setPriority(priority) {
        if (PRIORITY_PRESETS[priority]) {
            this.weights = { ...PRIORITY_PRESETS[priority] };
        }
    }

    /**
     * Route a query to the best model.
     * Returns a full routing decision with scores, analysis, and explanation.
     */
    route(query, priority = 'balanced') {
        const startTime = performance.now();

        this.setPriority(priority);
        const analysis = this.analyzer.analyze(query);
        if (!analysis) return null;

        const scoredModels = this.models.map(model => {
            const signals = this._computeSignals(model, analysis);
            const totalScore = this._computeTotal(signals);
            return { model, signals, totalScore };
        });

        // Sort by total score descending
        scoredModels.sort((a, b) => b.totalScore - a.totalScore);

        const recommended = scoredModels[0];
        const explanation = this._buildExplanation(recommended, scoredModels, analysis);

        const routingTime = performance.now() - startTime;

        return {
            analysis,
            recommended: recommended.model,
            recommendedSignals: recommended.signals,
            recommendedScore: recommended.totalScore,
            allScores: scoredModels,
            explanation,
            routingTimeMs: Math.round(routingTime * 100) / 100,
            weights: { ...this.weights },
        };
    }

    /**
     * Compute individual signal scores for a model given the analysis.
     */
    _computeSignals(model, analysis) {
        return {
            taskMatch: this._scoreTaskMatch(model, analysis),
            complexityFit: this._scoreComplexityFit(model, analysis),
            costScore: this._scoreCost(model, analysis),
            speedScore: this._scoreSpeed(model),
            contextFit: this._scoreContextFit(model, analysis),
            reasoningBonus: this._scoreReasoningBonus(model, analysis),
        };
    }

    /**
     * Task Match: How well does this model perform on the identified task type?
     * Uses primary task strength as base, with secondary task bonuses.
     */
    _scoreTaskMatch(model, analysis) {
        const primaryStrength = model.strengths[analysis.primaryTask] || 0.5;

        // Weighted average with secondary tasks
        let secondaryBoost = 0;
        for (const task of analysis.secondaryTasks) {
            secondaryBoost += (model.strengths[task] || 0.5) * 0.15;
        }

        // Cross-task versatility bonus for multi-faceted queries
        if (analysis.secondaryTasks.length >= 2) {
            const avgStrength = Object.values(model.strengths).reduce((a, b) => a + b, 0)
                / Object.values(model.strengths).length;
            secondaryBoost += avgStrength * 0.05;
        }

        return Math.min(1, primaryStrength * 0.8 + secondaryBoost);
    }

    /**
     * Complexity Fit: Is the query's complexity within this model's sweet spot?
     * Models have a complexity range [min, max] where they perform best.
     * Queries outside this range are penalized.
     */
    _scoreComplexityFit(model, analysis) {
        const c = analysis.complexity;
        const [min, max] = model.complexityRange;

        if (c >= min && c <= max) {
            // Perfect fit - score based on how centered the query is
            const center = (min + max) / 2;
            const range = (max - min) / 2;
            const distFromCenter = Math.abs(c - center) / range;
            return 0.85 + (1 - distFromCenter) * 0.15;
        }

        // Outside range - penalize based on distance
        if (c < min) {
            // Query is simpler than model's sweet spot - model is overkill
            // Less severe penalty (still works, just wasteful)
            const distance = min - c;
            return Math.max(0.3, 0.85 - distance * 1.2);
        }

        // Query is more complex than model can handle well
        // More severe penalty
        const distance = c - max;
        return Math.max(0.1, 0.85 - distance * 2.0);
    }

    /**
     * Cost Score: How cost-efficient is this model for the estimated workload?
     * Normalized so the cheapest model scores 1.0.
     */
    _scoreCost(model, analysis) {
        const estimatedCost = (analysis.tokenEstimate / 1000) * model.costPer1kInput
            + (analysis.expectedOutputLength / 1000) * model.costPer1kOutput;

        // Find min and max cost across all models
        let minCost = Infinity, maxCost = 0;
        for (const m of this.models) {
            const cost = (analysis.tokenEstimate / 1000) * m.costPer1kInput
                + (analysis.expectedOutputLength / 1000) * m.costPer1kOutput;
            minCost = Math.min(minCost, cost);
            maxCost = Math.max(maxCost, cost);
        }

        if (maxCost === minCost) return 1;
        // Invert: lower cost = higher score
        return 1 - (estimatedCost - minCost) / (maxCost - minCost);
    }

    /**
     * Speed Score: How fast is this model?
     * Considers both latency (time to first token) and throughput.
     */
    _scoreSpeed(model) {
        // Normalize latency (lower is better)
        const maxLatency = Math.max(...this.models.map(m => m.latencyMs));
        const minLatency = Math.min(...this.models.map(m => m.latencyMs));
        const latencyScore = maxLatency === minLatency ? 1 :
            1 - (model.latencyMs - minLatency) / (maxLatency - minLatency);

        // Normalize throughput (higher is better)
        const maxTps = Math.max(...this.models.map(m => m.tokensPerSecond));
        const minTps = Math.min(...this.models.map(m => m.tokensPerSecond));
        const tpsScore = maxTps === minTps ? 1 :
            (model.tokensPerSecond - minTps) / (maxTps - minTps);

        return latencyScore * 0.4 + tpsScore * 0.6;
    }

    /**
     * Context Fit: Does the model's context window accommodate the query?
     * Penalizes models where the query might exceed context limits.
     */
    _scoreContextFit(model, analysis) {
        const totalTokens = analysis.tokenEstimate + analysis.expectedOutputLength;
        const utilization = totalTokens / model.contextWindow;

        if (utilization > 0.9) return 0.2;  // Dangerously close to limit
        if (utilization > 0.7) return 0.5;
        if (utilization > 0.5) return 0.7;
        return 1.0;
    }

    /**
     * Reasoning Bonus: Extra score for reasoning-capable models when the
     * query requires step-by-step reasoning.
     */
    _scoreReasoningBonus(model, analysis) {
        if (!analysis.requiresReasoning) return 0;

        // Models known for strong reasoning
        const reasoningModels = {
            'o3-mini': 0.15,
            'deepseek-r1': 0.12,
            'claude-opus-4': 0.10,
            'gemini-2.5-pro': 0.08,
            'claude-sonnet-4': 0.06,
            'gpt-4o': 0.05,
        };

        return reasoningModels[model.id] || 0;
    }

    /**
     * Compute weighted total score from individual signals.
     */
    _computeTotal(signals) {
        const w = this.weights;
        return signals.taskMatch * w.task
            + signals.complexityFit * w.complexity
            + signals.costScore * w.cost
            + signals.speedScore * w.speed
            + signals.contextFit * w.context
            + signals.reasoningBonus * 2.0;  // Reasoning bonus has its own scale
    }

    /**
     * Build a human-readable explanation of the routing decision.
     */
    _buildExplanation(recommended, allScores, analysis) {
        const model = recommended.model;
        const provider = getProvider(model);
        const signals = recommended.signals;

        const parts = [];

        // Primary reason
        const taskName = analysis.primaryTask.replace(/_/g, ' ');
        parts.push(`**${model.name}** was selected as the optimal model for this ${taskName} query.`);

        // Complexity assessment
        const complexityLabel = analysis.complexity < 0.3 ? 'simple' :
            analysis.complexity < 0.6 ? 'moderate' : 'complex';
        parts.push(`The query was classified as **${complexityLabel}** (complexity: ${(analysis.complexity * 100).toFixed(0)}%).`);

        // Key strengths
        const topSignals = Object.entries(signals)
            .filter(([k]) => k !== 'reasoningBonus')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2);

        const signalNames = {
            taskMatch: 'task specialization',
            complexityFit: 'complexity match',
            costScore: 'cost efficiency',
            speedScore: 'response speed',
            contextFit: 'context capacity',
        };

        const strengthList = topSignals.map(([k, v]) =>
            `${signalNames[k]} (${(v * 100).toFixed(0)}%)`
        ).join(' and ');
        parts.push(`Key strengths: ${strengthList}.`);

        // Reasoning note
        if (analysis.requiresReasoning && signals.reasoningBonus > 0) {
            parts.push(`This query benefits from step-by-step reasoning, where ${model.name} excels.`);
        }

        // Runner up
        if (allScores.length > 1) {
            const runnerUp = allScores[1];
            const scoreDiff = recommended.totalScore - runnerUp.totalScore;
            if (scoreDiff < 0.2) {
                parts.push(`Close alternative: **${runnerUp.model.name}** (scored within ${(scoreDiff * 100).toFixed(1)} points).`);
            }
        }

        // Cost estimate
        const estCost = (analysis.tokenEstimate / 1000) * model.costPer1kInput
            + (analysis.expectedOutputLength / 1000) * model.costPer1kOutput;
        parts.push(`Estimated cost: **$${estCost.toFixed(5)}** (~${analysis.tokenEstimate} input + ~${analysis.expectedOutputLength} output tokens).`);

        return parts.join('\n\n');
    }
}
