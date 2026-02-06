/**
 * Path safety utilities to prevent path traversal attacks.
 * All file tool operations must validate paths through this module.
 */

import path from 'node:path';

/** Sensitive patterns that should never be accessed by tools. */
const BLOCKED_PATTERNS = [
    '.env',
    'whatsapp-auth',
    'creds.json',
    'node_modules',
];

/**
 * Validate that a path is within the project root and not sensitive.
 * Throws if the path is unsafe.
 */
export function assertSafePath(userPath: string, projectRoot: string = process.cwd()): string {
    const resolved = path.resolve(projectRoot, userPath);
    const normalizedRoot = path.resolve(projectRoot);

    if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
        throw new Error(`Path traversal blocked: "${userPath}" escapes the project root.`);
    }

    const relative = path.relative(normalizedRoot, resolved);
    for (const pattern of BLOCKED_PATTERNS) {
        if (relative.includes(pattern)) {
            throw new Error(`Access denied: "${relative}" matches blocked pattern "${pattern}".`);
        }
    }

    return resolved;
}
