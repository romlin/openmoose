/**
 * Tests for shell execution tool.
 */

import { describe, it, expect, vi } from 'vitest';
import { shellSkill } from './shell.js';

const mockContext = {
    sandbox: {
        run: vi.fn(),
    },
    memory: {} as never,
    brain: {} as never,
    scheduler: {} as never,
};

describe('shellSkill', () => {
    it('has correct metadata', () => {
        expect(shellSkill.name).toBe('shell_execute');
        expect(shellSkill.isVerified).toBe(false);
    });

    it('executes command via sandbox.run', async () => {
        mockContext.sandbox.run.mockResolvedValue({ stdout: 'hello', stderr: '', exitCode: 0 });
        const result = await shellSkill.execute({ command: 'echo hello' }, mockContext as never);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
        expect(mockContext.sandbox.run).toHaveBeenCalledWith('echo hello');
    });

    it('returns error on sandbox failure', async () => {
        mockContext.sandbox.run.mockRejectedValue(new Error('Docker not found'));
        const result = await shellSkill.execute({ command: 'ls' }, mockContext as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Docker not found');
    });

    it('validates args schema requires command string', () => {
        const valid = shellSkill.argsSchema.safeParse({ command: 'ls -la' });
        expect(valid.success).toBe(true);

        const invalid = shellSkill.argsSchema.safeParse({});
        expect(invalid.success).toBe(false);
    });
});
