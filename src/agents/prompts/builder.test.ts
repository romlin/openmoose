/**
 * Tests for PromptBuilder -- system prompt construction.
 */

import { describe, it, expect } from 'vitest';
import { PromptBuilder } from './builder.js';
import { SkillRegistry } from '../../runtime/registry.js';
import { z } from 'zod';
import { defineSkill } from '../../runtime/skill.js';

function createBuilder(): PromptBuilder {
    const registry = new SkillRegistry();
    registry.register(defineSkill({
        name: 'test_tool',
        description: 'A test tool',
        isVerified: false,
        argsSchema: z.object({}),
        execute: async () => ({ success: true, data: null }),
    }));
    return new PromptBuilder(registry);
}

describe('PromptBuilder', () => {
    it('includes the assistant identity', () => {
        const builder = createBuilder();
        const prompt = builder.build();
        expect(prompt).toContain('OpenMoose');
    });

    it('includes tool definitions from the registry', () => {
        const builder = createBuilder();
        const prompt = builder.build();
        expect(prompt).toContain('test_tool');
        expect(prompt).toContain('A test tool');
    });

    it('includes current date and time', () => {
        const builder = createBuilder();
        const prompt = builder.build();
        expect(prompt).toContain('Current Date & Time');
    });

    it('includes memory context when provided', () => {
        const builder = createBuilder();
        const prompt = builder.build(undefined, '- User likes cats\n- User is named Alice');
        expect(prompt).toContain('Memory');
        expect(prompt).toContain('User likes cats');
        expect(prompt).toContain('User is named Alice');
    });

    it('omits memory section when no context provided', () => {
        const builder = createBuilder();
        const prompt = builder.build();
        expect(prompt).not.toContain('## Memory');
    });

    it('includes browser task instructions', () => {
        const builder = createBuilder();
        const prompt = builder.build();
        expect(prompt).toContain('browser_action');
    });
});
