/**
 * SKILL.md loader -- discovers and parses skill metadata from YAML frontmatter
 * in SKILL.md files, and generates XML capability prompts for the LLM.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../infra/logger.js';

/**
 * Parsed SKILL.md metadata
 */
export interface SkillEntry {
    name: string;
    description: string;
    location: string;  // Path to SKILL.md
    emoji?: string;
    requires?: {
        bins?: string[];
    };
}

/**
 * Parse YAML frontmatter from SKILL.md
 */
function parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const result: Record<string, unknown> = {};

    // Simple YAML parsing for key: value pairs
    for (const line of yaml.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();

        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (key && value) {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Load all SKILL.md entries from a directory
 */
export async function loadSkillEntries(skillsDir: string): Promise<SkillEntry[]> {
    const entries: SkillEntry[] = [];

    try {
        const dirs = await readdir(skillsDir, { withFileTypes: true });

        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;

            const skillPath = join(skillsDir, dir.name, 'SKILL.md');
            try {
                const content = await readFile(skillPath, 'utf-8');
                const frontmatter = parseFrontmatter(content);

                if (frontmatter.name && frontmatter.description) {
                    entries.push({
                        name: String(frontmatter.name),
                        description: String(frontmatter.description),
                        location: skillPath,
                    });
                    logger.debug(`Loaded: ${frontmatter.name}`, 'Skills');
                }
            } catch (err) {
                // SKILL.md doesn't exist in this directory, or other read error
                logger.debug(`Failed to load skill from ${skillPath}: ${err}`, 'Skills');
            }
        }
    } catch (err) {
        // Skills directory doesn't exist, that's ok
        logger.debug(`Skills directory ${skillsDir} not found or accessible: ${err}`, 'Skills');
    }

    return entries;
}

/**
 * Build XML prompt section for moose capabilities
 */
export function buildSkillsPrompt(entries: SkillEntry[]): string {
    if (entries.length === 0) return '';

    const lines = [
        '<moose_capabilities>',
    ];

    for (const skill of entries) {
        lines.push('  <capability>');
        lines.push(`    <name>${escapeXml(skill.name)}</name>`);
        lines.push(`    <description>${escapeXml(skill.description)}</description>`);
        lines.push('  </capability>');
    }

    lines.push('</moose_capabilities>');

    return lines.join('\n');
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
