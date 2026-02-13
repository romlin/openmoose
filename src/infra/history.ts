/**
 * HistoryManager -- Handles persistent storage of chat history using JSONL format.
 * Messages are appended to a log file in the .moose directory.
 */

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from './logger.js';

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class HistoryManager {
    private historyPath: string;

    constructor(customPath?: string) {
        this.historyPath = customPath || path.join(config.mooseHome, 'data/history.jsonl');
    }

    private async ensureDir() {
        const dir = path.dirname(this.historyPath);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    /** Append a single message to the history log. */
    async append(role: 'user' | 'assistant', content: string) {
        try {
            await this.ensureDir();
            const record: HistoryMessage = {
                role,
                content,
                timestamp: Date.now()
            };
            await appendFile(this.historyPath, JSON.stringify(record) + '\n', 'utf-8');
        } catch (err) {
            logger.error('Failed to append history', 'History', err);
        }
    }

    /** Load the entire history from disk. */
    async load(): Promise<HistoryMessage[]> {
        if (!existsSync(this.historyPath)) return [];
        try {
            const content = await readFile(this.historyPath, 'utf-8');
            return content
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line) as HistoryMessage);
        } catch (err) {
            logger.error('Failed to load history', 'History', err);
            return [];
        }
    }

    /** Load only the last N messages for context. */
    async loadLast(n: number): Promise<HistoryMessage[]> {
        const full = await this.load();
        return full.slice(-n);
    }

    /** Clear all history. */
    async clear() {
        try {
            if (existsSync(this.historyPath)) {
                await appendFile(this.historyPath, '', { flag: 'w' });
            }
        } catch (err) {
            logger.error('Failed to clear history', 'History', err);
        }
    }
}
