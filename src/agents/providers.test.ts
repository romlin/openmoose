import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MistralProvider, LlamaProvider } from './providers.js';
import type { OpenAIMessage } from './types.js';

// Mock global fetch for Mistral tests
global.fetch = vi.fn();

describe('MistralProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send correct request to Mistral API', async () => {
        const mockResponse = {
            ok: true,
            json: () => Promise.resolve({
                choices: [{
                    message: { content: 'hello', tool_calls: [] },
                    finish_reason: 'stop'
                }]
            })
        };
        vi.mocked(global.fetch).mockResolvedValue(mockResponse as Response);

        const provider = new MistralProvider();
        const result = await provider.chat([{ role: 'user', content: 'hi' }]);

        expect(result.content).toBe('hello');
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('api.mistral.ai'),
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"content":"hi"')
            })
        );
    });

    it('should handle API errors', async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Error')
        } as unknown as Response);

        const provider = new MistralProvider();
        await expect(provider.chat([])).rejects.toThrow('Mistral API error: 500');
    });
});

describe('LlamaProvider', () => {
    it('should parse messages into system, history, and user message', () => {
        // Access private methods for unit testing
        const provider = new LlamaProvider() as unknown as { parseMessages: (m: OpenAIMessage[]) => { systemPrompt?: string; userMessage: string; history: OpenAIMessage[] } };
        const messages: OpenAIMessage[] = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'u1' },
            { role: 'assistant', content: 'a1' },
            { role: 'user', content: 'u2' }
        ];

        const { systemPrompt, userMessage, history } = provider.parseMessages(messages);
        expect(systemPrompt).toBe('sys');
        expect(userMessage).toBe('u2');
        expect(history).toHaveLength(2);
        expect(history[0].content).toBe('u1');
    });

    it('should map history correctly for node-llama-cpp', () => {
        const provider = new LlamaProvider() as unknown as { mapHistory: (h: OpenAIMessage[], sys?: string) => Array<{ type: string; text?: string; response?: string[] }> };
        const history: OpenAIMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' }
        ];

        const mapped = provider.mapHistory(history, 'sys');
        expect(mapped).toHaveLength(3);
        expect(mapped[0]).toEqual({ type: 'system', text: 'sys' });
        expect(mapped[1]).toEqual({ type: 'user', text: 'hi' });
        expect(mapped[2]).toEqual({ type: 'model', response: ['hello'] });
    });
});
