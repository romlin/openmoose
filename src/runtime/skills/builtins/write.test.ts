/**
 * Tests for the file write tool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../infra/safe-path.js', () => ({
    assertSafePath: vi.fn((p: string) => `/project/${p}`),
}));

vi.mock('node:fs/promises', () => ({
    writeFile: vi.fn(),
    mkdir: vi.fn(),
}));

import { writeSkill } from './write.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { assertSafePath } from '../../../infra/safe-path.js';

const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedAssertSafe = vi.mocked(assertSafePath);

beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertSafe.mockImplementation((p: string) => `/project/${p}`);
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
});

describe('writeSkill', () => {
    it('has correct metadata', () => {
        expect(writeSkill.name).toBe('file_write');
        expect(writeSkill.isVerified).toBe(true);
    });

    it('writes a file successfully', async () => {
        const result = await writeSkill.execute(
            { path: 'output.txt', content: 'hello world' },
            {} as never
        );

        expect(result.success).toBe(true);
        expect(mockedAssertSafe).toHaveBeenCalledWith('output.txt');
        expect(mockedMkdir).toHaveBeenCalled();
        expect(mockedWriteFile).toHaveBeenCalledWith('/project/output.txt', 'hello world', 'utf-8');
    });

    it('creates parent directories', async () => {
        await writeSkill.execute(
            { path: 'deep/nested/file.txt', content: 'data' },
            {} as never
        );

        expect(mockedMkdir).toHaveBeenCalledWith(
            expect.stringContaining('deep'),
            { recursive: true }
        );
    });

    it('returns error for blocked path', async () => {
        mockedAssertSafe.mockImplementation(() => { throw new Error('Access denied'); });
        const result = await writeSkill.execute(
            { path: '.env', content: 'secret' },
            {} as never
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Access denied');
    });

    it('returns error on write failure', async () => {
        mockedWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));
        const result = await writeSkill.execute(
            { path: 'readonly.txt', content: 'data' },
            {} as never
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('EACCES');
    });
});
