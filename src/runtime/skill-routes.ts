/**
 * Built-in skill routes and shared regex extraction utilities.
 * Currently empty as skills have migrated to YAML definitions.
 */

import { SkillRoute } from './semantic-router.js';

/**
 * Shared utility for regex extraction in skills
 */
export function extractFirstMatch(message: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
            return match[1].trim();
        }
    }
    return null;
}

/**
 * Built-in routes (Currently empty since we moved to YAML)
 * We keep this file to avoid breaking imports in other files
 * during the transition.
 */
export const builtInRoutes: SkillRoute[] = [];
