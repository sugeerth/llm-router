/**
 * Query Analyzer - The brain of the routing system.
 *
 * Performs multi-signal analysis of the input query to determine:
 * 1. Task type classification (what kind of task is this?)
 * 2. Complexity estimation (how hard is this?)
 * 3. Required capabilities (what does the model need to be good at?)
 * 4. Token estimation (how long is the expected input/output?)
 * 5. Constraint extraction (language, format, style requirements)
 */

import { TASK_TYPES } from './models.js';

// ──────────────────────────────────────────────
// Pattern libraries for classification
// ──────────────────────────────────────────────

const CODE_PATTERNS = {
    strong: [
        /\b(write|create|implement|build|code|program|develop)\b.*\b(function|class|method|api|endpoint|script|module|component|service|app|application)\b/i,
        /\b(python|javascript|typescript|java|c\+\+|rust|go|ruby|swift|kotlin|sql|html|css|react|vue|angular|node|django|flask|fastapi)\b/i,
        /```[\s\S]*```/,
        /\b(algorithm|data structure|binary tree|linked list|hash map|graph|sort|search)\b/i,
        /\b(def |class |function |const |let |var |import |from |require\(|#include)\b/,
        /\b(API|REST|GraphQL|gRPC|webhook|endpoint|CRUD)\b/i,
    ],
    moderate: [
        /\b(code|script|program|snippet|syntax)\b/i,
        /\b(bug|error|exception|crash|fail|broken|doesn't work|not working)\b/i,
        /\b(refactor|optimize|improve|clean up|rewrite)\b.*\b(code|function|class)\b/i,
    ]
};

const DEBUG_PATTERNS = [
    /\b(fix|debug|troubleshoot|diagnose|solve)\b.*\b(bug|error|issue|problem|crash)\b/i,
    /\b(why|how come)\b.*\b(error|fail|crash|break|not work|wrong)\b/i,
    /\berror\s*:?\s*[A-Z]/i,
    /\b(stack\s*trace|traceback|exception|segfault|core dump)\b/i,
    /\b(TypeError|ValueError|SyntaxError|ReferenceError|NullPointer|IndexOutOfBounds)\b/,
    /what('s| is) wrong with/i,
];

const CREATIVE_PATTERNS = [
    /\b(write|create|compose|craft|draft)\b.*\b(story|poem|essay|article|blog|novel|letter|song|lyrics|script|narrative|fiction)\b/i,
    /\b(creative|imaginative|artistic|literary|poetic)\b/i,
    /\b(in the style of|like .* would write|tone of|voice of)\b/i,
    /\b(metaphor|allegory|symbolism|imagery|prose|verse)\b/i,
    /\b(character|plot|setting|dialogue|narrator)\b/i,
    /\b(haiku|sonnet|limerick|ballad|free verse)\b/i,
];

const ANALYSIS_PATTERNS = [
    /\b(analyze|analyse|evaluate|assess|examine|investigate|compare|contrast|review)\b/i,
    /\b(implications|consequences|impact|effects|ramifications|trade-?offs)\b/i,
    /\b(pros and cons|advantages|disadvantages|strengths and weaknesses)\b/i,
    /\b(geopolitical|economic|societal|cultural|environmental|strategic)\b/i,
    /\b(nuanced|comprehensive|in-depth|detailed|thorough)\b.*\b(analysis|review|assessment)\b/i,
    /\b(multiple perspectives|different viewpoints|various angles)\b/i,
];

const MATH_PATTERNS = [
    /\b(solve|calculate|compute|evaluate|prove|derive|find the|show that)\b/i,
    /\b(equation|integral|derivative|limit|matrix|vector|eigenvalue|determinant)\b/i,
    /\b(theorem|proof|lemma|corollary|conjecture|axiom)\b/i,
    /\b(probability|statistics|regression|distribution|variance|standard deviation)\b/i,
    /[=+\-*/^].*[=+\-*/^]/,
    /\b(sin|cos|tan|log|ln|exp|sqrt|sum|product)\s*\(/i,
    /\b(polynomial|quadratic|cubic|differential|partial|ordinary)\b/i,
    /\b(calculus|algebra|geometry|topology|number theory|combinatorics)\b/i,
    /\d+\s*[+\-*/^]\s*\d+/,
    /\bf[('(]\s*x\s*[')]/,
];

const SUMMARIZE_PATTERNS = [
    /\b(summarize|summarise|sum up|recap|brief|overview|tl;?dr|key points|main points|gist)\b/i,
    /\b(condense|shorten|abridge|compress)\b/i,
    /\b(in (a )?few (words|sentences|bullet points))\b/i,
    /\b(table format|bullet points|numbered list)\b.*\b(differences|comparison|features)\b/i,
];

const TRANSLATION_PATTERNS = [
    /\b(translate|translation|convert|localize)\b.*\b(to|into|in)\b/i,
    /\b(french|spanish|german|japanese|chinese|korean|arabic|hindi|portuguese|russian|italian)\b/i,
    /\b(language|multilingual|bilingual)\b/i,
];

const SYSTEM_DESIGN_PATTERNS = [
    /\b(design|architect|build)\b.*\b(system|architecture|infrastructure|platform|service)\b/i,
    /\b(microservice|distributed|scalable|fault.?tolerant|high.?availability|load.?balanc)\b/i,
    /\b(concurrent users|throughput|latency|SLA|uptime|99\.9)\b/i,
    /\b(database|cache|queue|message broker|pub.?sub|event.?driven)\b/i,
    /\b(kubernetes|docker|aws|gcp|azure|terraform|ci.?cd)\b/i,
];

const FACTUAL_PATTERNS = [
    /^(what|who|when|where|which|how much|how many|how old|how far|how long)\b/i,
    /\b(capital of|population of|distance between|definition of|meaning of)\b/i,
    /\b(is it true|did .* really|fact or fiction)\b/i,
];

const DATA_EXTRACTION_PATTERNS = [
    /\b(extract|parse|scrape|pull out|identify all|list all|find all)\b/i,
    /\b(JSON|CSV|XML|YAML|structured|format as|output as)\b/i,
    /\b(regex|pattern|match|filter)\b.*\b(data|text|content)\b/i,
    /\b(entities|names|dates|numbers|emails|urls|addresses)\b.*\b(from|in|out of)\b/i,
];

// ──────────────────────────────────────────────
// Complexity signals
// ──────────────────────────────────────────────

const COMPLEXITY_BOOSTERS = [
    { pattern: /\b(comprehensive|thorough|detailed|in-depth|exhaustive)\b/i, weight: 0.12 },
    { pattern: /\b(nuanced|subtle|complex|intricate|sophisticated)\b/i, weight: 0.15 },
    { pattern: /\b(multiple|several|various|all|every)\b.*\b(aspects|factors|perspectives|dimensions|considerations)\b/i, weight: 0.10 },
    { pattern: /\b(step by step|step-by-step|walkthrough|detailed explanation)\b/i, weight: 0.08 },
    { pattern: /\b(trade-?offs?|pros and cons|advantages and disadvantages)\b/i, weight: 0.08 },
    { pattern: /\b(edge cases?|corner cases?|error handling|failure modes?)\b/i, weight: 0.10 },
    { pattern: /\b(optimize|optimization|performance|efficient|scalab)\b/i, weight: 0.08 },
    { pattern: /\b(proof|prove|theorem|derive|derivation)\b/i, weight: 0.15 },
    { pattern: /\b(design pattern|architecture|microservice|distributed)\b/i, weight: 0.12 },
    { pattern: /\b(concurrent|parallel|async|race condition|deadlock|mutex)\b/i, weight: 0.12 },
    { pattern: /\b(security|vulnerability|exploit|injection|XSS|CSRF|authentication)\b/i, weight: 0.08 },
    { pattern: /\b(explain|why|how does|what happens when|under the hood)\b/i, weight: 0.05 },
];

const COMPLEXITY_REDUCERS = [
    { pattern: /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)\b/i, weight: -0.3 },
    { pattern: /\b(simple|basic|quick|brief|short|easy|straightforward)\b/i, weight: -0.1 },
    { pattern: /\b(just|only|simply|merely)\b/i, weight: -0.05 },
    { pattern: /^(what is|define|who is|when did|where is)\b/i, weight: -0.1 },
];

// ──────────────────────────────────────────────
// Core Analyzer
// ──────────────────────────────────────────────

export class QueryAnalyzer {
    /**
     * Analyze a query and return a structured analysis result.
     */
    analyze(query) {
        const startTime = performance.now();

        const trimmed = query.trim();
        if (!trimmed) {
            return null;
        }

        const taskScores = this._classifyTask(trimmed);
        const primaryTask = this._pickPrimaryTask(taskScores);
        const secondaryTasks = this._pickSecondaryTasks(taskScores, primaryTask);
        const complexity = this._estimateComplexity(trimmed, primaryTask, taskScores);
        const tokenEstimate = this._estimateTokens(trimmed);
        const expectedOutputLength = this._estimateOutputLength(trimmed, primaryTask, complexity);
        const constraints = this._extractConstraints(trimmed);
        const requiresReasoning = this._requiresReasoning(trimmed, primaryTask, complexity);

        const analysisTime = performance.now() - startTime;

        return {
            query: trimmed,
            taskScores,
            primaryTask,
            secondaryTasks,
            complexity,           // 0-1, where 1 is maximum complexity
            tokenEstimate,        // estimated input tokens
            expectedOutputLength, // estimated output tokens needed
            constraints,
            requiresReasoning,    // whether chain-of-thought / reasoning models are beneficial
            analysisTimeMs: Math.round(analysisTime * 100) / 100,
        };
    }

    /**
     * Score each task type for the query. Returns object of { taskType: score }.
     */
    _classifyTask(query) {
        const scores = {};

        // Code generation
        let codeScore = 0;
        CODE_PATTERNS.strong.forEach(p => { if (p.test(query)) codeScore += 0.25; });
        CODE_PATTERNS.moderate.forEach(p => { if (p.test(query)) codeScore += 0.12; });
        scores[TASK_TYPES.CODE_GENERATION] = Math.min(codeScore, 1);

        // Code debugging
        let debugScore = 0;
        DEBUG_PATTERNS.forEach(p => { if (p.test(query)) debugScore += 0.22; });
        // If query contains code blocks + error keywords, boost debug
        if (/```/.test(query) && /\b(error|bug|fix|wrong|fail)\b/i.test(query)) debugScore += 0.3;
        scores[TASK_TYPES.CODE_DEBUG] = Math.min(debugScore, 1);

        // Creative writing
        let creativeScore = 0;
        CREATIVE_PATTERNS.forEach(p => { if (p.test(query)) creativeScore += 0.22; });
        scores[TASK_TYPES.CREATIVE_WRITING] = Math.min(creativeScore, 1);

        // Analysis
        let analysisScore = 0;
        ANALYSIS_PATTERNS.forEach(p => { if (p.test(query)) analysisScore += 0.2; });
        scores[TASK_TYPES.ANALYSIS] = Math.min(analysisScore, 1);

        // Math reasoning
        let mathScore = 0;
        MATH_PATTERNS.forEach(p => { if (p.test(query)) mathScore += 0.18; });
        scores[TASK_TYPES.MATH_REASONING] = Math.min(mathScore, 1);

        // Summarization
        let summScore = 0;
        SUMMARIZE_PATTERNS.forEach(p => { if (p.test(query)) summScore += 0.28; });
        scores[TASK_TYPES.SUMMARIZATION] = Math.min(summScore, 1);

        // Translation
        let transScore = 0;
        TRANSLATION_PATTERNS.forEach(p => { if (p.test(query)) transScore += 0.3; });
        scores[TASK_TYPES.TRANSLATION] = Math.min(transScore, 1);

        // System design
        let sysScore = 0;
        SYSTEM_DESIGN_PATTERNS.forEach(p => { if (p.test(query)) sysScore += 0.22; });
        scores[TASK_TYPES.SYSTEM_DESIGN] = Math.min(sysScore, 1);

        // Factual QA
        let factScore = 0;
        FACTUAL_PATTERNS.forEach(p => { if (p.test(query)) factScore += 0.3; });
        scores[TASK_TYPES.FACTUAL_QA] = Math.min(factScore, 1);

        // Data extraction
        let dataScore = 0;
        DATA_EXTRACTION_PATTERNS.forEach(p => { if (p.test(query)) dataScore += 0.25; });
        scores[TASK_TYPES.DATA_EXTRACTION] = Math.min(dataScore, 1);

        // Conversation (fallback - scores higher when nothing else matches well)
        const maxOtherScore = Math.max(...Object.values(scores));
        scores[TASK_TYPES.CONVERSATION] = Math.max(0, 0.5 - maxOtherScore * 0.8);

        // General instruction following
        scores[TASK_TYPES.INSTRUCTION_FOLLOWING] = 0.3; // baseline for everything

        return scores;
    }

    _pickPrimaryTask(scores) {
        let best = null;
        let bestScore = -1;
        for (const [task, score] of Object.entries(scores)) {
            if (score > bestScore) {
                bestScore = score;
                best = task;
            }
        }
        return best;
    }

    _pickSecondaryTasks(scores, primary) {
        return Object.entries(scores)
            .filter(([task]) => task !== primary)
            .filter(([, score]) => score >= 0.25)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([task]) => task);
    }

    /**
     * Multi-signal complexity estimation.
     * Considers: query length, vocabulary sophistication, structural complexity,
     * domain-specific signals, and explicit complexity markers.
     */
    _estimateComplexity(query, primaryTask, taskScores) {
        let complexity = 0;

        // Signal 1: Length-based (longer queries tend to be more complex)
        const words = query.split(/\s+/).length;
        const lengthScore = Math.min(words / 200, 1) * 0.25;
        complexity += lengthScore;

        // Signal 2: Sentence count and structure
        const sentences = query.split(/[.!?]+/).filter(s => s.trim()).length;
        if (sentences > 3) complexity += 0.05;
        if (sentences > 6) complexity += 0.05;

        // Signal 3: Multi-part queries (numbered lists, multiple questions)
        const multiPartIndicators = query.match(/(\d+\.\s|\n-\s|\n\*\s|;\s*(and|also|additionally))/gi);
        if (multiPartIndicators) {
            complexity += Math.min(multiPartIndicators.length * 0.04, 0.15);
        }

        // Signal 4: Presence of multiple question marks
        const questionMarks = (query.match(/\?/g) || []).length;
        if (questionMarks > 1) complexity += questionMarks * 0.03;

        // Signal 5: Technical vocabulary density
        const techTerms = query.match(/\b(algorithm|architecture|distributed|concurrent|asynchronous|polymorphism|abstraction|encapsulation|inheritance|recursion|memoization|optimization|heuristic|stochastic|deterministic|idempotent|orthogonal|isomorphic|monotonic|amortized)\b/gi);
        if (techTerms) {
            complexity += Math.min(techTerms.length * 0.04, 0.15);
        }

        // Signal 6: Code block presence and size
        const codeBlocks = query.match(/```[\s\S]*?```/g);
        if (codeBlocks) {
            const totalCodeLines = codeBlocks.join('\n').split('\n').length;
            complexity += Math.min(totalCodeLines * 0.005, 0.15);
        }

        // Signal 7: Explicit complexity boosters and reducers
        for (const { pattern, weight } of COMPLEXITY_BOOSTERS) {
            if (pattern.test(query)) complexity += weight;
        }
        for (const { pattern, weight } of COMPLEXITY_REDUCERS) {
            if (pattern.test(query)) complexity += weight; // weight is negative
        }

        // Signal 8: Task-type inherent complexity
        const taskComplexityBias = {
            [TASK_TYPES.SYSTEM_DESIGN]: 0.15,
            [TASK_TYPES.MATH_REASONING]: 0.12,
            [TASK_TYPES.ANALYSIS]: 0.10,
            [TASK_TYPES.CODE_GENERATION]: 0.05,
            [TASK_TYPES.CODE_DEBUG]: 0.08,
            [TASK_TYPES.CREATIVE_WRITING]: 0.05,
            [TASK_TYPES.FACTUAL_QA]: -0.10,
            [TASK_TYPES.CONVERSATION]: -0.15,
            [TASK_TYPES.TRANSLATION]: -0.05,
            [TASK_TYPES.SUMMARIZATION]: -0.05,
        };
        complexity += taskComplexityBias[primaryTask] || 0;

        // Signal 9: Multiple high-scoring task types (cross-domain queries are harder)
        const highScoreTasks = Object.values(taskScores).filter(s => s >= 0.3).length;
        if (highScoreTasks >= 3) complexity += 0.08;

        return Math.max(0, Math.min(1, complexity));
    }

    _estimateTokens(query) {
        // Rough approximation: ~1 token per 4 chars for English
        return Math.ceil(query.length / 4);
    }

    _estimateOutputLength(query, primaryTask, complexity) {
        const baseLengths = {
            [TASK_TYPES.CODE_GENERATION]: 800,
            [TASK_TYPES.CODE_DEBUG]: 600,
            [TASK_TYPES.CREATIVE_WRITING]: 1000,
            [TASK_TYPES.ANALYSIS]: 1200,
            [TASK_TYPES.MATH_REASONING]: 700,
            [TASK_TYPES.SUMMARIZATION]: 300,
            [TASK_TYPES.TRANSLATION]: 200,
            [TASK_TYPES.CONVERSATION]: 200,
            [TASK_TYPES.FACTUAL_QA]: 150,
            [TASK_TYPES.SYSTEM_DESIGN]: 1500,
            [TASK_TYPES.DATA_EXTRACTION]: 400,
            [TASK_TYPES.INSTRUCTION_FOLLOWING]: 500,
        };

        const base = baseLengths[primaryTask] || 500;
        // Scale with complexity
        return Math.round(base * (0.5 + complexity * 1.5));
    }

    _extractConstraints(query) {
        const constraints = {
            language: null,
            format: null,
            length: null,
            style: null,
        };

        // Language detection
        const langMatch = query.match(/\b(in|to|into)\s+(french|spanish|german|japanese|chinese|korean|arabic|hindi|portuguese|russian|italian|english)\b/i);
        if (langMatch) constraints.language = langMatch[2].toLowerCase();

        // Format constraints
        if (/\b(table|tabular)\b/i.test(query)) constraints.format = 'table';
        else if (/\b(json)\b/i.test(query)) constraints.format = 'json';
        else if (/\b(csv)\b/i.test(query)) constraints.format = 'csv';
        else if (/\b(bullet|list)\b/i.test(query)) constraints.format = 'list';
        else if (/\b(markdown|md)\b/i.test(query)) constraints.format = 'markdown';

        // Length constraints
        if (/\b(brief|short|concise|one.?sentence|tl;?dr)\b/i.test(query)) constraints.length = 'short';
        else if (/\b(detailed|comprehensive|thorough|long|extensive)\b/i.test(query)) constraints.length = 'long';

        // Style constraints
        const styleMatch = query.match(/\b(in the style of|like|tone of)\s+(.+?)(?:\.|,|$)/i);
        if (styleMatch) constraints.style = styleMatch[2].trim();

        return constraints;
    }

    _requiresReasoning(query, primaryTask, complexity) {
        // Reasoning models are beneficial for high-complexity tasks that need
        // step-by-step thinking
        if (complexity > 0.7) return true;
        if (primaryTask === TASK_TYPES.MATH_REASONING && complexity > 0.4) return true;
        if (primaryTask === TASK_TYPES.SYSTEM_DESIGN && complexity > 0.5) return true;
        if (/\b(prove|proof|derive|step by step|think through|reason)\b/i.test(query)) return true;
        return false;
    }
}
