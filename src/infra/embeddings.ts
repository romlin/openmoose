/**
 * Centralized embedding provider using Transformers.js.
 * Handles model loading and vector generation.
 */

import { logger } from './logger.js';

// Define a type for the pipeline to avoid 'any'
export type FeatureExtractionPipeline = (text: string, options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array }>;

export class EmbeddingProvider {
    private static instance: EmbeddingProvider;
    private extractor: FeatureExtractionPipeline | null = null;
    private modelName: string;

    constructor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
        this.modelName = modelName;
    }

    /**
     * Singleton-ish accessor to avoid reloading models unnecessarily 
     * if multiple services use the same model.
     */
    static getInstance(modelName?: string): EmbeddingProvider {
        if (!EmbeddingProvider.instance) {
            EmbeddingProvider.instance = new EmbeddingProvider(modelName);
        }
        return EmbeddingProvider.instance;
    }

    async getEmbedding(text: string): Promise<number[]> {
        await this.ensureInitialized();
        const output = await this.extractor!(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }

    private async ensureInitialized() {
        if (this.extractor) return;

        try {
            const { pipeline } = await import('@huggingface/transformers');
            // We cast to any first because the @huggingface/transformers types can be tricky 
            // with dynamic imports, but we use our internal type for the member.
            this.extractor = (await pipeline('feature-extraction', this.modelName)) as any;
            logger.info(`Embedding engine initialized: ${this.modelName}`, 'Embeddings');
        } catch (err) {
            logger.error('Failed to initialize embedding engine', 'Embeddings', err);
            throw err;
        }
    }
}
