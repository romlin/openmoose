/**
 * Mistral Cloud Backend -- implements the BrainProvider interface using
 * the Mistral AI API (or any OpenAI-compatible endpoint).
 */

import { config } from '../config/index.js';
import { getErrorMessage } from '../infra/errors.js';
import type { OpenAIMessage, OpenAITool, ToolCall, ChatResult, ChatResponse } from './types.js';
import type { BrainProvider } from './providers.js';

export class MistralProvider implements BrainProvider {
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor() {
        this.baseUrl = (config.brain.mistral.apiKey ? 'https://api.mistral.ai' : 'http://localhost:11434').replace(/\/$/, '') + '/v1';
        this.apiKey = config.brain.mistral.apiKey || '';
        this.model = config.brain.mistral.model;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    async chat(messages: OpenAIMessage[], tools?: OpenAITool[]): Promise<ChatResult> {
        const body = {
            model: this.model,
            messages,
            temperature: 0.1,
            top_p: 0.9,
            stream: false,
            tools: (tools && tools.length > 0) ? tools : undefined,
            tool_choice: (tools && tools.length > 0) ? 'auto' : undefined,
        };

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as ChatResponse;
        const choice = data.choices[0];

        return {
            content: choice.message.content ?? '',
            toolCalls: choice.message.tool_calls ?? [],
            finishReason: choice.finish_reason,
        };
    }

    async *chatStream(messages: OpenAIMessage[], tools?: OpenAITool[]): AsyncGenerator<{ content?: string; toolCalls?: ToolCall[]; done: boolean }> {
        const body = {
            model: this.model,
            messages,
            temperature: 0.1,
            top_p: 0.9,
            stream: true,
            tools: (tools && tools.length > 0) ? tools : undefined,
            tool_choice: (tools && tools.length > 0) ? 'auto' : undefined,
        };

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        const accumulatedToolCalls: Map<number, ToolCall> = new Map();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split('\n');
            buffer = chunks.pop() ?? '';

            for (const line of chunks) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (!trimmed.startsWith('data: ')) continue;

                try {
                    const json = JSON.parse(trimmed.slice(6)) as ChatResponse;
                    const delta = json.choices[0]?.delta;

                    if (delta?.content) {
                        yield { content: delta.content, done: false };
                    }

                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const existing = accumulatedToolCalls.get(tc.index);
                            if (existing) {
                                if (tc.function?.arguments) {
                                    existing.function.arguments += tc.function.arguments;
                                }
                            } else if (tc.id && tc.function?.name) {
                                accumulatedToolCalls.set(tc.index, {
                                    id: tc.id,
                                    type: 'function',
                                    function: {
                                        name: tc.function.name,
                                        arguments: tc.function.arguments ?? '',
                                    },
                                });
                            }
                        }
                    }

                    if (json.choices[0]?.finish_reason) {
                        const toolCalls = Array.from(accumulatedToolCalls.values());
                        yield { toolCalls: toolCalls.length > 0 ? toolCalls : undefined, done: true };
                    }
                } catch { /* Partial JSON chunk */ }
            }
        }
    }

    async healthCheck(): Promise<{ ok: boolean; host: string; model: string; isCloud: true; status?: string }> {
        try {
            const res = await fetch(`${this.baseUrl}/models`, {
                method: 'GET',
                headers: this.getHeaders(),
            });
            if (!res.ok) {
                return { ok: false, host: this.baseUrl, model: this.model, isCloud: true, status: `HTTP ${res.status}` };
            }
            return { ok: true, host: this.baseUrl, model: this.model, isCloud: true };
        } catch (err) {
            return { ok: false, host: this.baseUrl, model: this.model, isCloud: true, status: getErrorMessage(err) };
        }
    }
}
