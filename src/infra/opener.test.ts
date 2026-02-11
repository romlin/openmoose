import { describe, it, expect, vi } from 'vitest';
import { getOpenCommand } from './opener.js';

vi.mock('node:os', () => ({
    platform: vi.fn(),
}));

describe('getOpenCommand', () => {
    it('returns "open" on macOS', async () => {
        const os = await import('node:os');
        vi.mocked(os.platform).mockReturnValue('darwin');
        expect(getOpenCommand()).toBe('open');
    });

    it('returns "start" on Windows', async () => {
        const os = await import('node:os');
        vi.mocked(os.platform).mockReturnValue('win32');
        expect(getOpenCommand()).toBe('start');
    });

    it('returns "xdg-open" on Linux', async () => {
        const os = await import('node:os');
        vi.mocked(os.platform).mockReturnValue('linux');
        expect(getOpenCommand()).toBe('xdg-open');
    });

    it('returns "xdg-open" for unknown platforms', async () => {
        const os = await import('node:os');
        vi.mocked(os.platform).mockReturnValue('freebsd' as NodeJS.Platform);
        expect(getOpenCommand()).toBe('xdg-open');
    });
});
