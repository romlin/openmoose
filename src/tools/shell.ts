/**
 * Shell execution tool -- runs bash commands in a Docker sandbox.
 */

import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';
import { getErrorMessage } from '../infra/errors.js';

const ShellArgsSchema = z.object({
    command: z.string().describe('Bash command to execute')
});

type ShellArgs = z.infer<typeof ShellArgsSchema>;

export const shellSkill = defineSkill<ShellArgs, { stdout: string; stderr: string }>({
    name: 'shell_execute',
    description: 'Runs bash commands in a secure Docker sandbox. Use for file operations, system commands, or shell scripts.',
    isVerified: false,
    argsSchema: ShellArgsSchema,
    execute: async (args, context) => {
        try {
            const result = await context.sandbox.run(args.command);
            return { success: true, data: result };
        } catch (error) {
            return { success: false, error: getErrorMessage(error) };
        }
    }
});
