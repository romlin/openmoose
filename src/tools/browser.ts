/**
 * Browser automation tool -- runs Playwright scripts in a Docker sandbox
 * to perform web navigation, clicking, typing, and screenshot capture.
 */

import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';

/** Default timeout for browser actions (ms). */
const DEFAULT_BROWSER_TIMEOUT_MS = 30_000;

/** Timeout for waiting on network idle (ms). */
const NETWORK_IDLE_TIMEOUT_MS = 3_000;

/** Timeout for waiting on a selector (ms). */
const SELECTOR_WAIT_TIMEOUT_MS = 5_000;

// Schema that supports both 'type' and 'action' for LLM resilience
const BrowserActionSchema = z.object({
    actions: z.array(z.object({
        type: z.enum(['navigate', 'click', 'type', 'wait', 'press', 'screenshot']).optional(),
        action: z.enum(['navigate', 'click', 'type', 'wait', 'press', 'screenshot']).optional(), // LLM alias
        url: z.string().optional(),
        selector: z.string().optional(),
        text: z.string().optional(),
        key: z.string().optional(),
        ms: z.number().optional(),
    })).describe('List of high-level actions to perform. You can use "type" or "action" to specify the command.'),
    timeout: z.number().optional().default(DEFAULT_BROWSER_TIMEOUT_MS),
});

/**
 * browser_action: An LLM-friendly high-level interface for browser control.
 */
export const browserActionSkill = defineSkill({
    name: 'browser_action',
    description: 'Control the browser using high-level actions. Automatically saves a debugging screenshot to .moose/data/browser-previews/latest.png',
    isVerified: false,
    argsSchema: BrowserActionSchema,
    execute: async (args, context) => {
        try {
            const runnerCode = `
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    async function getSnapshot(page) {
        try {
            await page.waitForLoadState('networkidle', { timeout: ${NETWORK_IDLE_TIMEOUT_MS} }).catch(() => {});
            const tree = await page.accessibility.snapshot();
            const elements = [];
            function traverse(node) {
                if (node.name || node.role === 'link' || node.role === 'button') {
                  elements.push(\`[\${node.role}] "\${node.name || ''}" \${node.description || ''}\`);
                }
                if (node.children) node.children.forEach(traverse);
            }
            if (tree) traverse(tree);
            return elements.slice(0, 50).join('\\n');
        } catch (e) { return "Snapshot failed: " + e.message; }
    }

    try {
        const rawActions = ${JSON.stringify(args.actions)};
        for (const raw of rawActions) {
            const type = raw.type || raw.action;
            if (!type) continue;

            switch (type) {
                case 'navigate':
                    await page.goto(raw.url, { waitUntil: 'networkidle' });
                    break;
                case 'click':
                    await page.click(raw.selector || \`text="\${raw.text}"\`);
                    break;
                case 'type':
                    await page.fill(raw.selector, raw.text);
                    break;
                case 'press':
                    await page.keyboard.press(raw.key);
                    break;
                case 'wait':
                    if (raw.selector) await page.waitForSelector(raw.selector, { timeout: ${SELECTOR_WAIT_TIMEOUT_MS} });
                    else if (raw.ms) await page.waitForTimeout(raw.ms);
                    break;
            }
        }

        await page.screenshot({ path: '/workspace/.moose/data/browser-previews/latest.png' });

        const snapshot = await getSnapshot(page);
        console.log("PLAYWRIGHT_RESULT:" + JSON.stringify({
            success: true,
            snapshot,
            url: page.url(),
            preview: ".moose/data/browser-previews/latest.png"
        }));
    } catch (err) {
        try { await page.screenshot({ path: '/workspace/.moose/data/browser-previews/error.png' }); } catch (e) { /* screenshot failed */ }
        console.error("PLAYWRIGHT_ERROR:" + JSON.stringify({
            success: false,
            error: err.message,
            preview: ".moose/data/browser-previews/error.png"
        }));
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
      `;

            const result = await context.sandbox.runPlaywright(runnerCode, {
                timeout: args.timeout,
                network: 'bridge'
            });

            if (result.exitCode !== 0 && !result.stdout.includes("PLAYWRIGHT_RESULT")) {
                return { success: false, error: result.stderr || 'Browser action failed' };
            }

            const match = result.stdout.match(/PLAYWRIGHT_RESULT:(.*)/);
            if (match) {
                try {
                    return JSON.parse(match[1]);
                } catch {
                    return { success: true, data: match[1] };
                }
            }

            const errorMatch = result.stderr.match(/PLAYWRIGHT_ERROR:(.*)/);
            if (errorMatch) {
                try {
                    return JSON.parse(errorMatch[1]);
                } catch {
                    return { success: false, error: errorMatch[1] };
                }
            }

            return { success: true, data: result.stdout };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    },
});
