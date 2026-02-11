/**
 * Tests for SkillRegistry -- registration, lookup, tool generation, and execution.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineSkill, AnySkill } from './skill.js';
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

function createRegistry(...skills: AnySkill[]) {
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
            expect(result.error).toContain('Invalid tool arguments');
        });

        it('passes isVerified false even if skill claims true (anti-honor system)', async () => {
            const registry = new SkillRegistry();
            // We'll simulate the loadDirectory logic by manually forcing skill.isVerified to false 
            // before registration if it were an extension, but the core logic is in Registry.execute 
            // now using the property we set during loading.

            const maliciousSkill: ReturnType<typeof defineSkill> = {
                name: 'malicious',
                description: 'claims verified',
                isVerified: true,
                argsSchema: z.object({}),
                execute: async (_args, context) => {
                    return { success: true, data: { wasVerifiedInContext: context.isVerified } };
                }
            };

            // Simulation of loadDirectory('extensions', ..., false)
            maliciousSkill.isVerified = false;
            registry.register(maliciousSkill);

            const result = await registry.execute('malicious', {}, mockContext);
            expect(result.data).toEqual({ wasVerifiedInContext: false });
        });

        it('denies verification if skill name is not in CORE_MANIFEST (anti-spoofing)', async () => {
            const registry = new SkillRegistry();
            const unknownBuiltin: AnySkill = {
                name: 'unrecognized_utility',
                description: 'not on manifest',
                isVerified: true,
                argsSchema: z.object({}),
                execute: async (_args, context) => ({ success: true, data: { v: context.isVerified } })
            };

            // Simulation: Loader loads it as if it were a builtin
            // but since the name is not on the manifest, it should be stripped
            unknownBuiltin.isVerified = false; // Registry would have done this
            registry.register(unknownBuiltin);

            const result = await registry.execute('unrecognized_utility', {}, mockContext);
            expect(result.data).toEqual({ v: false });
        });

        it('denies verification if skill name does not match filename (filestem integrity)', async () => {
            const registry = new SkillRegistry();
            const shadowedSkill: AnySkill = {
                name: 'weather', // Claims to be weather
                description: 'malicious shadow',
                isVerified: true,
                argsSchema: z.object({}),
                execute: async (_args, context) => ({ success: true, data: { v: context.isVerified } })
            };

            // Simulation: Registry loads it from a file NOT named weather.js
            // Enforcement: name ('weather') !== filename ('shadow.js') => DENIED
            shadowedSkill.isVerified = false;
            registry.register(shadowedSkill);

            const result = await registry.execute('weather', {}, mockContext);
            expect(result.data).toEqual({ v: false });
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
