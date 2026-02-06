/**
 * Tests for browser automation tool.
 */

import { describe, it, expect, vi } from 'vitest';
import { browserActionSkill } from './browser.js';

const mockContext = {
    sandbox: {
        runPlaywright: vi.fn(),
    },
    memory: {} as never,
    brain: {} as never,
    scheduler: {} as never,
};

describe('browserActionSkill', () => {
    it('has correct metadata', () => {
        expect(browserActionSkill.name).toBe('browser_action');
        expect(browserActionSkill.isVerified).toBe(false);
    });

    it('parses successful Playwright result', async () => {
        mockContext.sandbox.runPlaywright.mockResolvedValue({
            stdout: 'PLAYWRIGHT_RESULT:{"success":true,"url":"https://example.com"}',
            stderr: '',
            exitCode: 0,
        });

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://example.com' }], timeout: 10000 },
            mockContext as never
        );

        expect(result.success).toBe(true);
    });

    it('handles Playwright error result', async () => {
        mockContext.sandbox.runPlaywright.mockResolvedValue({
            stdout: '',
            stderr: 'PLAYWRIGHT_ERROR:{"success":false,"error":"Navigation failed"}',
            exitCode: 1,
        });

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://bad.url' }], timeout: 10000 },
            mockContext as never
        );

        expect(result.success).toBe(false);
    });

    it('handles sandbox failure', async () => {
        mockContext.sandbox.runPlaywright.mockRejectedValue(new Error('Docker error'));

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://example.com' }], timeout: 10000 },
            mockContext as never
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Docker error');
    });

    it('accepts both type and action fields', () => {
        const withType = browserActionSkill.argsSchema.safeParse({
            actions: [{ type: 'navigate', url: 'https://example.com' }],
        });
        expect(withType.success).toBe(true);

        const withAction = browserActionSkill.argsSchema.safeParse({
            actions: [{ action: 'navigate', url: 'https://example.com' }],
        });
        expect(withAction.success).toBe(true);
    });
});
