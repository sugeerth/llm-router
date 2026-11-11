/**
 * Config file loading. Looks for (first found wins):
 *   --config <file>  |  ./llm-router.json  |  ~/.config/llm-router/config.json
 * Everything is optional; with no file the router uses env vars + built-ins.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadConfig(file) {
    const candidates = file ? [file] : [
        'llm-router.json',
        path.join(os.homedir(), '.config', 'llm-router', 'config.json'),
    ];
    for (const f of candidates) {
        if (!fs.existsSync(f)) continue;
        let cfg;
        try {
            cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
        } catch (e) {
            throw new Error(`Invalid JSON in ${f}: ${e.message}`);
        }
        // include/exclude may be given as regex strings in JSON
        for (const p of cfg.providers || []) {
            for (const k of ['include', 'exclude']) if (typeof p[k] === 'string') p[k] = new RegExp(p[k], 'i');
        }
        return { ...cfg, __file: path.resolve(f) };
    }
    if (file) throw new Error(`Config file not found: ${file}`);
    return {};
}
