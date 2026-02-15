/**
 * HistoryManager -- Handles persistent storage of chat history using JSONL format.
 * Messages are appended to a log file in the .moose directory.
 */

import { appendFile, readFile, mkdir, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from './logger.js';

export interface HistoryMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    /** Source attribution for assistant messages (e.g. "skill:weather", "browser", "brain"). */
    source?: string;
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
    async append(role: 'user' | 'assistant', content: string, source?: string) {
        try {
            await this.ensureDir();
            const record: HistoryMessage = {
                role,
                content,
                timestamp: Date.now(),
                ...(source ? { source } : {}),
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
        if (n <= 0 || !existsSync(this.historyPath)) return [];

        let fd: Awaited<ReturnType<typeof open>> | null = null;
        try {
            fd = await open(this.historyPath, 'r');
            const stats = await fd.stat();
            if (stats.size === 0) return [];

            const chunkSize = 64 * 1024;
            let position = stats.size;
            let content = '';
            let lines: string[] = [];

            while (position > 0 && lines.filter(line => line.trim()).length <= n) {
                const readSize = Math.min(chunkSize, position);
                position -= readSize;

                const buffer = Buffer.alloc(readSize);
                await fd.read(buffer, 0, readSize, position);
                content = buffer.toString('utf-8') + content;
                lines = content.split('\n');
            }

            const parsed: HistoryMessage[] = [];
            // The first line may be partial when reading backwards in chunks, so skip it.
            for (const line of lines.slice(1)) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    parsed.push(JSON.parse(trimmed) as HistoryMessage);
                } catch {
                    // Ignore malformed lines instead of failing the entire request.
                }
            }

            return parsed.slice(-n);
        } catch (err) {
            logger.error('Failed to load last history messages', 'History', err);
            return [];
        } finally {
            await fd?.close().catch(() => { });
        }
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
