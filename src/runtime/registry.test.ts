/**
 * Tests for SkillRegistry -- registration, lookup, tool generation, and execution.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineSkill } from './skill.js';
import { SkillRegistry } from './registry.js';

const echoSkill = defineSkill({
    name: 'echo',
    description: 'Echoes input back',
    isVerified: false,
    argsSchema: z.object({ text: z.string() }),
    execute: async (args) => ({ success: true, data: { text: args.text } }),
});

const failSkill = defineSkill({
    name: 'fail',
    description: 'Always fails',
    isVerified: true,
    argsSchema: z.object({ reason: z.string() }),
    execute: async (args) => ({ success: false, error: args.reason }),
});

function createRegistry(...skills: ReturnType<typeof defineSkill>[]) {
    const registry = new SkillRegistry();
    for (const skill of skills) {
        registry.register(skill);
    }
    return registry;
}

// Minimal mock context (only structure matters, not real services)
const mockContext = {
    memory: {} as never,
    sandbox: {} as never,
    brain: {} as never,
    scheduler: {} as never,
    whatsapp: {} as never,
};

describe('SkillRegistry', () => {
    describe('register & get', () => {
        it('registers and retrieves a skill by name', () => {
            const registry = createRegistry(echoSkill);
            expect(registry.get('echo')).toBeDefined();
            expect(registry.get('echo')?.name).toBe('echo');
        });

        it('returns undefined for unregistered skill', () => {
            const registry = createRegistry();
            expect(registry.get('nope')).toBeUndefined();
        });
    });

    describe('getAll', () => {
        it('returns all registered skills', () => {
            const registry = createRegistry(echoSkill, failSkill);
            const all = registry.getAll();
            expect(all).toHaveLength(2);
            const names = all.map(s => s.name);
            expect(names).toContain('echo');
            expect(names).toContain('fail');
        });
    });

    describe('getOpenAITools', () => {
        it('generates OpenAI-format tool definitions', () => {
            const registry = createRegistry(echoSkill);
            const tools = registry.getOpenAITools();

            expect(tools).toHaveLength(1);
            expect(tools[0].type).toBe('function');
            expect(tools[0].function.name).toBe('echo');
            expect(tools[0].function.description).toBe('Echoes input back');
            expect(tools[0].function.parameters).toHaveProperty('type', 'object');
        });
    });

    describe('getPromptDefinitions', () => {
        it('generates skill list for system prompt', () => {
            const registry = createRegistry(echoSkill, failSkill);
            const prompt = registry.getPromptDefinitions();

            expect(prompt).toContain('echo: Echoes input back');
            expect(prompt).toContain('fail: Always fails');
        });
    });

    describe('execute', () => {
        it('executes a valid skill with correct args', async () => {
            const registry = createRegistry(echoSkill);
            const result = await registry.execute('echo', { text: 'hello' }, mockContext);

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ text: 'hello' });
        });

        it('returns error for unknown skill', async () => {
            const registry = createRegistry();
            const result = await registry.execute('missing', {}, mockContext);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unknown skill');
        });

        it('returns validation error for invalid args', async () => {
            const registry = createRegistry(echoSkill);
            const result = await registry.execute('echo', { text: 42 }, mockContext);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid arguments');
        });

        it('passes isVerified from skill definition into context', async () => {
            let receivedVerified: boolean | undefined;
            const spy = defineSkill({
                name: 'spy',
                description: 'spy',
                isVerified: true,
                argsSchema: z.object({}),
                execute: async (_args, ctx) => {
                    receivedVerified = ctx.isVerified;
                    return { success: true, data: null };
                },
            });

            const registry = createRegistry(spy);
            await registry.execute('spy', {}, mockContext);

            expect(receivedVerified).toBe(true);
        });
    });
});
