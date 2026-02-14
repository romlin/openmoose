/**
 * LLM provider interface and re-exports.
 * Concrete implementations live in mistral-provider.ts and llama-provider.ts.
 */

import type { OpenAIMessage, OpenAITool, ToolCall, ChatResult } from './types.js';

/** Interface that all LLM backends must implement. */
export interface BrainProvider {
    chat(messages: OpenAIMessage[], tools?: OpenAITool[]): Promise<ChatResult>;
    chatStream(messages: OpenAIMessage[], tools?: OpenAITool[]): AsyncGenerator<{ content?: string; toolCalls?: ToolCall[]; done: boolean }>;
    healthCheck(): Promise<unknown>;
    warmup(): Promise<void>;
}

export { MistralProvider } from './mistral-provider.js';
export { LlamaProvider } from './llama-provider.js';
