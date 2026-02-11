/**
 * Python execution tool -- runs Python 3.12 code in a Docker sandbox.
 */

import { z } from 'zod';
import { defineSkill } from '../../skill.js';

const PythonArgsSchema = z.object({
    code: z.string().describe('Python 3.12 code to execute')
});

export const pythonSkill = defineSkill({
    name: 'python_execute',
    description: 'Runs Python 3.12 code in a secure Docker sandbox. Use for calculations, data processing, or any Python task.',
    isVerified: false,
    argsSchema: PythonArgsSchema,
    execute: async (args, context) => {
        try {
            const result = await context.sandbox.runPython(args.code);
            return { success: true, data: result };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
});
