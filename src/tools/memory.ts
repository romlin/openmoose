/**
 * Memory tools -- store and recall facts using the vector memory.
 */

import { z } from 'zod';
import { defineSkill } from '../runtime/skill.js';

const MemoryStoreSchema = z.object({
    fact: z.string().describe('The fact or information to remember')
});

const MemoryRecallSchema = z.object({
    query: z.string().describe('Search query to find relevant memories')
});

type MemoryStoreArgs = z.infer<typeof MemoryStoreSchema>;
type MemoryRecallArgs = z.infer<typeof MemoryRecallSchema>;

export const memoryStoreSkill = defineSkill<MemoryStoreArgs, { stored: boolean }>({
    name: 'memory_store',
    description: 'Stores a fact in long-term memory for future recall.',
    isVerified: false,
    argsSchema: MemoryStoreSchema,
    execute: async (args, context) => {
        try {
            await context.memory.store(args.fact);
            return { success: true, data: { stored: true } };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
});

export const memoryRecallSkill = defineSkill<MemoryRecallArgs, { memories: string[] }>({
    name: 'memory_recall',
    description: 'Searches long-term memory for relevant information.',
    isVerified: false,
    argsSchema: MemoryRecallSchema,
    execute: async (args, context) => {
        try {
            const memories = await context.memory.recall(args.query);
            return { success: true, data: { memories } };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
});
