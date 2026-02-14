import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingProvider } from './embeddings.js';

// Mock the logger
vi.mock('./logger.js', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

// Mock @huggingface/transformers
vi.mock('@huggingface/transformers', () => ({
    pipeline: vi.fn().mockResolvedValue(
        (_text: string) => Promise.resolve({ data: new Float32Array(384).fill(0.1) })
    ),
    env: {
        cacheDir: '',
        allowRemoteModels: true,
    },
}));

describe('EmbeddingProvider', () => {
    beforeEach(() => {
        // Clear the singleton instances between tests
        (EmbeddingProvider as unknown as { instances: Map<string, EmbeddingProvider> }).instances.clear();
    });

    describe('getInstance (singleton pattern)', () => {
        it('returns the same instance for the same model', () => {
            const a = EmbeddingProvider.getInstance('model-a');
            const b = EmbeddingProvider.getInstance('model-a');
            expect(a).toBe(b);
        });

        it('returns different instances for different models', () => {
            const a = EmbeddingProvider.getInstance('model-a');
            const b = EmbeddingProvider.getInstance('model-b');
            expect(a).not.toBe(b);
        });

        it('uses default model when none specified', () => {
            const a = EmbeddingProvider.getInstance();
            const b = EmbeddingProvider.getInstance();
            expect(a).toBe(b);
            expect(a.modelName).toBe('Xenova/all-MiniLM-L6-v2');
        });
    });

    describe('constructor', () => {
        it('stores the model name', () => {
            const provider = new EmbeddingProvider('custom-model');
            expect(provider.modelName).toBe('custom-model');
        });

        it('uses default model name when omitted', () => {
            const provider = new EmbeddingProvider();
            expect(provider.modelName).toBe('Xenova/all-MiniLM-L6-v2');
        });
    });

    describe('getEmbedding', () => {
        it('returns an array of numbers', async () => {
            const provider = new EmbeddingProvider('test-model');
            const embedding = await provider.getEmbedding('test text');
            expect(Array.isArray(embedding)).toBe(true);
            expect(embedding.length).toBe(384);
            expect(typeof embedding[0]).toBe('number');
        });

        it('initializes the pipeline on first call', async () => {
            const { pipeline } = await import('@huggingface/transformers');
            const provider = new EmbeddingProvider('test-model');

            await provider.getEmbedding('first call');
            expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'test-model', { dtype: 'fp32' });
        });

        it('reuses the pipeline on subsequent calls', async () => {
            const { pipeline } = await import('@huggingface/transformers');
            vi.mocked(pipeline).mockClear();

            const provider = new EmbeddingProvider('reuse-model');
            await provider.getEmbedding('first');
            await provider.getEmbedding('second');

            // Pipeline should only be called once (lazy init)
            expect(pipeline).toHaveBeenCalledTimes(1);
        });
    });
});
