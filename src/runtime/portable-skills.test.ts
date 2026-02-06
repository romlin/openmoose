import { describe, it, expect } from 'vitest';
import { shellEscape, PortableSkillLoader } from './portable-skills.js';

describe('shellEscape', () => {
    it('wraps a simple string in single quotes', () => {
        expect(shellEscape('hello')).toBe("'hello'");
    });

    it('escapes embedded single quotes', () => {
        expect(shellEscape("it's")).toBe("'it'\\''s'");
    });

    it('handles empty strings', () => {
        expect(shellEscape('')).toBe("''");
    });

    it('handles strings with spaces', () => {
        expect(shellEscape('hello world')).toBe("'hello world'");
    });

    it('handles strings with special shell characters', () => {
        const result = shellEscape('$(rm -rf /)');
        expect(result).toBe("'$(rm -rf /)'");
    });

    it('handles strings with backticks', () => {
        const result = shellEscape('`whoami`');
        expect(result).toBe("'`whoami`'");
    });

    it('handles strings with semicolons and pipes', () => {
        const result = shellEscape('foo; bar | baz');
        expect(result).toBe("'foo; bar | baz'");
    });

    it('handles strings with multiple single quotes', () => {
        const result = shellEscape("a'b'c");
        expect(result).toBe("'a'\\''b'\\''c'");
    });
});

describe('PortableSkillLoader.interpolateCommand', () => {
    it('replaces a simple placeholder', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'echo {{city}}',
            { city: 'Stockholm' }
        );
        expect(result).toBe("echo 'Stockholm'");
    });

    it('replaces multiple placeholders', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'curl {{url}} -o {{file}}',
            { url: 'https://example.com', file: 'out.txt' }
        );
        expect(result).toBe("curl 'https://example.com' -o 'out.txt'");
    });

    it('replaces URL-encoded variant with |u', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'curl "https://api.com?q={{query|u}}"',
            { query: 'hello world' }
        );
        expect(result).toBe('curl "https://api.com?q=hello%20world"');
    });

    it('replaces {{context}} with shell-escaped context', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'echo {{context}}',
            {},
            'user context'
        );
        expect(result).toBe("echo 'user context'");
    });

    it('falls back to context for {{text}} and {{message}} when not in args', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'echo {{text}}',
            {},
            'fallback message'
        );
        expect(result).toBe("echo 'fallback message'");
    });

    it('removes unmatched placeholders', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'echo {{missing}}',
            {}
        );
        expect(result).toBe('echo ');
    });

    it('shell-escapes dangerous input in args', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'echo {{input}}',
            { input: "'; rm -rf / #" }
        );
        // The value is shell-escaped: wrapped in single quotes with embedded quote escaped
        expect(result).toBe(shellEscape("'; rm -rf / #").replace(/^/, 'echo '));
    });

    it('does not replace arg placeholders with context when args have the key', () => {
        const result = PortableSkillLoader.interpolateCommand(
            'echo {{text}}',
            { text: 'from args' },
            'from context'
        );
        expect(result).toBe("echo 'from args'");
    });
});
