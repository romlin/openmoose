/**
 * Memory tools -- store and recall facts using the vector memory.
 */

import { z } from 'zod';
import { defineSkill } from '../../skill.js';

const MemoryStoreSchema = z.object({
    fact: z.string().describe('The fact or information to remember')
});

const MemoryRecallSchema = z.object({
    query: z.string().describe('Search query to find relevant memories')
});

export const memoryStoreSkill = defineSkill({
    name: 'memory_store',
    description: 'Stores a fact in long-term memory for future recall.',
    isVerified: true,
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

export const memoryRecallSkill = defineSkill({
    name: 'memory_recall',
    description: 'Searches long-term memory for relevant information.',
    isVerified: true,
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
