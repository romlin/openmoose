/**
 * Tests for Python execution tool.
 */

import { describe, it, expect, vi } from 'vitest';
import { pythonSkill } from './python.js';

const mockContext = {
    sandbox: {
        runPython: vi.fn(),
    },
    memory: {} as never,
    brain: {} as never,
    scheduler: {} as never,
};

describe('pythonSkill', () => {
    it('has correct metadata', () => {
        expect(pythonSkill.name).toBe('python_execute');
        expect(pythonSkill.isVerified).toBe(false);
    });

    it('executes code via sandbox.runPython', async () => {
        mockContext.sandbox.runPython.mockResolvedValue({ stdout: '42', stderr: '', exitCode: 0 });
        const result = await pythonSkill.execute({ code: 'print(42)' }, mockContext as never);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ stdout: '42', stderr: '', exitCode: 0 });
        expect(mockContext.sandbox.runPython).toHaveBeenCalledWith('print(42)');
    });

    it('returns error on sandbox failure', async () => {
        mockContext.sandbox.runPython.mockRejectedValue(new Error('Timeout'));
        const result = await pythonSkill.execute({ code: 'while True: pass' }, mockContext as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Timeout');
    });

    it('validates args schema requires code string', () => {
        const valid = pythonSkill.argsSchema.safeParse({ code: 'print(1)' });
        expect(valid.success).toBe(true);

        const invalid = pythonSkill.argsSchema.safeParse({});
        expect(invalid.success).toBe(false);
    });
});
