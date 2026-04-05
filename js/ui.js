/**
 * UI Renderer - All DOM manipulation and rendering logic.
 * Provides deep insight into every routing decision.
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
    [TASK_TYPES.CODE_GENERATION]: '\u{1f4bb}',
    [TASK_TYPES.CODE_DEBUG]: '\u{1f41b}',
    [TASK_TYPES.CREATIVE_WRITING]: '\u270d\ufe0f',
    [TASK_TYPES.ANALYSIS]: '\u{1f50d}',
    [TASK_TYPES.MATH_REASONING]: '\u{1f9ee}',
    [TASK_TYPES.SUMMARIZATION]: '\u{1f4cb}',
    [TASK_TYPES.TRANSLATION]: '\u{1f310}',
    [TASK_TYPES.CONVERSATION]: '\u{1f4ac}',
    [TASK_TYPES.FACTUAL_QA]: '\u2753',
    [TASK_TYPES.SYSTEM_DESIGN]: '\u{1f3d7}\ufe0f',
    [TASK_TYPES.DATA_EXTRACTION]: '\u{1f4e6}',
    [TASK_TYPES.INSTRUCTION_FOLLOWING]: '\u2705',
};

export class UIRenderer {
    renderRoutingResult(result) {
        const { analysis, recommended, recommendedSignals, recommendedScore, allScores, explanation } = result;
        const provider = getProvider(recommended);

        // Routing Flow Visualization
        this._renderRoutingFlow(result);

        // Recommended model card
        this._renderRecommendedCard(result);

        // Analysis breakdown
        this._renderAnalysis(analysis);

        // Task classification detail
        this._renderTaskScores(analysis);

        // Model scores
        this._renderModelRankings(allScores, result);

        // Signal heatmap
        this._renderSignalHeatmap(allScores);

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

        // Animate in
        document.querySelectorAll('.routing-results > *').forEach((el, i) => {
            el.style.animationDelay = `${i * 0.06}s`;
            el.classList.add('fade-in-up');
        });
    }

    _renderRoutingFlow(result) {
        const { analysis, recommended } = result;
        const provider = getProvider(recommended);
        const el = document.getElementById('routing-flow');

        const complexityLabel = analysis.complexity < 0.3 ? 'Low' :
            analysis.complexity < 0.6 ? 'Medium' : analysis.complexity < 0.8 ? 'High' : 'Very High';
        const complexityColor = this._complexityColor(analysis.complexity);

        el.innerHTML = `
            <div class="flow-container">
                <div class="flow-step">
                    <div class="flow-step-icon">\u{1f4dd}</div>
                    <div class="flow-step-content">
                        <div class="flow-step-label">Input</div>
                        <div class="flow-step-value">${analysis.tokenEstimate} tokens</div>
                    </div>
                </div>
                <div class="flow-connector"><div class="flow-line"></div><div class="flow-arrow">\u25b6</div></div>
                <div class="flow-step">
                    <div class="flow-step-icon">${TASK_ICONS[analysis.primaryTask] || '\u2753'}</div>
                    <div class="flow-step-content">
                        <div class="flow-step-label">Task</div>
                        <div class="flow-step-value">${TASK_LABELS[analysis.primaryTask]}</div>
                    </div>
                </div>
                <div class="flow-connector"><div class="flow-line"></div><div class="flow-arrow">\u25b6</div></div>
                <div class="flow-step">
                    <div class="flow-step-icon" style="color: ${complexityColor}">\u{1f4ca}</div>
                    <div class="flow-step-content">
                        <div class="flow-step-label">Complexity</div>
                        <div class="flow-step-value" style="color: ${complexityColor}">${complexityLabel} (${(analysis.complexity * 100).toFixed(0)}%)</div>
                    </div>
                </div>
                <div class="flow-connector"><div class="flow-line"></div><div class="flow-arrow">\u25b6</div></div>
                <div class="flow-step flow-result" style="--provider-color: ${provider.color}">
                    <div class="flow-step-icon"><span class="flow-provider-icon" style="background: ${provider.color}">${provider.icon}</span></div>
                    <div class="flow-step-content">
                        <div class="flow-step-label">Routed to</div>
                        <div class="flow-step-value">${recommended.name}</div>
                    </div>
                </div>
            </div>
        `;
    }

    _renderRecommendedCard(result) {
        const { recommended, recommendedSignals, recommendedScore, allScores, analysis } = result;
        const provider = getProvider(recommended);
        const recEl = document.getElementById('recommended-model');

        const maxPossible = result.weights.task + result.weights.complexity + result.weights.cost + result.weights.speed + result.weights.context + 0.3;
        const scorePct = Math.min(recommendedScore / maxPossible, 1);
        const runnerUp = allScores[1];
        const margin = recommendedScore - runnerUp.totalScore;

        // Estimate cost
        const estCost = (analysis.tokenEstimate / 1000) * recommended.costPer1kInput
            + (analysis.expectedOutputLength / 1000) * recommended.costPer1kOutput;

        recEl.innerHTML = `
            <div class="rec-card" style="--provider-color: ${provider.color}">
                <div class="rec-top-row">
                    <div class="rec-badge">RECOMMENDED</div>
                    <div class="rec-margin ${margin < 0.15 ? 'close-call' : ''}">
                        ${margin < 0.15 ? 'Close call' : 'Clear winner'} &mdash; ${margin.toFixed(2)} pts ahead of ${runnerUp.model.name}
                    </div>
                </div>
                <div class="rec-main">
                    <div class="rec-model-info">
                        <span class="provider-icon" style="background: ${provider.color}">${provider.icon}</span>
                        <div>
                            <h2 class="rec-model-name">${recommended.name}</h2>
                            <div class="rec-tags">
                                <span class="rec-provider">${provider.name}</span>
                                <span class="rec-tier tier-${recommended.tier}">${recommended.tier}</span>
                                ${analysis.requiresReasoning ? '<span class="rec-reasoning-tag">Reasoning</span>' : ''}
                            </div>
                        </div>
                    </div>
                    <div class="rec-score">
                        <svg class="score-ring-svg" width="72" height="72" viewBox="0 0 72 72">
                            <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="4"/>
                            <circle cx="36" cy="36" r="30" fill="none" stroke="${provider.color}" stroke-width="4"
                                stroke-dasharray="${scorePct * 188.5} 188.5"
                                stroke-linecap="round" transform="rotate(-90 36 36)"
                                class="score-ring-progress"/>
                        </svg>
                        <span class="score-center-text">${recommendedScore.toFixed(2)}</span>
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
                        <span class="meta-label">Est. Cost</span>
                        <span class="meta-value">$${estCost.toFixed(5)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    _renderAnalysis(analysis) {
        const analysisEl = document.getElementById('analysis-breakdown');
        const complexityColor = this._complexityColor(analysis.complexity);

        analysisEl.innerHTML = `
            <div class="analysis-card">
                <div class="analysis-icon">${TASK_ICONS[analysis.primaryTask] || '\u2753'}</div>
                <div class="analysis-label">Primary Task</div>
                <div class="analysis-value">${TASK_LABELS[analysis.primaryTask] || analysis.primaryTask}</div>
            </div>
            <div class="analysis-card">
                <div class="analysis-icon" style="color: ${complexityColor}">\u{1f4ca}</div>
                <div class="analysis-label">Complexity</div>
                <div class="analysis-value">
                    <div class="complexity-bar">
                        <div class="complexity-fill" style="width: ${analysis.complexity * 100}%; background: ${complexityColor}"></div>
                    </div>
                    <span>${(analysis.complexity * 100).toFixed(0)}%</span>
                </div>
            </div>
            <div class="analysis-card">
                <div class="analysis-icon">\u{1f4dd}</div>
                <div class="analysis-label">Est. Input</div>
                <div class="analysis-value">~${analysis.tokenEstimate} tokens</div>
            </div>
            <div class="analysis-card">
                <div class="analysis-icon">\u{1f4e4}</div>
                <div class="analysis-label">Est. Output</div>
                <div class="analysis-value">~${analysis.expectedOutputLength} tokens</div>
            </div>
            ${analysis.requiresReasoning ? `
            <div class="analysis-card highlight">
                <div class="analysis-icon">\u{1f9e0}</div>
                <div class="analysis-label">Reasoning</div>
                <div class="analysis-value">Required</div>
            </div>` : ''}
            ${analysis.secondaryTasks.length > 0 ? `
            <div class="analysis-card">
                <div class="analysis-icon">\u{1f4cc}</div>
                <div class="analysis-label">Secondary Tasks</div>
                <div class="analysis-value secondary-tasks">${analysis.secondaryTasks.map(t => TASK_LABELS[t] || t).join(', ')}</div>
            </div>` : ''}
            ${analysis.constraints.language ? `
            <div class="analysis-card">
                <div class="analysis-icon">\u{1f30d}</div>
                <div class="analysis-label">Language</div>
                <div class="analysis-value">${analysis.constraints.language}</div>
            </div>` : ''}
            ${analysis.constraints.format ? `
            <div class="analysis-card">
                <div class="analysis-icon">\u{1f4cb}</div>
                <div class="analysis-label">Format</div>
                <div class="analysis-value">${analysis.constraints.format}</div>
            </div>` : ''}
        `;
    }

    _renderTaskScores(analysis) {
        const el = document.getElementById('task-scores-detail');
        const sorted = Object.entries(analysis.taskScores)
            .sort((a, b) => b[1] - a[1]);

        const maxScore = sorted[0][1];

        el.innerHTML = `<div class="task-scores-grid">
            ${sorted.filter(([, score]) => score > 0.01).map(([task, score]) => {
                const isPrimary = task === analysis.primaryTask;
                const isSecondary = analysis.secondaryTasks.includes(task);
                const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
                return `
                    <div class="task-score-row ${isPrimary ? 'primary' : ''} ${isSecondary ? 'secondary' : ''}">
                        <span class="task-score-icon">${TASK_ICONS[task] || ''}</span>
                        <span class="task-score-name">${TASK_LABELS[task] || task}</span>
                        ${isPrimary ? '<span class="task-badge primary-badge">PRIMARY</span>' : ''}
                        ${isSecondary ? '<span class="task-badge secondary-badge">SECONDARY</span>' : ''}
                        <div class="task-score-bar-wrap">
                            <div class="task-score-bar" style="width: ${pct}%"></div>
                        </div>
                        <span class="task-score-val">${(score * 100).toFixed(0)}%</span>
                    </div>
                `;
            }).join('')}
        </div>`;
    }

    _renderModelRankings(allScores, result) {
        const scoresEl = document.getElementById('model-scores');
        const subtitleEl = document.getElementById('rankings-subtitle');
        const maxScore = allScores[0].totalScore;

        subtitleEl.textContent = `(${allScores.length} models scored)`;

        scoresEl.innerHTML = allScores.map((item, i) => {
            const p = getProvider(item.model);
            const pct = (item.totalScore / maxScore) * 100;
            const isTop = i === 0;
            return `
                <div class="score-row ${isTop ? 'top' : ''}" title="${item.model.name}: task=${(item.signals.taskMatch*100).toFixed(0)}% complexity=${(item.signals.complexityFit*100).toFixed(0)}% cost=${(item.signals.costScore*100).toFixed(0)}% speed=${(item.signals.speedScore*100).toFixed(0)}%">
                    <div class="score-rank">${i + 1}</div>
                    <span class="provider-dot-small" style="background: ${p.color}"></span>
                    <span class="score-model-name">${item.model.name}</span>
                    <div class="score-bar-wrapper">
                        <div class="score-bar" style="width: ${pct}%; background: ${isTop ? p.color : 'rgba(255,255,255,0.15)'}"></div>
                    </div>
                    <span class="score-number">${item.totalScore.toFixed(2)}</span>
                </div>
            `;
        }).join('');
    }

    _renderSignalHeatmap(allScores) {
        const el = document.getElementById('signal-heatmap');
        const signals = ['taskMatch', 'complexityFit', 'costScore', 'speedScore', 'contextFit'];
        const signalLabels = ['Task', 'Complexity', 'Cost', 'Speed', 'Context'];

        // Take top 8 models
        const top = allScores.slice(0, 8);

        el.innerHTML = `
            <div class="heatmap-table">
                <div class="heatmap-header">
                    <div class="heatmap-corner"></div>
                    ${signalLabels.map(l => `<div class="heatmap-col-label">${l}</div>`).join('')}
                </div>
                ${top.map((item, i) => {
                    const p = getProvider(item.model);
                    return `
                        <div class="heatmap-row ${i === 0 ? 'top-row' : ''}">
                            <div class="heatmap-row-label">
                                <span class="provider-dot-small" style="background: ${p.color}"></span>
                                ${item.model.name}
                            </div>
                            ${signals.map(sig => {
                                const val = item.signals[sig];
                                return `<div class="heatmap-cell" style="--heat: ${val}" title="${sig}: ${(val * 100).toFixed(0)}%">
                                    <span>${(val * 100).toFixed(0)}</span>
                                </div>`;
                            }).join('')}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    _renderSignalBars(signals, color) {
        const signalDefs = [
            { key: 'taskMatch', label: 'Task Match', desc: 'Model strength on identified task type' },
            { key: 'complexityFit', label: 'Complexity Fit', desc: 'Query complexity vs model sweet spot' },
            { key: 'costScore', label: 'Cost Efficiency', desc: 'Estimated cost relative to all models' },
            { key: 'speedScore', label: 'Speed', desc: 'Latency + throughput combined' },
            { key: 'contextFit', label: 'Context Fit', desc: 'Context window utilization' },
        ];

        return `<div class="signal-bars">
            ${signalDefs.map(({ key, label, desc }) => {
                const val = signals[key];
                const barColor = val > 0.8 ? color : val > 0.5 ? color : 'rgba(255,255,255,0.2)';
                return `
                    <div class="signal-bar-item" title="${desc}">
                        <span class="signal-label">${label}</span>
                        <div class="signal-track">
                            <div class="signal-fill" style="width: ${val * 100}%; background: ${barColor}; opacity: ${0.4 + val * 0.6}"></div>
                        </div>
                        <span class="signal-value">${(val * 100).toFixed(0)}%</span>
                    </div>
                `;
            }).join('')}
            ${signals.reasoningBonus > 0 ? `
                <div class="signal-bar-item reasoning-signal">
                    <span class="signal-label">Reasoning Bonus</span>
                    <div class="signal-track">
                        <div class="signal-fill" style="width: ${signals.reasoningBonus * 100 / 0.15 * 100}%; background: #a78bfa"></div>
                    </div>
                    <span class="signal-value">+${(signals.reasoningBonus * 100).toFixed(0)}%</span>
                </div>
            ` : ''}
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
        let html = this._escapeHtml(result.content);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
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
                    <span class="stat-label">Complexity Sweet Spot</span>
                    <div class="range-bar">
                        <div class="range-fill" style="left: ${model.complexityRange[0] * 100}%; width: ${(model.complexityRange[1] - model.complexityRange[0]) * 100}%; background: ${provider.color}"></div>
                    </div>
                    <div class="range-labels">
                        <span>Simple</span>
                        <span>Complex</span>
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

        // Compute distribution
        const modelCounts = {};
        results.forEach(r => {
            modelCounts[r.recommended.name] = (modelCounts[r.recommended.name] || 0) + 1;
        });

        const distribution = Object.entries(modelCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => {
                const model = MODELS.find(m => m.name === name);
                const p = model ? getProvider(model) : { color: '#666' };
                return `<div class="dist-bar-row">
                    <span class="dist-label"><span class="provider-dot-small" style="background: ${p.color}"></span>${name}</span>
                    <div class="dist-bar" style="width: ${(count / results.length) * 100}%; background: ${p.color}"></div>
                    <span class="dist-count">${count}/${results.length}</span>
                </div>`;
            }).join('');

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

            <div class="bench-distribution">
                <h4>Model Selection Distribution</h4>
                <div class="dist-bars">${distribution}</div>
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
                            <th>Margin</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${results.map(r => {
                            const p = getProvider(r.recommended);
                            const runnerUp = r.allScores[1];
                            const rup = getProvider(runnerUp.model);
                            const margin = r.recommendedScore - runnerUp.totalScore;
                            return `
                                <tr>
                                    <td class="bench-query">${this._escapeHtml(r.analysis.query.slice(0, 70))}${r.analysis.query.length > 70 ? '...' : ''}</td>
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
                                    <td class="bench-margin ${margin < 0.15 ? 'close' : ''}">${margin.toFixed(2)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
}
