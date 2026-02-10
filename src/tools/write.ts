import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertSafePath } from '../infra/safe-path.js';
import { getErrorMessage } from '../infra/errors.js';

/**
 * Write skill - allows agent to create or overwrite files
 */
export const writeSkill = defineSkill({
    name: 'file_write',
    description: 'Create or overwrite a LOCAL file with text. Use this ONLY for saving files on the server disk. NEVER use this for messaging people or WhatsApp.',
    isVerified: false,
    argsSchema: z.object({
        path: z.string().describe('Path to the file to write (relative to project root)'),
        content: z.string().describe('The content to write to the file')
    }),
    execute: async (args) => {
        try {
            const safePath = assertSafePath(args.path);

            // Ensure parent directory exists
            await mkdir(dirname(safePath), { recursive: true });

            await writeFile(safePath, args.content, 'utf-8');
            return { success: true, data: { message: `Successfully wrote to ${args.path}` } };
        } catch (error) {
            return {
                success: false,
                error: `Failed to write file: ${getErrorMessage(error)}`
            };
        }
    }
});
