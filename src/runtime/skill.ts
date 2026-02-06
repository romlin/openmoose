/**
 * Core skill type definitions and utilities.
 * Provides the Skill interface, SkillContext, defineSkill helper, and
 * a Zod-to-JSON-Schema converter for OpenAI tool definitions.
 */

import { z } from 'zod';
import type { LocalMemory } from '../infra/memory.js';
import type { LocalSandbox } from '../infra/sandbox.js';
import type { LocalBrain } from '../agents/brain.js';
import type { TaskScheduler } from './scheduler.js';
import type { WhatsAppManager } from '../infra/whatsapp.js';

/**
 * Skill execution context - typed dependencies
 */
export interface SkillContext {
    memory: LocalMemory;
    sandbox: LocalSandbox;
    brain: LocalBrain;
    scheduler: TaskScheduler;
    whatsapp?: WhatsAppManager;
    isVerified?: boolean;
}

/**
 * Skill result - always returns structured data
 */
export interface SkillResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Base skill interface with generic type for arguments
 */
export interface Skill<TArgs = unknown, TResult = unknown> {
    /** Unique skill identifier */
    name: string;
    /** Human-readable description for LLM */
    description: string;
    /** Whether this skill is verified and allowed to run on the host */
    isVerified: boolean;
    /** Zod schema for argument validation */
    argsSchema: z.ZodType<TArgs>;
    /** Execute the skill with validated arguments */
    execute: (args: TArgs, context: SkillContext) => Promise<SkillResult<TResult>>;
}

/**
 * Helper to create a type-safe skill
 */
export function defineSkill<TArgs, TResult>(
    config: Skill<TArgs, TResult>
): Skill<TArgs, TResult> {
    return config;
}

/**
 * Convert Zod schema to JSON Schema for OpenAI tool definitions
 * Works with Zod v4 by checking constructor names
 */
export function zodToJsonSchema<T>(schema: z.ZodType<T>): Record<string, unknown> {
    const typeName = schema.constructor.name;

    if (typeName === 'ZodObject' || typeName === '$ZodObject') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const zodObj = schema as any;
        const shape = zodObj.shape || zodObj._zod?.shape || {};
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
            properties[key] = zodFieldToJsonSchema(value);

            // Check if field is required (not optional)
            const fieldTypeName = (value as { constructor: { name: string } })?.constructor?.name || '';
            if (!fieldTypeName.includes('Optional')) {
                required.push(key);
            }
        }

        return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
        };
    }

    // Fallback for non-object schemas
    return { type: 'object', properties: {} };
}

/**
 * Convert a single Zod field to JSON Schema (Zod v4 compatible)
 */
function zodFieldToJsonSchema(field: unknown): Record<string, unknown> {
    if (!field || typeof field !== 'object') {
        return { type: 'string' };
    }

    const typeName = (field as { constructor: { name: string } }).constructor.name;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = field as any;

    // Unwrap optional
    if (typeName.includes('Optional')) {
        const inner = f._def?.innerType || f._zod?.innerType;
        if (inner) return zodFieldToJsonSchema(inner);
    }

    // Unwrap nullable
    if (typeName.includes('Nullable')) {
        const inner = f._def?.innerType || f._zod?.innerType;
        if (inner) return zodFieldToJsonSchema(inner);
    }

    // Basic types
    if (typeName.includes('String')) {
        return { type: 'string' };
    }
    if (typeName.includes('Number')) {
        return { type: 'number' };
    }
    if (typeName.includes('Boolean')) {
        return { type: 'boolean' };
    }
    if (typeName.includes('Array')) {
        const itemType = f._def?.type || f._zod?.def?.element;
        return {
            type: 'array',
            items: itemType ? zodFieldToJsonSchema(itemType) : { type: 'string' },
        };
    }
    if (typeName.includes('Enum')) {
        const values = f._def?.values || f._zod?.def?.entries || [];
        return {
            type: 'string',
            enum: Array.isArray(values) ? values : Object.keys(values),
        };
    }
    if (typeName.includes('Object')) {
        return zodToJsonSchema(field as z.ZodType<unknown>);
    }

    // Default fallback
    return { type: 'string' };
}
