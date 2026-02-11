/**
 * Tests for the browser automation skill (daemon-based approach).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { browserActionSkill } from './browser.js';

vi.mock('../../browser/manager.js', () => ({
    BrowserManager: { ensureRunning: vi.fn().mockResolvedValue(undefined) },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('browserActionSkill', () => {
    beforeEach(() => vi.clearAllMocks());

    /* ── Metadata ─────────────────────────────────────────── */

    it('has correct metadata', () => {
        expect(browserActionSkill.name).toBe('browser_action');
        expect(browserActionSkill.isVerified).toBe(true);
    });

    /* ── Actions array ────────────────────────────────────── */

    it('sends actions array to daemon and returns result', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true, url: 'https://example.com', snapshot: '' }),
        });

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://example.com' }], timeout: 5_000 },
            {} as never,
        );

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledOnce();
    });

    /* ── Top-level normalization ──────────────────────────── */

    it('normalizes top-level url into navigate action', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true, url: 'https://example.com' }),
        });

        await browserActionSkill.execute(
            { url: 'https://example.com', timeout: 5_000 },
            {} as never,
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.actions).toHaveLength(1);
        expect(body.actions[0]).toMatchObject({ type: 'navigate', url: 'https://example.com' });
    });

    it('normalizes top-level action + selector', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await browserActionSkill.execute(
            { action: 'click', selector: '#submit', timeout: 5_000 },
            {} as never,
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.actions[0]).toMatchObject({ type: 'click', selector: '#submit' });
    });

    it('normalizes top-level element-based click', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await browserActionSkill.execute(
            { action: 'click', element: 3, timeout: 5_000 },
            {} as never,
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.actions[0]).toMatchObject({ type: 'click', element: 3 });
    });

    it('normalizes element-based type action', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await browserActionSkill.execute(
            { action: 'type', element: 1, text: 'hello', timeout: 5_000 },
            {} as never,
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.actions[0]).toMatchObject({ type: 'type', element: 1, text: 'hello' });
    });

    it('appends top-level fields to existing actions array', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await browserActionSkill.execute({
            actions: [{ type: 'navigate', url: 'https://example.com' }],
            action: 'click',
            element: 5,
            timeout: 5_000,
        }, {} as never);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.actions).toHaveLength(2);
        expect(body.actions[0]).toMatchObject({ type: 'navigate', url: 'https://example.com' });
        expect(body.actions[1]).toMatchObject({ type: 'click', element: 5 });
    });

    /* ── _raw fallback ────────────────────────────────────── */

    it('handles _raw URL fallback from malformed JSON', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await browserActionSkill.execute(
            { _raw: 'https://example.com', timeout: 5_000 },
            {} as never,
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.actions[0]).toMatchObject({ type: 'navigate', url: 'https://example.com' });
    });

    /* ── Error handling ───────────────────────────────────── */

    it('returns error when no actions provided', async () => {
        const result = await browserActionSkill.execute(
            { timeout: 5_000 },
            {} as never,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('No valid actions');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns error on daemon HTTP failure', async () => {
        mockFetch.mockResolvedValue({ ok: false, statusText: 'Internal Server Error' });

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://example.com' }], timeout: 5_000 },
            {} as never,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Daemon error');
    });

    it('returns error on network failure', async () => {
        mockFetch.mockRejectedValue(new Error('Connection refused'));

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://example.com' }], timeout: 5_000 },
            {} as never,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Connection refused');
    });

    it('returns timeout error on AbortError', async () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        mockFetch.mockRejectedValue(err);

        const result = await browserActionSkill.execute(
            { actions: [{ type: 'navigate', url: 'https://example.com' }], timeout: 5_000 },
            {} as never,
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });

    /* ── Schema validation ────────────────────────────────── */

    it('accepts both type and action fields in schema', () => {
        const withType = browserActionSkill.argsSchema.safeParse({
            actions: [{ type: 'navigate', url: 'https://example.com' }],
        });
        expect(withType.success).toBe(true);

        const withAction = browserActionSkill.argsSchema.safeParse({
            actions: [{ action: 'navigate', url: 'https://example.com' }],
        });
        expect(withAction.success).toBe(true);
    });

    it('accepts top-level url-only schema (no actions array)', () => {
        const parsed = browserActionSkill.argsSchema.safeParse({
            url: 'https://example.com',
        });
        expect(parsed.success).toBe(true);
    });

    it('accepts element field in schema', () => {
        const parsed = browserActionSkill.argsSchema.safeParse({
            action: 'click',
            element: 0,
        });
        expect(parsed.success).toBe(true);
    });

    it('coerces string numbers from LLM (timeout, element, ms)', () => {
        const parsed = browserActionSkill.argsSchema.safeParse({
            url: 'https://example.com',
            timeout: '30000',
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.timeout).toBe(30000);
        }

        // LLMs sometimes send "30s" meaning 30 seconds
        const parsedSec = browserActionSkill.argsSchema.safeParse({
            url: 'https://example.com',
            timeout: '30s',
        });
        expect(parsedSec.success).toBe(true);
        if (parsedSec.success) {
            expect(parsedSec.data.timeout).toBe(30000);
        }

        const parsed2 = browserActionSkill.argsSchema.safeParse({
            action: 'click',
            element: '3',
        });
        expect(parsed2.success).toBe(true);
        if (parsed2.success) {
            expect(parsed2.data.element).toBe(3);
        }
    });
});
