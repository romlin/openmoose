import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shellEscape, PortableSkillLoader } from './portable-skills.js';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';

vi.mock('node:child_process', () => ({
    exec: vi.fn()
}));

vi.mock('node:fs/promises');

/** Sets up a promisify.custom mock on the mocked exec function. */
function mockExecPromisify(impl: (...args: unknown[]) => Promise<unknown>) {
    const mockExec = vi.mocked(exec);
    (mockExec as unknown as Record<symbol | string, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = impl;
    return impl;
}

/** Creates a minimal host skill YAML definition. */
function hostSkillYaml(name: string, command: string): string {
    return `
name: ${name}
description: test
examples: ["test"]
host: true
command: "${command}"
`;
}

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

    it('injects {{open}} placeholder', () => {
        const result = PortableSkillLoader.interpolateCommand('{{open}} {{url}}', { url: 'http://google.com' });
        // result should contain xdg-open (Linux), open (macOS) or start (Windows)
        // Since we are running on Linux in this environment:
        expect(result).toMatch(/(xdg-open|open|start) 'http:\/\/google.com'/);
    });
});

describe('PortableSkillLoader.execute (host)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes commands on host when host: true', async () => {
        const customPromisify = mockExecPromisify(
            vi.fn().mockResolvedValue({ stdout: 'Success', stderr: '' })
        );

        vi.mocked(fs.readFile).mockResolvedValue(hostSkillYaml('test-host', 'echo {{val}}'));

        const route = await PortableSkillLoader.loadFile('test.yaml');
        expect(route).not.toBeNull();

        const result = await route!.execute({ val: 'hello' }, undefined, undefined);
        expect(result.success).toBe(true);
        expect(result.result).toBe('Success');
        expect(customPromisify).toHaveBeenCalledWith(expect.stringContaining("'hello'"), expect.any(Object));
    });

    it('handles host execution timeout', async () => {
        const err = new Error('cmd timed out');
        (err as unknown as Record<string, unknown>).code = 'ETIMEDOUT';
        mockExecPromisify(vi.fn().mockRejectedValue(err));

        vi.mocked(fs.readFile).mockResolvedValue(hostSkillYaml('test-timeout', 'sleep 10'));

        const route = await PortableSkillLoader.loadFile('test.yaml');
        const result = await route!.execute({}, undefined, undefined);
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });

    it('handles host execution failures', async () => {
        mockExecPromisify(vi.fn().mockRejectedValue(new Error('command not found')));

        vi.mocked(fs.readFile).mockResolvedValue(hostSkillYaml('test-fail', 'fakecommand'));

        const route = await PortableSkillLoader.loadFile('test.yaml');
        const result = await route!.execute({}, undefined, undefined);
        expect(result.success).toBe(false);
        expect(result.error).toContain('failed');
    });

    it('warns when host dependencies are missing', async () => {
        mockExecPromisify(vi.fn().mockImplementation((cmd: string) => {
            if (cmd.startsWith('command -v') || cmd.startsWith('where')) {
                return Promise.reject(new Error('not found'));
            }
            return Promise.resolve({ stdout: 'Success', stderr: '' });
        }));

        const { logger } = await import('../infra/logger.js');
        const warnSpy = vi.spyOn(logger, 'warn');

        vi.mocked(fs.readFile).mockResolvedValue(hostSkillYaml('test-deps', 'yt-dlp --version'));

        const route = await PortableSkillLoader.loadFile('test.yaml');
        await route!.execute({}, undefined, undefined);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Missing host dependencies for skill: yt-dlp'),
            'Security'
        );
    });
});
