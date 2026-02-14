/**
 * Centralized embedding provider using Transformers.js.
 * Handles model loading and vector generation.
 */

import path from 'node:path';
import { logger } from './logger.js';
import { config } from '../config/index.js';

// Define a type for the pipeline to avoid 'any'
export type FeatureExtractionPipeline = (text: string, options?: { pooling?: string; normalize?: boolean }) => Promise<{ data: Float32Array }>;

export class EmbeddingProvider {
    private static instances: Map<string, EmbeddingProvider> = new Map();
    private static readonly DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
    private extractor: FeatureExtractionPipeline | null = null;
    readonly modelName: string;

    constructor(modelName: string = EmbeddingProvider.DEFAULT_MODEL) {
        this.modelName = modelName;
    }

    /**
     * Returns an EmbeddingProvider for the given model, creating one if it
     * doesn't exist yet. Keyed by model name so different models coexist.
     */
    static getInstance(modelName?: string): EmbeddingProvider {
        const key = modelName || EmbeddingProvider.DEFAULT_MODEL;
        let instance = EmbeddingProvider.instances.get(key);
        if (!instance) {
            instance = new EmbeddingProvider(key);
            EmbeddingProvider.instances.set(key, instance);
        }
        return instance;
    }

    private initPromise: Promise<void> | null = null;

    async getEmbedding(text: string): Promise<number[]> {
        await this.ensureInitialized();
        const output = await this.extractor!(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }

    private async ensureInitialized() {
        if (this.extractor) return;

        // If initialization is already in progress, wait for it
        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = (async () => {
            try {
                logger.info(`Loading embedding model ${this.modelName} (first load may download ~80 MB)...`, 'Embeddings');
                const { pipeline, env } = await import('@huggingface/transformers');

                // Set cache directory to a writable path in MOOSE_HOME
                env.cacheDir = path.join(config.mooseHome, 'cache', 'transformers');
                env.allowRemoteModels = true;

                this.extractor = (await pipeline('feature-extraction', this.modelName, { dtype: 'fp32' })) as unknown as FeatureExtractionPipeline;
                logger.success(`Embedding engine ready: ${this.modelName}`, 'Embeddings');
            } catch (err) {
                logger.error('Failed to initialize embedding engine', 'Embeddings', err);
                throw err;
            } finally {
                this.initPromise = null;
            }
        })();

        await this.initPromise;
    }
}
