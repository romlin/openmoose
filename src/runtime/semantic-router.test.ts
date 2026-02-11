import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SemanticRouter, SkillRoute } from './semantic-router.js';

// Mock the EmbeddingProvider to return controlled vectors
vi.mock('../infra/embeddings.js', () => ({
    EmbeddingProvider: {
        getInstance: () => ({
            getEmbedding: vi.fn(),
        }),
    },
}));

// Mock the logger to prevent config dependency issues
vi.mock('../infra/logger.js', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

// Mock the config module
vi.mock('../config/index.js', () => ({
    config: {
        router: {
            routeThreshold: 0.5,
            executeThreshold: 0.68,
        },
        logging: {
            silent: true,
            level: 'info',
        },
    },
}));

/**
 * Helper: create a unit vector in a given dimension of a high-dimensional space.
 * Two different basis vectors have cosine similarity = 0.
 * The same basis vector has cosine similarity = 1.
 * A mix allows controlling similarity precisely.
 */
function basisVector(dim: number, size: number = 384): number[] {
    const vec = new Array(size).fill(0);
    vec[dim] = 1;
    return vec;
}

/** Create a unit vector with exact cosine similarity `s` to basis(0).
 *  Uses trigonometric decomposition: [s, sqrt(1-s²), 0, ...] */
function vectorWithSimilarity(s: number, size: number = 384): number[] {
    const vec = new Array(size).fill(0);
    vec[0] = s;
    vec[1] = Math.sqrt(1 - s * s);
    return vec;
}

function createMockSkill(overrides: Partial<SkillRoute> = {}): SkillRoute {
    return {
        name: 'test-skill',
        description: 'A test skill',
        examples: ['example one', 'example two'],
        execute: vi.fn().mockResolvedValue({ success: true, result: 'done' }),
        ...overrides,
    };
}

/** Helper to access the private cosineSimilarity method for direct testing. */
function getCosineSimilarity(router: SemanticRouter) {
    return (a: number[], b: number[]) =>
        (router as unknown as { cosineSimilarity: (a: number[], b: number[]) => number })
            .cosineSimilarity(a, b);
}

describe('SemanticRouter', () => {
    let router: SemanticRouter;
    let mockGetEmbedding: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        router = new SemanticRouter();
        // Access the mocked embedder
        mockGetEmbedding = (router as unknown as { embedder: { getEmbedding: ReturnType<typeof vi.fn> } }).embedder.getEmbedding;
    });

    describe('register and initialize', () => {
        it('registers skills and initializes embeddings', async () => {
            const skill = createMockSkill();
            mockGetEmbedding.mockResolvedValue(basisVector(0));

            router.register(skill);
            await router.initialize();

            // getEmbedding called once per example
            expect(mockGetEmbedding).toHaveBeenCalledTimes(2);
        });

        it('skips re-initialization when already initialized', async () => {
            const skill = createMockSkill();
            mockGetEmbedding.mockResolvedValue(basisVector(0));

            router.register(skill);
            await router.initialize();
            await router.initialize(); // second call

            // Still only 2 calls (one per example, not doubled)
            expect(mockGetEmbedding).toHaveBeenCalledTimes(2);
        });
    });

    describe('route — pure embedding matching', () => {
        it('returns the best matching skill above threshold', async () => {
            const exampleEmbedding = basisVector(0);
            const skill = createMockSkill({ name: 'weather' });

            // Example embeddings are basis(0), user message is also basis(0) → similarity = 1.0
            mockGetEmbedding.mockResolvedValue(exampleEmbedding);
            router.register(skill);

            const match = await router.route('whats the weather', 0.5);
            expect(match).not.toBeNull();
            expect(match!.skill.name).toBe('weather');
            expect(match!.confidence).toBeCloseTo(1.0, 2);
        });

        it('returns null when no skill exceeds threshold', async () => {
            const skill = createMockSkill({ name: 'weather' });

            // Examples get basis(0), but user message gets basis(1) → similarity = 0
            mockGetEmbedding
                .mockResolvedValueOnce(basisVector(0)) // example 1
                .mockResolvedValueOnce(basisVector(0)) // example 2
                .mockResolvedValueOnce(basisVector(1)); // user message

            router.register(skill);

            const match = await router.route('something unrelated', 0.5);
            expect(match).toBeNull();
        });

        it('selects the skill with highest similarity when multiple are registered', async () => {
            const skillA = createMockSkill({ name: 'youtube', examples: ['play video'] });
            const skillB = createMockSkill({ name: 'weather', examples: ['get weather'] });

            // skillA example → basis(0), skillB example → basis(1)
            // user message → basis(0) (identical to skillA)
            mockGetEmbedding
                .mockResolvedValueOnce(basisVector(0)) // youtube example
                .mockResolvedValueOnce(basisVector(1)) // weather example
                .mockResolvedValueOnce(basisVector(0)); // user message

            router.register(skillA);
            router.register(skillB);

            const match = await router.route('play a video', 0.5);
            expect(match).not.toBeNull();
            expect(match!.skill.name).toBe('youtube');
        });
    });

    describe('route — regex boost (hybrid matching)', () => {
        it('boosts confidence when extractArgs returns non-empty args', async () => {
            const skill = createMockSkill({
                name: 'youtube',
                examples: ['play latest video'],
                extractArgs: (msg: string): Record<string, string> => {
                    const m = msg.match(/play (?:the )?latest video by (.+)/i);
                    return m ? { query: m[1] } : {};
                },
            });

            // Embedding similarity = 0.60 (below 0.68 threshold without boost)
            const exampleVec = basisVector(0);
            const userVec = vectorWithSimilarity(0.60);
            mockGetEmbedding
                .mockResolvedValueOnce(exampleVec)  // example embedding
                .mockResolvedValueOnce(userVec);     // user message embedding

            router.register(skill);

            const match = await router.route('play the latest video by mark rober', 0.5);
            expect(match).not.toBeNull();
            // The cosine similarity before boost is ~0.60
            // After regex boost (+0.15), it should be ~0.75
            expect(match!.confidence).toBeGreaterThan(0.68);
            expect(match!.args.query).toBe('mark rober');
        });

        it('does NOT boost when extractArgs returns empty args', async () => {
            const skill = createMockSkill({
                name: 'youtube',
                examples: ['play latest video'],
                extractArgs: () => ({}), // no match
            });

            // Embedding similarity = 0.55 (below threshold)
            const exampleVec = basisVector(0);
            const userVec = vectorWithSimilarity(0.55);
            mockGetEmbedding
                .mockResolvedValueOnce(exampleVec)
                .mockResolvedValueOnce(userVec);

            router.register(skill);

            const match = await router.route('tell me a joke', 0.5);
            // 0.55 is above routeThreshold (0.5) but should NOT be boosted
            expect(match).not.toBeNull();
            expect(match!.confidence).toBeLessThan(0.68);
        });

        it('caps boosted confidence at 1.0', async () => {
            const skill = createMockSkill({
                name: 'youtube',
                examples: ['play latest video'],
                extractArgs: () => ({ query: 'someone' }),
            });

            // Embedding similarity = 1.0 (perfect match)
            mockGetEmbedding.mockResolvedValue(basisVector(0));
            router.register(skill);

            const match = await router.route('play latest video', 0.5);
            expect(match).not.toBeNull();
            // 1.0 + 0.15 should cap at 1.0
            expect(match!.confidence).toBe(1.0);
        });

        it('regex boost can change which skill wins', async () => {
            // Skill A: slightly better embedding, but no regex match
            const skillA = createMockSkill({
                name: 'weather',
                examples: ['get weather'],
                extractArgs: () => ({}),
            });

            // Skill B: slightly worse embedding, but regex matches
            const skillB = createMockSkill({
                name: 'youtube',
                examples: ['play video'],
                extractArgs: (msg: string): Record<string, string> => {
                    const m = msg.match(/play .+ by (.+)/i);
                    return m ? { query: m[1] } : {};
                },
            });

            // Weather → basis(0), YouTube → basis(1)
            // Raw user vec: [0.60, 0.55, ...] → after cosine normalization:
            //   weather ≈ 0.737, youtube ≈ 0.675
            // With +0.15 regex boost: youtube ≈ 0.825 > weather 0.737 → youtube wins
            const userVec = new Array(384).fill(0);
            userVec[0] = 0.60;
            userVec[1] = 0.55;

            mockGetEmbedding
                .mockResolvedValueOnce(basisVector(0)) // weather example
                .mockResolvedValueOnce(basisVector(1)) // youtube example
                .mockResolvedValueOnce(userVec);        // user message

            router.register(skillA);
            router.register(skillB);

            const match = await router.route('play video by mark rober', 0.5);
            expect(match).not.toBeNull();
            expect(match!.skill.name).toBe('youtube');
            expect(match!.args.query).toBe('mark rober');
        });
    });

    describe('tryExecute', () => {
        it('executes a matched skill above executeThreshold', async () => {
            const skill = createMockSkill({
                name: 'weather',
                examples: ['get weather'],
                execute: vi.fn().mockResolvedValue({ success: true, result: 'Sunny 22°C' }),
            });

            // Perfect embedding match → confidence = 1.0
            mockGetEmbedding.mockResolvedValue(basisVector(0));
            router.register(skill);

            const result = await router.tryExecute('get weather');
            expect(result.handled).toBe(true);
            expect(result.success).toBe(true);
            expect(result.result).toBe('Sunny 22°C');
        });

        it('returns not handled when below executeThreshold', async () => {
            const skill = createMockSkill({
                name: 'weather',
                examples: ['get weather'],
            });

            // Similarity = 0 → below all thresholds
            mockGetEmbedding
                .mockResolvedValueOnce(basisVector(0))  // example
                .mockResolvedValueOnce(basisVector(1)); // user message

            router.register(skill);

            const result = await router.tryExecute('random gibberish');
            expect(result.handled).toBe(false);
        });

        it('re-extracts args from originalMessage when provided', async () => {
            const extractArgs = vi.fn()
                .mockReturnValueOnce({ city: '' })   // called during route() on the routed message
                .mockReturnValueOnce({ city: 'Paris' }); // called again with originalMessage

            const skill = createMockSkill({
                name: 'weather',
                examples: ['get weather'],
                extractArgs,
                execute: vi.fn().mockResolvedValue({ success: true, result: 'Rainy' }),
            });

            mockGetEmbedding.mockResolvedValue(basisVector(0));
            router.register(skill);

            const result = await router.tryExecute('weather please', 'weather in Paris');
            expect(result.handled).toBe(true);
            expect(extractArgs).toHaveBeenCalledWith('weather in Paris');
        });

        it('handles execution errors gracefully', async () => {
            const skill = createMockSkill({
                name: 'weather',
                examples: ['get weather'],
                execute: vi.fn().mockRejectedValue(new Error('Network down')),
            });

            mockGetEmbedding.mockResolvedValue(basisVector(0));
            router.register(skill);

            const result = await router.tryExecute('get weather');
            expect(result.handled).toBe(true);
            expect(result.success).toBe(false);
            expect(result.result).toContain('Network down');
        });
    });

    describe('cosineSimilarity', () => {
        it('returns 1.0 for identical vectors', () => {
            const cosine = getCosineSimilarity(router);
            expect(cosine(basisVector(0), basisVector(0))).toBeCloseTo(1.0, 5);
        });

        it('returns 0.0 for orthogonal vectors', () => {
            const cosine = getCosineSimilarity(router);
            expect(cosine(basisVector(0), basisVector(1))).toBeCloseTo(0.0, 5);
        });
    });
});
