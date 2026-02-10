/**
 * Portable skill loader -- loads YAML-defined skills and converts them
 * into executable SkillRoute objects with shell-escaped command interpolation.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { SkillRoute } from './semantic-router.js';
import { SkillContext } from './skill.js';
import { logger } from '../infra/logger.js';
import { getErrorMessage } from '../infra/errors.js';
import { config } from '../config/index.js';

interface PortableSkillDef {
    name: string;
    description: string;
    examples: string[];
    args?: Record<string, { patterns: string[], fallback?: string }>;
    command: string; // The shell command to run (with {{arg}} placeholders)
    host?: boolean;  // Whether to run on the host machine instead of the sandbox
    image?: string; // Optional custom Docker image
}

/**
 * Escape a string for safe inclusion in a shell command.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
export function shellEscape(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * PortableSkillLoader - Loads skills from YAML files
 * making them easy to expand without writing TypeScript
 */
export class PortableSkillLoader {
    /**
     * Loads all .yaml files from the given directory
     */
    static async loadDirectory(dirPath: string): Promise<SkillRoute[]> {
        const routes: SkillRoute[] = [];

        try {
            const files = await fs.readdir(dirPath);
            const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

            for (const file of yamlFiles) {
                const filePath = path.join(dirPath, file);
                const route = await this.loadFile(filePath);
                if (route) {
                    routes.push(route);
                    logger.debug(`Loaded skill: ${route.name} (${file})`, 'Skills');
                }
            }
        } catch (error) {
            logger.error(`Failed to load skills directory`, 'Skills', error);
        }

        return routes;
    }

    /**
     * Loads a single YAML skill file
     */
    static async loadFile(filePath: string): Promise<SkillRoute | null> {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const def = yaml.load(content) as PortableSkillDef;

            return {
                name: def.name,
                description: def.description,
                examples: def.examples,
                host: def.host,
                extractArgs: (message: string) => {
                    const args: Record<string, string> = {};

                    if (def.args) {
                        for (const [argName, argDef] of Object.entries(def.args)) {
                            let found = false;
                            for (const patternStr of argDef.patterns) {
                                const pattern = new RegExp(patternStr, 'i');
                                const match = message.match(pattern);
                                if (match) {
                                    args[argName] = match[1].trim();
                                    found = true;
                                    break;
                                }
                            }
                            if (!found && argDef.fallback) {
                                args[argName] = argDef.fallback;
                            }
                        }
                    }

                    return args;
                },
                execute: async (args: Record<string, string>, context?: string, skillContext?: SkillContext) => {
                    const finalCommand = PortableSkillLoader.interpolateCommand(def.command, args, context);

                    try {
                        if (def.host) {
                            const { exec } = await import('node:child_process');
                            const { promisify } = await import('node:util');
                            const execAsync = promisify(exec);

                            try {
                                const { stdout, stderr } = await execAsync(finalCommand, { timeout: config.skills.timeoutMs });
                                if (stderr) logger.debug(`Host command stderr: ${stderr.trim()}`, 'Security');
                                return { success: true, result: stdout.trim() || 'Success' };
                            } catch (err) {
                                return { success: false, error: `Host execution failed or timed out: ${getErrorMessage(err)}` };
                            }
                        }

                        const sandboxToUse = skillContext?.sandbox;
                        if (!sandboxToUse) {
                            return { success: false, error: 'Sandbox not available in context' };
                        }

                        const result = await sandboxToUse.run(finalCommand, {
                            timeout: config.skills.timeoutMs,
                            image: def.image,
                            workspacePath: process.cwd(),
                            readonlyWorkspace: true
                        });

                        if (result.exitCode === 0) {
                            return { success: true, result: result.stdout.trim() };
                        } else {
                            return { success: false, error: result.stderr.trim() || 'Command failed' };
                        }
                    } catch (error) {
                        return { success: false, error: getErrorMessage(error) };
                    }
                }
            };
        } catch (error) {
            logger.error(`Failed to load skill file ${filePath}`, 'Skills', error);
            return null;
        }
    }

    /**
     * Helper to interpolate placeholders in a command string.
     * Values are shell-escaped to prevent injection.
     */
    static interpolateCommand(command: string, args: Record<string, string>, context?: string): string {
        let interpolated = command;

        // 1. Interpolate explicit args: {{city}} -> 'Stockholm' (shell-escaped)
        for (const [key, value] of Object.entries(args)) {
            const escaped = shellEscape(value);
            interpolated = interpolated.replace(new RegExp(`{{${key}}}`, 'g'), escaped);
            interpolated = interpolated.replace(new RegExp(`{{${key}\\|u}}`, 'g'), encodeURIComponent(value));
        }

        // 2. Interpolate {{context}} or {{context|u}}
        if (context) {
            const escapedContext = shellEscape(context);
            interpolated = interpolated.replace(/{{context}}/g, escapedContext);
            interpolated = interpolated.replace(/{{context\|u}}/g, encodeURIComponent(context));
        }

        // 3. Fallback: If "text" or "message" are missing but we have context
        if (context && !args.text && !args.message) {
            const escapedContext = shellEscape(context);
            interpolated = interpolated.replace(/{{text}}|{{message}}/g, escapedContext);
            interpolated = interpolated.replace(/{{text\|u}}|{{message\|u}}/g, encodeURIComponent(context));
        }

        // 4. Clean up any remaining placeholders
        return interpolated.replace(/{{[a-zA-Z0-9_]+}}/g, '');
    }
}
