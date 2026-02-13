import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryManager } from './history';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config';

describe('HistoryManager', () => {
    const history = new HistoryManager();
    const testFile = path.join(config.mooseHome, 'data/history.jsonl');

    beforeEach(async () => {
        if (existsSync(testFile)) {
            await rm(testFile);
        }
    });

    it('should append and load messages', async () => {
        await history.append('user', 'Hello');
        await history.append('assistant', 'Hi there');

        const loaded = await history.load();
        expect(loaded).toHaveLength(2);
        expect(loaded[0].role).toBe('user');
        expect(loaded[0].content).toBe('Hello');
        expect(loaded[1].role).toBe('assistant');
        expect(loaded[1].content).toBe('Hi there');
    });

    it('should load last N messages', async () => {
        await history.append('user', '1');
        await history.append('assistant', '2');
        await history.append('user', '3');

        const last2 = await history.loadLast(2);
        expect(last2).toHaveLength(2);
        expect(last2[0].content).toBe('2');
        expect(last2[1].content).toBe('3');
    });

    it('should handle non-existent file gracefully', async () => {
        const loaded = await history.load();
        expect(loaded).toEqual([]);
    });

    it('should clear history', async () => {
        await history.append('user', 'Bye');
        await history.clear();
        const loaded = await history.load();
        expect(loaded).toEqual([]);
    });
});
