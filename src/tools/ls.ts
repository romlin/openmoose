import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafePath } from '../infra/safe-path.js';
import { logger } from '../infra/logger.js';

/**
 * List directory skill - allows agent to list files and directories
 */
export const listSkill = defineSkill({
    name: 'ls',
    description: 'List the contents of a directory. Returns names, types (file/dir), and sizes.',
    isVerified: false,
    argsSchema: z.object({
        path: z.string().describe('Path to the directory to list (relative to project root)').default('.')
    }),
    execute: async (args) => {
        try {
            const safePath = assertSafePath(args.path);
            const files = await readdir(safePath);
            const results = [];

            for (const file of files) {
                const fullPath = join(safePath, file);
                try {
                    const s = await stat(fullPath);
                    results.push({
                        name: file,
                        type: s.isDirectory() ? 'directory' : 'file',
                        size: s.size
                    });
                } catch (err) {
                    logger.debug(`Failed to stat ${file}: ${err}`, 'LS');
                    results.push({ name: file, type: 'unknown' });
                }
            }

            return { success: true, data: { files: results } };
        } catch (error) {
            return {
                success: false,
                error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
});
