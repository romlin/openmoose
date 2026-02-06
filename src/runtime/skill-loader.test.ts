import { describe, it, expect } from 'vitest';
import { buildSkillsPrompt, type SkillEntry } from './skill-loader.js';

describe('buildSkillsPrompt', () => {
    it('returns empty string for empty entries', () => {
        expect(buildSkillsPrompt([])).toBe('');
    });

    it('generates valid XML for a single entry', () => {
        const entries: SkillEntry[] = [{
            name: 'weather',
            description: 'Get current weather',
            location: '/skills/weather/SKILL.md',
        }];
        const result = buildSkillsPrompt(entries);

        expect(result).toContain('<moose_capabilities>');
        expect(result).toContain('</moose_capabilities>');
        expect(result).toContain('<name>weather</name>');
        expect(result).toContain('<description>Get current weather</description>');
        expect(result).toContain('<location>/skills/weather/SKILL.md</location>');
    });

    it('generates XML for multiple entries', () => {
        const entries: SkillEntry[] = [
            { name: 'weather', description: 'Get weather', location: '/a' },
            { name: 'time', description: 'Get time', location: '/b' },
        ];
        const result = buildSkillsPrompt(entries);

        const capabilityCount = (result.match(/<capability>/g) || []).length;
        expect(capabilityCount).toBe(2);
    });

    it('escapes XML special characters', () => {
        const entries: SkillEntry[] = [{
            name: 'test & <demo>',
            description: 'Handles "quotes" & \'apostrophes\'',
            location: '/path/to/skill',
        }];
        const result = buildSkillsPrompt(entries);

        expect(result).toContain('&amp;');
        expect(result).toContain('&lt;');
        expect(result).toContain('&gt;');
        expect(result).toContain('&quot;');
        expect(result).toContain('&apos;');
        expect(result).not.toContain('<demo>');
    });
});
