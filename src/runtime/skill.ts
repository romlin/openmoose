/**
 * Core skill type definitions and utilities.
 * Provides the Skill interface, SkillContext, defineSkill helper, and
 * a Zod-to-JSON-Schema converter for OpenAI tool definitions.
 */

import { z } from 'zod';

/**
 * Restricted capability interfaces for skills to interact with infrastructure
 * without full object access.
 */
export interface SandboxCapability {
    run(command: string, options?: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    runPython(code: string, options?: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    runNode(code: string, options?: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    runPlaywright(code: string, options?: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface MemoryCapability {
    store(text: string, source?: 'chat' | 'doc', metadata?: Record<string, unknown>): Promise<void>;
    recall(query: string, limit?: number): Promise<string[]>;
}

export interface MessagingCapability {
    send(to: string, text: string): Promise<void>;
}

/**
 * Skill execution context - capability-based dependencies
 */
export interface SkillContext {
    memory: MemoryCapability;
    sandbox: SandboxCapability;
    brain: {
        ask(prompt: string, options?: Record<string, unknown>): Promise<string>;
    };
    scheduler: {
        schedule(prompt: string, scheduleValue: string, type?: 'cron' | 'interval' | 'once'): Promise<string>;
    };
    whatsapp?: MessagingCapability;
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
 * Base skill interface with generic type for arguments.
 * Strong generic constraints ensure execute args match the schema.
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
 * AnySkill - Type-erased skill for registry storage while maintaining 
 * the internal execution contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySkill = Skill<any, any>;

/**
 * Helper to create a type-safe skill.
 * Automatically infers TArgs from the provided argsSchema.
 */
export function defineSkill<TSchema extends z.ZodTypeAny, TResult = unknown>(
    config: {
        name: string;
        description: string;
        isVerified: boolean;
        argsSchema: TSchema;
        execute: (args: z.infer<TSchema>, context: SkillContext) => Promise<SkillResult<TResult>>;
    }
): Skill<z.infer<TSchema>, TResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return config as any;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = field as any;
    const typeName = f.constructor?.name || '';
    const description = f.description || f._def?.description;

    let res: Record<string, unknown> = { type: 'string' };

    // Unwrap optional/nullable
    if (typeName.includes('Optional') || typeName.includes('Nullable')) {
        const inner = f._def?.innerType || f._zod?.innerType;
        if (inner) {
            res = zodFieldToJsonSchema(inner);
        }
    }
    // Unwrap effects (transforms, refines)
    else if (typeName.includes('Effects')) {
        const schema = f._def?.schema || f._zod?.schema;
        if (schema) {
            res = zodFieldToJsonSchema(schema);
        }
    }
    // Handle unions
    else if (typeName.includes('Union')) {
        const options = f._def?.options || f.options || [];
        if (options.length > 0) {
            // Simplify: pick the first option's type, or any non-string type if multiple exist
            const schemas = options.map((opt: unknown) => zodFieldToJsonSchema(opt));
            const distinctTypes = [...new Set(schemas.map((s: Record<string, unknown>) => s.type as string))];

            if (distinctTypes.length === 1) {
                res = { type: distinctTypes[0] };
            } else {
                // If mixed, use an array of types or just pick the most generic one
                res = { type: distinctTypes.includes('number') ? 'number' : 'string' };
            }
        }
    }
    // Basic types
    else if (typeName.includes('String')) {
        res = { type: 'string' };
    }
    else if (typeName.includes('Number')) {
        res = { type: 'number' };
    }
    else if (typeName.includes('Boolean')) {
        res = { type: 'boolean' };
    }
    else if (typeName.includes('Array')) {
        const itemType = f._def?.element || f._zod?.def?.element;
        res = {
            type: 'array',
            items: itemType ? zodFieldToJsonSchema(itemType) : { type: 'string' },
        };
    }
    else if (typeName.includes('Enum')) {
        const values = f._def?.values || f._zod?.def?.entries || [];
        res = {
            type: 'string',
            enum: Array.isArray(values) ? values : Object.keys(values),
        };
    }
    else if (typeName.includes('Object')) {
        res = zodToJsonSchema(field as z.ZodType<unknown>);
    }

    if (description) {
        res.description = description;
    }

    return res;
}
