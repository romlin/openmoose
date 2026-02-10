import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, defineSkill } from './skill.js';

describe('zodToJsonSchema', () => {
    it('converts a simple object schema with string and number fields', () => {
        const schema = z.object({
            name: z.string(),
            age: z.number(),
        });
        const result = zodToJsonSchema(schema);

        expect(result).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name', 'age'],
        });
    });

    it('handles boolean fields', () => {
        const schema = z.object({
            active: z.boolean(),
        });
        const result = zodToJsonSchema(schema);

        expect(result.properties).toEqual({
            active: { type: 'boolean' },
        });
        expect(result.required).toEqual(['active']);
    });

    it('handles optional fields (excluded from required)', () => {
        const schema = z.object({
            name: z.string(),
            nickname: z.string().optional(),
        });
        const result = zodToJsonSchema(schema);

        expect(result.properties).toHaveProperty('name');
        expect(result.properties).toHaveProperty('nickname');
        expect(result.required).toEqual(['name']);
    });

    it('handles an empty object schema', () => {
        const schema = z.object({});
        const result = zodToJsonSchema(schema);

        expect(result).toEqual({
            type: 'object',
            properties: {},
            required: undefined,
        });
    });

    it('returns fallback for non-object schemas', () => {
        const schema = z.string();
        const result = zodToJsonSchema(schema);

        expect(result).toEqual({ type: 'object', properties: {} });
    });

    it('handles enum fields', () => {
        const schema = z.object({
            color: z.enum(['red', 'green', 'blue']),
        });
        const result = zodToJsonSchema(schema);

        expect(result.properties).toEqual({
            color: { type: 'string', enum: ['red', 'green', 'blue'] },
        });
    });

    it('handles array fields', () => {
        const schema = z.object({
            tags: z.array(z.string()),
        });
        const result = zodToJsonSchema(schema);

        expect(result.properties).toEqual({
            tags: { type: 'array', items: { type: 'string' } },
        });
    });

    it('preserves description() annotations', () => {
        const schema = z.object({
            code: z.string().describe('Python code to execute'),
        });
        const result = zodToJsonSchema(schema);

        expect(result.properties).toEqual({
            code: { type: 'string', description: 'Python code to execute' },
        });
    });

    it('handles laxNumber (union of number and string-to-number transform)', () => {
        const laxNumber = z.union([
            z.number(),
            z.string().transform(Number).refine(v => !Number.isNaN(v)),
        ]);
        const schema = z.object({
            id: laxNumber,
        });
        const result = zodToJsonSchema(schema);

        // It should pick 'number' as the most relevant type for this union
        expect(result.properties).toEqual({
            id: { type: 'number' },
        });
    });

    it('handles nested objects with descriptions', () => {
        const schema = z.object({
            options: z.object({
                retries: z.number().describe('Number of retries'),
            }).describe('Operation options'),
        });
        const result = zodToJsonSchema(schema);

        expect(result.properties).toEqual({
            options: {
                type: 'object',
                description: 'Operation options',
                properties: {
                    retries: { type: 'number', description: 'Number of retries' },
                },
                required: ['retries'],
            },
        });
    });
});

describe('defineSkill', () => {
    it('returns the config object unchanged', () => {
        const config = {
            name: 'test_skill',
            description: 'A test skill',
            isVerified: false,
            argsSchema: z.object({ input: z.string() }),
            execute: async () => ({ success: true, data: 'ok' }),
        };
        const result = defineSkill(config);

        expect(result).toBe(config);
        expect(result.name).toBe('test_skill');
    });
});
