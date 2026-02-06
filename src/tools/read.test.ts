/**
 * Tests for the file read tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infra/safe-path.js', () => ({
    assertSafePath: vi.fn((p: string) => `/project/${p}`),
}));

vi.mock('node:fs/promises', () => ({
    readFile: vi.fn(),
}));

import { readSkill } from './read.js';
import { readFile } from 'node:fs/promises';
import { assertSafePath } from '../infra/safe-path.js';

const mockedReadFile = vi.mocked(readFile);
const mockedAssertSafe = vi.mocked(assertSafePath);

beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertSafe.mockImplementation((p: string) => `/project/${p}`);
});

describe('readSkill', () => {
    it('has correct metadata', () => {
        expect(readSkill.name).toBe('read');
        expect(readSkill.isVerified).toBe(false);
    });

    it('reads a file successfully', async () => {
        mockedReadFile.mockResolvedValue('file contents here');
        const result = await readSkill.execute({ path: 'src/index.ts' }, {} as never);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ content: 'file contents here' });
        expect(mockedAssertSafe).toHaveBeenCalledWith('src/index.ts');
    });

    it('returns error for blocked path', async () => {
        mockedAssertSafe.mockImplementation(() => { throw new Error('Path traversal blocked'); });
        const result = await readSkill.execute({ path: '../etc/passwd' }, {} as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Path traversal blocked');
    });

    it('returns error when file not found', async () => {
        mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file'));
        const result = await readSkill.execute({ path: 'missing.txt' }, {} as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('ENOENT');
    });
});
