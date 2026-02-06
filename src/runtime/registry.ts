/**
 * Skill registry -- manages registration, lookup, validation, and
 * execution of all built-in and custom agent skills.
 */

import { Skill, SkillContext, SkillResult, zodToJsonSchema } from './skill.js';
import type { OpenAITool } from '../agents/brain.js';
import { logger } from '../infra/logger.js';
import { pythonSkill } from '../tools/python.js';
import { shellSkill } from '../tools/shell.js';
import { memoryStoreSkill, memoryRecallSkill } from '../tools/memory.js';
import { readSkill } from '../tools/read.js';
import { listSkill } from '../tools/ls.js';
import { writeSkill } from '../tools/write.js';
import { browserActionSkill } from '../tools/browser.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySkill = Skill<any, any>;

/**
 * SkillRegistry - Manages all available skills for the agent
 * Note: Simple skills (weather, time, etc.) are handled by SemanticRouter
 */
export class SkillRegistry {
    private skills: Map<string, AnySkill> = new Map();

    constructor() { }

    /**
     * Load built-in default skills
     */
    loadDefaults(): void {
        this.register(pythonSkill);
        this.register(shellSkill);
        this.register(memoryStoreSkill);
        this.register(memoryRecallSkill);
        this.register(readSkill);
        this.register(listSkill);
        this.register(writeSkill);
        this.register(browserActionSkill);
    }

    /**
     * Load custom skills from a directory
     */
    async loadExtensions(directory: string): Promise<void> {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');

        try {
            await fs.access(directory);
        } catch {
            return; // Directory doesn't exist, skip silently
        }

        const files = await fs.readdir(directory);
        for (const file of files) {
            if (file.endsWith('.js') || (file.endsWith('.ts') && !file.endsWith('.d.ts'))) {
                try {
                    const fullPath = path.join(directory, file);
                    const module = await import(fullPath);

                    if (module.default?.name && module.default?.execute) {
                        this.register(module.default);
                    }
                } catch (e) {
                    logger.error(`Failed to load skill from ${file}: ${e}`, 'Registry');
                }
            }
        }
    }

    /**
     * Register a skill
     */
    register(skill: AnySkill): void {
        if (skill.name) {
            if (this.skills.has(skill.name)) {
                logger.warn(`Overwriting skill: ${skill.name}`, 'Registry');
            }
            this.skills.set(skill.name, skill);
            logger.debug(`Registered: ${skill.name}`, 'Registry');
        }
    }

    /**
     * Get a skill by name
     */
    get(name: string): Skill<unknown, unknown> | undefined {
        return this.skills.get(name);
    }

    /**
     * Get all registered skills
     */
    getAll(): Skill<unknown, unknown>[] {
        return Array.from(this.skills.values());
    }

    /**
     * Generate tool definitions for the system prompt (legacy, for reference)
     */
    getPromptDefinitions(): string {
        return this.getAll()
            .map(s => `- ${s.name}: ${s.description}`)
            .join('\n');
    }

    /**
     * Generate OpenAI-format tool definitions for API calls
     */
    getOpenAITools(): OpenAITool[] {
        return this.getAll().map(skill => ({
            type: 'function' as const,
            function: {
                name: skill.name,
                description: skill.description,
                parameters: zodToJsonSchema(skill.argsSchema),
            },
        }));
    }

    /**
     * Validate and execute a skill with its Zod schema
     */
    async execute(name: string, args: unknown, context: SkillContext): Promise<SkillResult> {
        const skill = this.get(name);
        if (!skill) {
            return { success: false, error: `Unknown skill: ${name}` };
        }

        // Trust only what is explicitly marked as verified in the skill definition
        const verifiedContext = { ...context, isVerified: skill.isVerified };

        // Validate args with Zod
        const parsed = skill.argsSchema.safeParse(args);
        if (!parsed.success) {
            return {
                success: false,
                error: `Invalid arguments: ${parsed.error.message}`
            };
        }

        return await skill.execute(parsed.data, verifiedContext);
    }
}
