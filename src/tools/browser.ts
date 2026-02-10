/**
 * Browser automation tool — delegates to a persistent Playwright daemon
 * running in a Docker container for navigation, clicking, typing, and screenshots.
 *
 * The daemon returns indexed interactive elements so the LLM can refer to
 * them by number (e.g. { action: "click", element: 3 }) instead of guessing
 * CSS selectors.
 */

import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';
import { getErrorMessage } from '../infra/errors.js';
import { BrowserManager } from '../runtime/browser/manager.js';
import { BROWSER_DAEMON_EXECUTE_URL } from '../runtime/browser/constants.js';
import { config } from '../config/index.js';

/** Supported browser action types. */
const ACTION_TYPES = ['navigate', 'click', 'type', 'wait', 'press', 'screenshot'] as const;

/** Number that also accepts string input (LLMs often stringify numbers). Rejects NaN. */
const laxNumber = z.union([
    z.number(),
    z.string().transform(Number).refine(v => !Number.isNaN(v), { message: 'Expected a numeric string' }),
]);

/** Schema for a single action entry. */
const ActionEntrySchema = z.object({
    type: z.enum(ACTION_TYPES).optional(),
    action: z.enum(ACTION_TYPES).optional(), // LLM alias
    element: laxNumber.optional().describe('Index of an interactive element from the snapshot.'),
    url: z.string().optional(),
    selector: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    ms: laxNumber.optional(),
});

type ActionEntry = z.infer<typeof ActionEntrySchema>;

/** Full schema — extends ActionEntrySchema with actions array and control fields. */
const BrowserActionSchema = ActionEntrySchema.extend({
    actions: z.array(ActionEntrySchema).optional()
        .describe('List of actions to perform.'),
    _raw: z.string().optional(),
    timeout: laxNumber.optional().transform(v => v ?? config.sandbox.defaultTimeoutMs),
});

/**
 * Merge top-level fields and the actions array into a single list.
 * Handles LLM-friendly shorthands (e.g. `{ url: "..." }` → navigate).
 */
function normalizeActions(args: z.infer<typeof BrowserActionSchema>): ActionEntry[] {
    const list: ActionEntry[] = [];

    // Process entries from the actions array, resolving type for each
    for (const entry of (args.actions || [])) {
        let url = entry.url;
        if (!url && (entry as Record<string, unknown>)._raw) {
            const raw = String((entry as Record<string, unknown>)._raw).trim();
            if (raw.startsWith('http')) url = raw;
        }
        const resolved = entry.type || entry.action || (url ? 'navigate' : undefined);
        if (!resolved) continue; // skip malformed entries with no type
        list.push({
            type: resolved,
            url,
            element: entry.element,
            selector: entry.selector,
            text: entry.text,
            key: entry.key,
            ms: entry.ms,
        });
    }

    // Process top-level fields
    let url = args.url;
    if (!url && args._raw) {
        const raw = args._raw.trim();
        if (raw.startsWith('http')) url = raw;
    }
    const resolved = args.type || args.action || (url ? 'navigate' : undefined);
    if (resolved) {
        list.push({
            type: resolved,
            url,
            element: args.element,
            selector: args.selector,
            text: args.text,
            key: args.key,
            ms: args.ms,
        });
    }

    return list;
}

/**
 * browser_action — LLM-friendly high-level interface for browser control.
 * Use element indices from the snapshot, or fall back to url/selector.
 */
export const browserActionSkill = defineSkill({
    name: 'browser_action',
    description: 'Control the browser. Use element index from snapshot, or url/selector for direct access.',
    isVerified: false,
    argsSchema: BrowserActionSchema,
    execute: async (args) => {
        try {
            await BrowserManager.ensureRunning();

            const actions = normalizeActions(args);
            if (actions.length === 0) {
                return { success: false, error: "No valid actions provided. Specify 'url', 'element', or 'actions'." };
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), args.timeout);

            try {
                const res = await fetch(BROWSER_DAEMON_EXECUTE_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ actions }),
                    signal: controller.signal,
                });

                if (!res.ok) {
                    return { success: false, error: `Daemon error: ${res.statusText}` };
                }

                return await res.json();
            } finally {
                clearTimeout(timer);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                return { success: false, error: 'Browser action timed out.' };
            }
            return { success: false, error: getErrorMessage(error) };
        }
    },
});
