/**
 * Tests for memory store and recall tools.
 */

import { describe, it, expect, vi } from 'vitest';
import { memoryStoreSkill, memoryRecallSkill } from './memory.js';

const mockContext = {
    memory: {
        store: vi.fn(),
        recall: vi.fn(),
    },
    sandbox: {} as never,
    brain: {} as never,
    scheduler: {} as never,
};

describe('memoryStoreSkill', () => {
    it('has correct metadata', () => {
        expect(memoryStoreSkill.name).toBe('memory_store');
        expect(memoryStoreSkill.isVerified).toBe(true);
    });

    it('stores a fact via memory.store', async () => {
        mockContext.memory.store.mockResolvedValue(undefined);
        const result = await memoryStoreSkill.execute({ fact: 'User likes cats' }, mockContext as never);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ stored: true });
        expect(mockContext.memory.store).toHaveBeenCalledWith('User likes cats');
    });

    it('returns error on store failure', async () => {
        mockContext.memory.store.mockRejectedValue(new Error('DB offline'));
        const result = await memoryStoreSkill.execute({ fact: 'test' }, mockContext as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('DB offline');
    });
});

describe('memoryRecallSkill', () => {
    it('has correct metadata', () => {
        expect(memoryRecallSkill.name).toBe('memory_recall');
        expect(memoryRecallSkill.isVerified).toBe(true);
    });

    it('recalls memories via memory.recall', async () => {
        mockContext.memory.recall.mockResolvedValue(['fact1', 'fact2']);
        const result = await memoryRecallSkill.execute({ query: 'cats' }, mockContext as never);

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ memories: ['fact1', 'fact2'] });
        expect(mockContext.memory.recall).toHaveBeenCalledWith('cats');
    });

    it('returns error on recall failure', async () => {
        mockContext.memory.recall.mockRejectedValue(new Error('Embedding failed'));
        const result = await memoryRecallSkill.execute({ query: 'test' }, mockContext as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Embedding failed');
    });
});
