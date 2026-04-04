/**
 * UI Renderer - All DOM manipulation and rendering logic.
 */

import { PROVIDERS, MODELS, TASK_TYPES, getProvider } from './models.js';

const TASK_LABELS = {
    [TASK_TYPES.CODE_GENERATION]: 'Code Generation',
    [TASK_TYPES.CODE_DEBUG]: 'Code Debugging',
    [TASK_TYPES.CREATIVE_WRITING]: 'Creative Writing',
    [TASK_TYPES.ANALYSIS]: 'Analysis',
    [TASK_TYPES.MATH_REASONING]: 'Math & Reasoning',
    [TASK_TYPES.SUMMARIZATION]: 'Summarization',
    [TASK_TYPES.TRANSLATION]: 'Translation',
    [TASK_TYPES.CONVERSATION]: 'Conversation',
    [TASK_TYPES.FACTUAL_QA]: 'Factual Q&A',
    [TASK_TYPES.SYSTEM_DESIGN]: 'System Design',
    [TASK_TYPES.DATA_EXTRACTION]: 'Data Extraction',
    [TASK_TYPES.INSTRUCTION_FOLLOWING]: 'Instruction Following',
};

const TASK_ICONS = {
    [TASK_TYPES.CODE_GENERATION]: '&#x1f4bb;',
    [TASK_TYPES.CODE_DEBUG]: '&#x1f41b;',
    [TASK_TYPES.CREATIVE_WRITING]: '&#x270d;',
    [TASK_TYPES.ANALYSIS]: '&#x1f50d;',
    [TASK_TYPES.MATH_REASONING]: '&#x1f9ee;',
    [TASK_TYPES.SUMMARIZATION]: '&#x1f4cb;',
    [TASK_TYPES.TRANSLATION]: '&#x1f310;',
    [TASK_TYPES.CONVERSATION]: '&#x1f4ac;',
    [TASK_TYPES.FACTUAL_QA]: '&#x2753;',
    [TASK_TYPES.SYSTEM_DESIGN]: '&#x1f3d7;',
    [TASK_TYPES.DATA_EXTRACTION]: '&#x1f4e6;',
    [TASK_TYPES.INSTRUCTION_FOLLOWING]: '&#x2705;',
};

export class UIRenderer {
    renderRoutingResult(result) {
        const { analysis, recommended, recommendedSignals, recommendedScore, allScores, explanation } = result;
        const provider = getProvider(recommended);

        // Recommended model card
        const recEl = document.getElementById('recommended-model');
        recEl.innerHTML = `
            <div class="rec-card" style="--provider-color: ${provider.color}">
                <div class="rec-badge">RECOMMENDED</div>
                <div class="rec-main">
                    <div class="rec-model-info">
                        <span class="provider-icon" style="background: ${provider.color}">${provider.icon}</span>
                        <div>
                            <h2 class="rec-model-name">${recommended.name}</h2>
                            <span class="rec-provider">${provider.name}</span>
                            <span class="rec-tier tier-${recommended.tier}">${recommended.tier}</span>
                        </div>
                    </div>
                    <div class="rec-score">
                        <div class="score-ring" style="--score: ${recommendedScore / (result.weights.task + result.weights.complexity + result.weights.cost + result.weights.speed + result.weights.context + 0.3)}; --color: ${provider.color}">
                            <span class="score-value">${(recommendedScore).toFixed(2)}</span>
                        </div>
                        <span class="score-label">Score</span>
                    </div>
                </div>
                <div class="rec-signals">
                    ${this._renderSignalBars(recommendedSignals, provider.color)}
                </div>
                <div class="rec-meta">
                    <div class="meta-item">
                        <span class="meta-label">Latency</span>
                        <span class="meta-value">${recommended.latencyMs}ms</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Speed</span>
                        <span class="meta-value">${recommended.tokensPerSecond} tok/s</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Context</span>
                        <span class="meta-value">${(recommended.contextWindow / 1000).toFixed(0)}K</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Quality</span>
                        <span class="meta-value">${(recommended.qualityScore * 100).toFixed(0)}%</span>
                    </div>
                </div>
            </div>
        `;

        // Analysis breakdown
        const analysisEl = document.getElementById('analysis-breakdown');
        analysisEl.innerHTML = `
            <div class="analysis-card">
                <div class="analysis-icon">${TASK_ICONS[analysis.primaryTask] || '&#x2753;'}</div>
                <div class="analysis-label">Primary Task</div>
                <div class="analysis-value">${TASK_LABELS[analysis.primaryTask] || analysis.primaryTask}</div>
            </div>
            <div class="analysis-card">
                <div class="analysis-icon">&#x1f4ca;</div>
                <div class="analysis-label">Complexity</div>
                <div class="analysis-value">
                    <div class="complexity-bar">
                        <div class="complexity-fill" style="width: ${analysis.complexity * 100}%; background: ${this._complexityColor(analysis.complexity)}"></div>
                    </div>
                    <span>${(analysis.complexity * 100).toFixed(0)}%</span>
                </div>
            </div>
            <div class="analysis-card">
                <div class="analysis-icon">&#x1f4dd;</div>
                <div class="analysis-label">Est. Input</div>
                <div class="analysis-value">~${analysis.tokenEstimate} tokens</div>
            </div>
            <div class="analysis-card">
                <div class="analysis-icon">&#x1f4e4;</div>
                <div class="analysis-label">Est. Output</div>
                <div class="analysis-value">~${analysis.expectedOutputLength} tokens</div>
            </div>
            ${analysis.requiresReasoning ? `
            <div class="analysis-card highlight">
                <div class="analysis-icon">&#x1f9e0;</div>
                <div class="analysis-label">Reasoning</div>
                <div class="analysis-value">Required</div>
            </div>` : ''}
            ${analysis.secondaryTasks.length > 0 ? `
            <div class="analysis-card">
                <div class="analysis-icon">&#x1f4cc;</div>
                <div class="analysis-label">Secondary</div>
                <div class="analysis-value secondary-tasks">${analysis.secondaryTasks.map(t => TASK_LABELS[t] || t).join(', ')}</div>
            </div>` : ''}
        `;

        // Model scores
        const scoresEl = document.getElementById('model-scores');
        const maxScore = allScores[0].totalScore;
        scoresEl.innerHTML = allScores.map((item, i) => {
            const p = getProvider(item.model);
            const pct = (item.totalScore / maxScore) * 100;
            return `
                <div class="score-row ${i === 0 ? 'top' : ''}">
                    <div class="score-rank">${i + 1}</div>
                    <span class="provider-dot-small" style="background: ${p.color}"></span>
                    <span class="score-model-name">${item.model.name}</span>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" style="width: ${pct}%; background: ${p.color}"></div>
                    </div>
                    <span class="score-number">${item.totalScore.toFixed(2)}</span>
                </div>
            `;
        }).join('');

        // Explanation
        const explEl = document.getElementById('routing-explanation');
        explEl.innerHTML = this._renderMarkdown(explanation);

        // Show results, hide empty state
        document.getElementById('empty-state').classList.add('hidden');
        document.getElementById('routing-results').classList.remove('hidden');

        // Routing time
        const timeEl = document.getElementById('routing-time');
        timeEl.textContent = `Routed in ${result.routingTimeMs.toFixed(1)}ms`;
        timeEl.classList.remove('hidden');
    }

    _renderSignalBars(signals, color) {
        const signalDefs = [
            { key: 'taskMatch', label: 'Task Match' },
            { key: 'complexityFit', label: 'Complexity Fit' },
            { key: 'costScore', label: 'Cost Efficiency' },
            { key: 'speedScore', label: 'Speed' },
            { key: 'contextFit', label: 'Context Fit' },
        ];

        return `<div class="signal-bars">
            ${signalDefs.map(({ key, label }) => {
                const val = signals[key];
                return `
                    <div class="signal-bar-item">
                        <span class="signal-label">${label}</span>
                        <div class="signal-track">
                            <div class="signal-fill" style="width: ${val * 100}%; background: ${color}"></div>
                        </div>
                        <span class="signal-value">${(val * 100).toFixed(0)}%</span>
                    </div>
                `;
            }).join('')}
        </div>`;
    }

    _complexityColor(c) {
        if (c < 0.3) return '#22c55e';
        if (c < 0.6) return '#eab308';
        if (c < 0.8) return '#f97316';
        return '#ef4444';
    }

    _renderMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
    }

    renderExecutionResult(result) {
        const el = document.getElementById('execution-results');
        document.getElementById('exec-model').textContent = result.model;
        document.getElementById('exec-time').textContent = `${result.latencyMs}ms`;
        document.getElementById('exec-tokens').textContent = result.usage?.total_tokens
            ? `${result.usage.total_tokens} tokens`
            : '';

        const responseEl = document.getElementById('exec-response');
        // Simple markdown-ish rendering
        let html = this._escapeHtml(result.content);
        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');

        responseEl.innerHTML = html;
        el.classList.remove('hidden');
    }

    renderExecutionError(error) {
        const el = document.getElementById('execution-results');
        document.getElementById('exec-model').textContent = 'Error';
        document.getElementById('exec-time').textContent = '';
        document.getElementById('exec-tokens').textContent = '';
        document.getElementById('exec-response').innerHTML = `<div class="exec-error">${this._escapeHtml(error.message)}</div>`;
        el.classList.remove('hidden');
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    renderModelRegistry() {
        const el = document.getElementById('model-registry');
        const grouped = {};
        for (const model of MODELS) {
            if (!grouped[model.provider]) grouped[model.provider] = [];
            grouped[model.provider].push(model);
        }

        el.innerHTML = Object.entries(grouped).map(([providerId, models]) => {
            const provider = PROVIDERS[providerId];
            return `
                <div class="provider-section">
                    <h3 class="provider-heading">
                        <span class="provider-icon-small" style="background: ${provider.color}">${provider.icon}</span>
                        ${provider.name}
                    </h3>
                    <div class="model-cards">
                        ${models.map(m => this._renderModelCard(m, provider)).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    _renderModelCard(model, provider) {
        const topStrengths = Object.entries(model.strengths)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([task, score]) => `<span class="strength-tag">${TASK_LABELS[task] || task} ${(score * 100).toFixed(0)}%</span>`)
            .join('');

        return `
            <div class="model-card" style="--provider-color: ${provider.color}">
                <div class="model-card-header">
                    <h4>${model.name}</h4>
                    <span class="tier-badge tier-${model.tier}">${model.tier}</span>
                </div>
                <div class="model-card-stats">
                    <div class="stat">
                        <span class="stat-label">Quality</span>
                        <span class="stat-value">${(model.qualityScore * 100).toFixed(0)}%</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Context</span>
                        <span class="stat-value">${(model.contextWindow / 1000).toFixed(0)}K</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Speed</span>
                        <span class="stat-value">${model.tokensPerSecond} t/s</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Input</span>
                        <span class="stat-value">$${model.costPer1kInput}/1K</span>
                    </div>
                </div>
                <div class="model-card-complexity">
                    <span class="stat-label">Complexity Range</span>
                    <div class="range-bar">
                        <div class="range-fill" style="left: ${model.complexityRange[0] * 100}%; width: ${(model.complexityRange[1] - model.complexityRange[0]) * 100}%; background: ${provider.color}"></div>
                    </div>
                </div>
                <div class="model-card-strengths">
                    ${topStrengths}
                </div>
            </div>
        `;
    }

    renderBenchmarkResults(results) {
        const el = document.getElementById('benchmark-results');
        el.innerHTML = `
            <div class="benchmark-summary">
                <div class="bench-stat">
                    <span class="bench-stat-value">${results.length}</span>
                    <span class="bench-stat-label">Queries Tested</span>
                </div>
                <div class="bench-stat">
                    <span class="bench-stat-value">${new Set(results.map(r => r.recommended.id)).size}</span>
                    <span class="bench-stat-label">Unique Models Selected</span>
                </div>
                <div class="bench-stat">
                    <span class="bench-stat-value">${(results.reduce((s, r) => s + r.routingTimeMs, 0) / results.length).toFixed(1)}ms</span>
                    <span class="bench-stat-label">Avg Routing Time</span>
                </div>
            </div>
            <div class="benchmark-table-wrapper">
                <table class="benchmark-table">
                    <thead>
                        <tr>
                            <th>Query</th>
                            <th>Task</th>
                            <th>Complexity</th>
                            <th>Recommended</th>
                            <th>Score</th>
                            <th>Runner-up</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${results.map(r => {
                            const p = getProvider(r.recommended);
                            const runnerUp = r.allScores[1];
                            const rup = getProvider(runnerUp.model);
                            return `
                                <tr>
                                    <td class="bench-query">${this._escapeHtml(r.analysis.query.slice(0, 80))}${r.analysis.query.length > 80 ? '...' : ''}</td>
                                    <td><span class="task-tag">${TASK_LABELS[r.analysis.primaryTask] || r.analysis.primaryTask}</span></td>
                                    <td>
                                        <div class="mini-complexity">
                                            <div class="mini-bar" style="width: ${r.analysis.complexity * 100}%; background: ${this._complexityColor(r.analysis.complexity)}"></div>
                                        </div>
                                        ${(r.analysis.complexity * 100).toFixed(0)}%
                                    </td>
                                    <td>
                                        <span class="provider-dot-small" style="background: ${p.color}"></span>
                                        ${r.recommended.name}
                                    </td>
                                    <td class="bench-score">${r.recommendedScore.toFixed(2)}</td>
                                    <td>
                                        <span class="provider-dot-small" style="background: ${rup.color}"></span>
                                        ${runnerUp.model.name}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    showLoading(element) {
        element.classList.add('loading');
    }

    hideLoading(element) {
        element.classList.remove('loading');
    }
}
