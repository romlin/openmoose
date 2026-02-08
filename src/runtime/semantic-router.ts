/**
 * Embedding-based semantic router for fast, deterministic intent matching.
 * Uses local embeddings to compare user messages against skill examples
 * and routes to the best-matching skill when confidence exceeds thresholds.
 */

import { SkillContext } from './skill.js';
import { logger } from '../infra/logger.js';
import { EmbeddingProvider } from '../infra/embeddings.js';

/** Minimum confidence for routing a message to a skill. */
const ROUTE_THRESHOLD = 0.5;

/** Minimum confidence for actually executing the skill. */
const EXECUTE_THRESHOLD = 0.68;

/**
 * Skill definition with example phrases for semantic matching
 */
export interface SkillRoute {
    name: string;
    description: string;
    examples: string[];
    execute: (args: Record<string, string>, context?: string, skillContext?: SkillContext) => Promise<{ success: boolean; result?: string; error?: string }>;
    extractArgs?: (message: string) => Record<string, string>;
    host?: boolean;
}

interface RouteMatch {
    skill: SkillRoute;
    confidence: number;
    args: Record<string, string>;
}

/**
 * SemanticRouter - Uses embeddings to match user messages to skills
 * Bypasses LLM for intent detection, giving deterministic and fast routing
 */
export class SemanticRouter {
    private embedder: EmbeddingProvider;
    private routes: SkillRoute[] = [];
    private routeEmbeddings: Map<string, number[][]> = new Map();
    private initialized = false;

    constructor(options: { embeddingModel?: string } = {}) {
        this.embedder = EmbeddingProvider.getInstance(options.embeddingModel);
    }

    register(route: SkillRoute): void {
        this.routes.push(route);
        this.initialized = false;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        logger.info('Initializing Semantic Router...', 'Router');

        await Promise.all(this.routes.map(async (route) => {
            const embeddings = await Promise.all(route.examples.map(example => this.getEmbedding(example)));
            this.routeEmbeddings.set(route.name, embeddings);
            logger.debug(`${route.name}: ${route.examples.length} examples indexed`, 'Router');
        }));

        this.initialized = true;
        logger.success(`Router ready with ${this.routes.length} skills`, 'Router');
    }

    private async getEmbedding(text: string): Promise<number[]> {
        return this.embedder.getEmbedding(text);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async route(message: string, threshold: number = 0.75): Promise<RouteMatch | null> {
        await this.initialize();

        const messageEmbedding = await this.getEmbedding(message);

        let bestMatch: RouteMatch | null = null;
        let bestScore = 0;

        for (const route of this.routes) {
            const embeddings = this.routeEmbeddings.get(route.name) || [];

            let maxSimilarity = 0;
            for (const embedding of embeddings) {
                const similarity = this.cosineSimilarity(messageEmbedding, embedding);
                if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                }
            }

            if (maxSimilarity > bestScore) {
                bestScore = maxSimilarity;
                bestMatch = {
                    skill: route,
                    confidence: maxSimilarity,
                    args: route.extractArgs ? route.extractArgs(message) : {},
                };
            }
        }

        if (bestMatch && bestMatch.confidence >= threshold) {
            return bestMatch;
        }

        return null;
    }

    async tryExecute(message: string, originalMessage?: string, context?: string, skillContext?: SkillContext): Promise<{ handled: boolean; success?: boolean; result?: string; confidence?: number; bestSkill?: string }> {
        const match = await this.route(message, ROUTE_THRESHOLD);

        if (!match || match.confidence < EXECUTE_THRESHOLD) {
            if (match) {
                logger.debug(`Match found for "${match.skill.name}" but confidence (${(match.confidence * 100).toFixed(1)}%) is below threshold (${(EXECUTE_THRESHOLD * 100).toFixed(1)}%)`, 'Router');
            } else {
                logger.debug(`No skill match found for "${message}"`, 'Router');
            }
            return {
                handled: false,
                confidence: match?.confidence,
                bestSkill: match?.skill.name
            };
        }

        if (originalMessage && match.skill.extractArgs) {
            match.args = match.skill.extractArgs(originalMessage);
        }

        if (match.skill.host) {
            logger.warn(`Skill "${match.skill.name}" is executing on the HOST machine.`, 'Security');
        }

        logger.info(`Routed to "${match.skill.name}" (${(match.confidence * 100).toFixed(1)}% confidence)`, 'Router');

        try {
            const result = await match.skill.execute(match.args, context, skillContext);
            if (result.success) {
                return { handled: true, success: true, result: result.result, confidence: match.confidence };
            } else {
                return { handled: true, success: false, result: result.error, confidence: match.confidence };
            }
        } catch (error) {
            return { handled: true, success: false, result: String(error), confidence: match.confidence };
        }
    }
}
