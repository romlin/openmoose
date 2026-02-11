/**
 * Cross-platform URL/file opener utility.
 * Returns the appropriate command for the current operating system.
 */

import { platform } from 'node:os';

/**
 * Returns the standard "open" command for the current platform.
 * - macOS: 'open'
 * - Windows: 'start'
 * - Linux: 'xdg-open'
 */
export function getOpenCommand(): string {
    const p = platform();
    if (p === 'darwin') return 'open';
    if (p === 'win32') return 'start';
    return 'xdg-open';
}
