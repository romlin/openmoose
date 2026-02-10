import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';
import { readFile } from 'node:fs/promises';
import { assertSafePath } from '../infra/safe-path.js';
import { getErrorMessage } from '../infra/errors.js';

/**
 * Read skill - allows agent to read file contents (for SKILL.md files, etc.)
 */
export const readSkill = defineSkill({
    name: 'read',
    description: 'Read the contents of a file. Use this to read SKILL.md files when you need to learn how to use a skill.',
    isVerified: false,
    argsSchema: z.object({
        path: z.string().describe('Path to the file to read (relative to project root)')
    }),
    execute: async (args) => {
        try {
            const safePath = assertSafePath(args.path);
            const content = await readFile(safePath, 'utf-8');
            return { success: true, data: { content } };
        } catch (error) {
            return {
                success: false,
                error: `Failed to read file: ${getErrorMessage(error)}`
            };
        }
    }
});
