import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalMemory } from './memory.js';

// Mock all external dependencies
vi.mock('@lancedb/lancedb', () => ({
    connect: vi.fn(),
}));

vi.mock('./embeddings.js', () => ({
    EmbeddingProvider: {
        getInstance: () => ({
            getEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0)),
        }),
    },
}));

vi.mock('./logger.js', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

vi.mock('../config/index.js', () => ({
    config: {
        memory: { dbPath: '.test-memory' },
    },
}));

vi.mock('node:fs/promises', () => ({
    default: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn(),
        readdir: vi.fn(),
        stat: vi.fn(),
    },
}));

describe('LocalMemory', () => {
    let memory: LocalMemory;

    beforeEach(() => {
        vi.clearAllMocks();
        memory = new LocalMemory({ dbPath: '/tmp/test-memory' });
    });

    describe('chunkMarkdown', () => {
        // Access private method for testing
        function chunk(content: string): string[] {
            return (memory as unknown as { chunkMarkdown: (c: string) => string[] }).chunkMarkdown(content);
        }

        it('splits on heading boundaries', () => {
            const md = '# Title\nSome text\n## Subtitle\nMore text';
            const chunks = chunk(md);
            expect(chunks).toHaveLength(2);
            expect(chunks[0]).toContain('Title');
            expect(chunks[1]).toContain('Subtitle');
        });

        it('splits on double newlines within sections', () => {
            const md = 'Paragraph one\n\nParagraph two\n\nParagraph three';
            const chunks = chunk(md);
            expect(chunks).toHaveLength(3);
        });

        it('filters empty chunks', () => {
            const md = '\n\n\n\n\n';
            const chunks = chunk(md);
            expect(chunks).toHaveLength(0);
        });

        it('trims whitespace from chunks', () => {
            const md = '  hello world  \n\n  trimmed  ';
            const chunks = chunk(md);
            for (const c of chunks) {
                expect(c).toBe(c.trim());
            }
        });

        it('handles a single paragraph with no splits', () => {
            const md = 'Just a single paragraph with no headers or double newlines.';
            const chunks = chunk(md);
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toBe(md);
        });

        it('handles multiple heading levels', () => {
            const md = '# H1\nText\n## H2\nText\n### H3\nText\n#### H4\nText';
            const chunks = chunk(md);
            expect(chunks.length).toBeGreaterThanOrEqual(4);
        });
    });

});
