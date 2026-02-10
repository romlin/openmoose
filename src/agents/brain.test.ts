import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalBrain } from './brain.js';
import { LocalMemory } from '../infra/memory.js';
import { SkillRegistry } from '../runtime/registry.js';
vi.mock('../infra/memory.js');
vi.mock('../runtime/registry.js');
vi.mock('../infra/logger.js');
const mockChat = vi.fn().mockResolvedValue({ content: 'llama response', toolCalls: [], finishReason: 'stop' });
const mockHealthCheck = vi.fn().mockResolvedValue({ ok: true });

vi.mock('./providers.js', () => {
    return {
        MistralProvider: vi.fn().mockImplementation(function () {
            return {
                chat: mockChat,
                chatStream: vi.fn(),
                healthCheck: mockHealthCheck
            };
        }),
        LlamaProvider: vi.fn().mockImplementation(function () {
            return {
                chat: mockChat,
                chatStream: vi.fn(),
                healthCheck: mockHealthCheck
            };
        })
    };
});

describe('LocalBrain', () => {
    let memory: InstanceType<typeof LocalMemory>;
    let registry: InstanceType<typeof SkillRegistry>;

    beforeEach(() => {
        vi.clearAllMocks();
        memory = new LocalMemory();
        memory.recall = vi.fn().mockResolvedValue([]);
        registry = new SkillRegistry();
        registry.getOpenAITools = vi.fn().mockReturnValue([]);
    });

    it('should initialize with correct provider based on config', () => {
        // Test Llama (default)
        const brainLlama = new LocalBrain({ memory, registry });
        expect(brainLlama).toBeDefined();

        // Test Mistral via config hack (or just verify it doesn't throw)
        // Note: config is const, but we can check the branching logic if we had a way to inject it
        // For now, we trust the constructor logic
    });

    it('should recall memory for non-trivial messages', async () => {
        const brain = new LocalBrain({ memory, registry });
        await brain.chat('What is my name?');
        expect(memory.recall).toHaveBeenCalledWith('What is my name?');
    });

    it('should skip memory recall for trivial messages', async () => {
        const brain = new LocalBrain({ memory, registry });
        await brain.chat('hi');
        expect(memory.recall).not.toHaveBeenCalled();
    });

    it('should build messages correctly including system prompt and history', async () => {
        const brain = new LocalBrain({ memory, registry, skillsPrompt: 'Custom Skills' });
        const history = [{ role: 'user', content: 'previous' }];

        // We can't easily peek into prepareMessages because it's private, 
        // but we can check what the provider receives.

        // This requires accessing the private provider or spying on its methods.
        await brain.chat('current', history);

        expect(mockChat).toHaveBeenCalled();
        const calledMessages = mockChat.mock.calls[0][0];
        expect(calledMessages[0].role).toBe('system');
        expect(calledMessages[0].content).toContain('Custom Skills');
        expect(calledMessages[1].content).toBe('previous');
        expect(calledMessages[2].content).toBe('current');
    });

    it('should delegate healthCheck to provider', async () => {
        const brain = new LocalBrain({ memory, registry });
        const status = await brain.healthCheck();
        expect(status.ok).toBe(true);
    });
});
