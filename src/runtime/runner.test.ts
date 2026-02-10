import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunner } from './runner.js';
import { LocalBrain } from '../agents/brain.js';
import { LocalMemory } from '../infra/memory.js';
import { LocalSandbox } from '../infra/sandbox.js';
import { SkillRegistry } from './registry.js';
import { TaskScheduler } from './scheduler.js';
import { WhatsAppManager } from '../infra/whatsapp.js';
import { SemanticRouter } from './semantic-router.js';

// Mock dependencies
vi.mock('../agents/brain.js');
vi.mock('../infra/memory.js');
vi.mock('../infra/sandbox.js');
vi.mock('./registry.js');
vi.mock('./scheduler.js');
vi.mock('../infra/whatsapp.js');
vi.mock('./semantic-router.js');
vi.mock('../infra/logger.js');

describe('AgentRunner', () => {
    let brain: any;
    let memory: any;
    let sandbox: any;
    let registry: any;
    let scheduler: any;
    let whatsapp: any;
    let runner: AgentRunner;

    beforeEach(() => {
        vi.clearAllMocks();
        brain = new LocalBrain({} as any);
        memory = new LocalMemory();
        sandbox = new LocalSandbox();
        registry = new SkillRegistry();
        scheduler = new TaskScheduler('', {} as any);
        whatsapp = new WhatsAppManager();

        registry.getOpenAITools = vi.fn().mockReturnValue([]);
        brain.chat = vi.fn();
        brain.chatStream = vi.fn();

        runner = new AgentRunner(brain, memory, sandbox, registry, scheduler, whatsapp);
    });

    it('should try semantic router first', async () => {
        const mockTryExecute = vi.spyOn(SemanticRouter.prototype, 'tryExecute').mockResolvedValue({
            handled: true,
            success: true,
            result: 'Router Handled'
        });

        // Mock summarizeResults (private, so we mock chatStream which it calls)
        brain.chatStream.mockImplementation(async function* () {
            yield { content: 'Summary', done: true };
        });

        const onDelta = vi.fn();
        await runner.run('How is the weather?', { onDelta });

        expect(mockTryExecute).toHaveBeenCalledWith('How is the weather?', 'How is the weather?', '', expect.any(Object));
        expect(onDelta).toHaveBeenCalledWith('Summary');
    });

    it('should fall back to LLM if router does not handle', async () => {
        vi.spyOn(SemanticRouter.prototype, 'tryExecute').mockResolvedValue({ handled: false });

        // Mock deconstruction (private chat call)
        brain.chat.mockResolvedValue({ content: '["How is the weather?"]' });

        // Mock LLM chatStream
        brain.chatStream.mockImplementation(async function* () {
            yield { content: 'The weather is nice.', done: true };
        });

        const onDelta = vi.fn();
        await runner.run('How is the weather?', { onDelta });

        expect(brain.chatStream).toHaveBeenCalled();
        expect(onDelta).toHaveBeenCalledWith('The weather is nice.');
    });

    it('should iterate through tool calls', async () => {
        vi.spyOn(SemanticRouter.prototype, 'tryExecute').mockResolvedValue({ handled: false });
        brain.chat.mockResolvedValue({ content: '["action"]' });

        // First call returns a tool call
        // Second call returns a final answer
        let callCount = 0;
        brain.chatStream.mockImplementation(async function* () {
            if (callCount === 0) {
                yield {
                    done: true,
                    toolCalls: [{ id: '1', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Malmo"}' } }]
                };
            } else {
                yield { content: 'It is sunny in Malmo.', done: true };
            }
            callCount++;
        });

        registry.execute = vi.fn().mockResolvedValue({ success: true, data: { temp: 20 } });

        const onDelta = vi.fn();
        const onToolCall = vi.fn();
        await runner.run('Weather in Malmo', { onDelta, onToolCall });

        expect(onToolCall).toHaveBeenCalledWith({ name: 'get_weather', args: { location: 'Malmo' } });
        expect(registry.execute).toHaveBeenCalled();
        expect(onDelta).toHaveBeenCalledWith('It is sunny in Malmo.');
    });

    it('should handle tool execution errors gracefully', async () => {
        vi.spyOn(SemanticRouter.prototype, 'tryExecute').mockResolvedValue({ handled: false });
        brain.chat.mockResolvedValue({ content: '["action"]' });

        brain.chatStream.mockImplementation(async function* () {
            yield {
                done: true,
                toolCalls: [{ id: '1', type: 'function', function: { name: 'fail_tool', arguments: '{}' } }]
            };
        });

        registry.execute = vi.fn().mockRejectedValue(new Error('Tool crashed'));

        const onToolResult = vi.fn();
        await runner.run('dangerous action', { onDelta: vi.fn(), onToolResult });

        expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            error: 'Execution error: Tool crashed'
        }));
    });
});
