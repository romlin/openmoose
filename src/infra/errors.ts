/**
 * Shared error handling utilities to avoid duplicating
 * the `err instanceof Error ? err.message : String(err)` pattern.
 */

/** Extract a human-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
