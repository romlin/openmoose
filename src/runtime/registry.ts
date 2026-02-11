/**
 * Skill registry -- manages registration, lookup, validation, and
 * execution of all built-in and custom agent skills.
 */

import { Skill, SkillContext, SkillResult, zodToJsonSchema, AnySkill } from './skill.js';
import type { OpenAITool } from '../agents/brain.js';
import { logger } from '../infra/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import url, { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { isVettedCoreSkill, verifyFilestemIntegrity } from './manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SkillRegistry - Manages all available skills for the agent
 */
export class SkillRegistry {
    private readonly skills: Map<string, AnySkill> = new Map();

    constructor() { }

    /**
     * Load built-in default skills dynamically from the builtins directory
     */
    async loadDefaults(): Promise<void> {
        const builtinsDir = path.join(__dirname, 'skills', 'builtins');
        await this.loadDirectory(builtinsDir, 'Built-in', true);
    }

    /**
     * Load custom skills from a directory
     */
    async loadExtensions(directory: string): Promise<void> {
        await this.loadDirectory(directory, 'Extension', false);
    }

    /**
     * Internal helper to load all .js/.ts files from a directory
     */
    private async loadDirectory(directory: string, type: string, isBuiltin: boolean): Promise<void> {
        let realBuiltinsDir: string | null = null;
        if (isBuiltin) {
            try {
                realBuiltinsDir = await fs.realpath(directory);
            } catch {
                realBuiltinsDir = path.resolve(directory);
            }
        }

        try {
            await fs.access(directory);
        } catch {
            logger.debug(`Skill directory not found: ${directory}`, 'Registry');
            return; // Directory doesn't exist, skip
        }

        const files = await fs.readdir(directory);

        for (const file of files) {
            if (file.endsWith('.js') || (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'))) {
                try {
                    const filePath = path.join(directory, file);
                    const realFilePath = await fs.realpath(filePath).catch(() => filePath);
                    const fileNameNoExt = path.basename(file, path.extname(file));
                    const module = await import(url.pathToFileURL(realFilePath).href);

                    // Scavenge all exports for objects conforming to the Skill interface.
                    // This supports files that export multiple skills (like memory.ts) 
                    // and refactored built-ins using named exports instead of defaults.
                    for (const exportName of Object.keys(module)) {
                        const skill = module[exportName];
                        if (skill?.name && typeof skill?.execute === 'function') {
                            // Anti-Spoofing: Verified status requires FOUR checkboxes:
                            // 1. Loader was told this is a builtin directory
                            // 2. Physical file actually resides in the real builtins directory
                            // 3. The skill name is on the vetted CORE_SKILL_MANIFEST
                            // 4. Filestem Integrity: Name must match filename via manifest mapping
                            const isPhysicallyBuiltin = isBuiltin && realBuiltinsDir !== null && realFilePath.startsWith(realBuiltinsDir);
                            const isVettedName = isVettedCoreSkill(skill.name);
                            const hasFilestemIntegrity = verifyFilestemIntegrity(skill.name, fileNameNoExt);
                            const isVerified = isPhysicallyBuiltin && isVettedName && hasFilestemIntegrity;

                            if (skill.isVerified !== isVerified) {
                                if (skill.isVerified && !isVerified) {
                                    let reason = 'unrecognized name';
                                    if (!isPhysicallyBuiltin) reason = 'untrusted location';
                                    else if (!hasFilestemIntegrity) reason = 'filestem mismatch';

                                    logger.warn(`Plugin ${skill.name} in ${file} attempted host access. Denied (${reason})`, 'Registry');
                                }
                                skill.isVerified = isVerified;
                            }
                            this.register(skill);
                        }
                    }
                } catch (e) {
                    logger.error(`Failed to load ${type} skill from ${file}: ${e}`, 'Registry');
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
     * Translate technical Zod errors into concise human-friendly feedback.
     */
    private formatZodError(error: ZodError): string {
        try {
            const issues = error.issues || [];
            if (issues.length === 0) return error.message;

            const fields = issues.map((i) => {
                const path = i.path.join('.') || 'input';
                return `"${path}": ${i.message}`;
            });
            return `Invalid tool arguments: ${fields.join(', ')}`;
        } catch {
            return error.message;
        }
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
                error: this.formatZodError(parsed.error)
            };
        }

        try {
            return await skill.execute(parsed.data, verifiedContext);
        } catch (e) {
            logger.error(`Logic error in skill ${name}: ${e}`, 'Registry');
            return { success: false, error: `Skill execution failed: ${e instanceof Error ? e.message : String(e)}` };
        }
    }
}
