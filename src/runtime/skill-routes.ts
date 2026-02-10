/**
 * Shared regex extraction utilities for skill argument parsing.
 */

/**
 * Returns the first capture group from the first matching pattern,
 * or null if no pattern matches.
 */
export function extractFirstMatch(message: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }
    return null;
}
