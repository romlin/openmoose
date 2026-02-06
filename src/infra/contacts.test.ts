/**
 * Tests for ContactsManager -- contact lookup by name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
    readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
}));

vi.mock('./logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

import { ContactsManager } from './contacts.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const mockedReadFile = vi.mocked(readFile);
const mockedExists = vi.mocked(existsSync);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ContactsManager.lookup', () => {
    it('returns null when contacts file does not exist', async () => {
        mockedExists.mockReturnValue(false);
        const result = await ContactsManager.lookup('Alice');
        expect(result).toBeNull();
    });

    it('finds a contact by name (case-insensitive)', async () => {
        mockedExists.mockReturnValue(true);
        mockedReadFile.mockResolvedValue(JSON.stringify({ Alice: '123@s.whatsapp.net' }));

        const result = await ContactsManager.lookup('alice');
        expect(result).toEqual({ name: 'Alice', jid: '123@s.whatsapp.net' });
    });

    it('returns null for unknown contact', async () => {
        mockedExists.mockReturnValue(true);
        mockedReadFile.mockResolvedValue(JSON.stringify({ Alice: '123@s.whatsapp.net' }));

        const result = await ContactsManager.lookup('Bob');
        expect(result).toBeNull();
    });

    it('returns null on parse error', async () => {
        mockedExists.mockReturnValue(true);
        mockedReadFile.mockResolvedValue('not json');

        const result = await ContactsManager.lookup('Alice');
        expect(result).toBeNull();
    });
});

describe('ContactsManager.getAllNames', () => {
    it('returns empty array when file does not exist', async () => {
        mockedExists.mockReturnValue(false);
        const result = await ContactsManager.getAllNames();
        expect(result).toEqual([]);
    });

    it('returns all contact names', async () => {
        mockedExists.mockReturnValue(true);
        mockedReadFile.mockResolvedValue(JSON.stringify({ Alice: '1', Bob: '2' }));

        const result = await ContactsManager.getAllNames();
        expect(result).toEqual(['Alice', 'Bob']);
    });

    it('returns empty array on parse error', async () => {
        mockedExists.mockReturnValue(true);
        mockedReadFile.mockResolvedValue('broken');

        const result = await ContactsManager.getAllNames();
        expect(result).toEqual([]);
    });
});
