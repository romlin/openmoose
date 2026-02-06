/**
 * Tests for the directory listing tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infra/safe-path.js', () => ({
    assertSafePath: vi.fn((p: string) => `/project/${p}`),
}));

vi.mock('../infra/logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
    readdir: vi.fn(),
    stat: vi.fn(),
}));

import { listSkill } from './ls.js';
import { readdir, stat } from 'node:fs/promises';
import { assertSafePath } from '../infra/safe-path.js';

const mockedReaddir = vi.mocked(readdir);
const mockedStat = vi.mocked(stat);
const mockedAssertSafe = vi.mocked(assertSafePath);

beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertSafe.mockImplementation((p: string) => `/project/${p}`);
});

describe('listSkill', () => {
    it('has correct metadata', () => {
        expect(listSkill.name).toBe('ls');
        expect(listSkill.isVerified).toBe(false);
    });

    it('lists files and directories', async () => {
        mockedReaddir.mockResolvedValue(['file.ts', 'dir'] as unknown as never);
        mockedStat.mockImplementation(async (p) => {
            const name = String(p);
            return {
                isDirectory: () => name.endsWith('dir'),
                size: name.endsWith('dir') ? 4096 : 100,
            } as never;
        });

        const result = await listSkill.execute({ path: 'src' }, {} as never);

        expect(result.success).toBe(true);
        expect(result.data?.files).toHaveLength(2);
        expect(result.data?.files[0]).toEqual({ name: 'file.ts', type: 'file', size: 100 });
        expect(result.data?.files[1]).toEqual({ name: 'dir', type: 'directory', size: 4096 });
    });

    it('returns error for blocked path', async () => {
        mockedAssertSafe.mockImplementation(() => { throw new Error('Path traversal blocked'); });
        const result = await listSkill.execute({ path: '../..' }, {} as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Path traversal blocked');
    });

    it('handles stat errors gracefully', async () => {
        mockedReaddir.mockResolvedValue(['broken'] as unknown as never);
        mockedStat.mockRejectedValue(new Error('EACCES'));

        const result = await listSkill.execute({ path: 'src' }, {} as never);

        expect(result.success).toBe(true);
        expect(result.data?.files[0]).toEqual({ name: 'broken', type: 'unknown' });
    });
});
