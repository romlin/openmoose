/**
 * LocalBrain -- LLM interface using the OpenAI-compatible chat completions API.
 * Supports both local (integrated) and cloud (Mistral) providers with streaming,
 * tool calling, and automatic memory context injection.
 */

import { LocalMemory } from '../infra/memory.js';
import { PromptBuilder } from './prompts/builder.js';
import { logger } from '../infra/logger.js';
import { config } from '../config/index.js';
import { MistralProvider, LlamaProvider, type BrainProvider } from './providers.js';
import type { BrainOptions, OpenAITool, ToolCall, OpenAIMessage, ChatResult } from './types.js';

// Re-export types so existing imports from brain.ts still work
export type { BrainOptions, OpenAITool, ToolCall, ChatResult } from './types.js';

/**
 * LocalBrain: High-level LLM interface that orchestrates prompt building
 * (memory context + skills) and delegates to provider strategies.
 */
export class LocalBrain {
  private memory: LocalMemory;
  private promptBuilder: PromptBuilder;
  private skillsPrompt?: string;
  private provider: BrainProvider;

  constructor(options: BrainOptions) {
    this.memory = options.memory;
    this.skillsPrompt = options.skillsPrompt;
    this.promptBuilder = new PromptBuilder(options.registry);

    // Dynamic strategy selection
    if (config.brain.provider === 'mistral') {
      this.provider = new MistralProvider();
    } else {
      this.provider = new LlamaProvider();
    }
  }

  private async prepareMessages(
    message: string,
    history: { role: string; content: string }[] = []
  ): Promise<OpenAIMessage[]> {
    let memoryContext = '';

    // Optimization: Skip memory recall for very short or purely conversational messages
    const trivial = /^(hi|hello|hey|ok|okay|thanks|thank you|yes|no|stop|summarize|continue)\.?$/i;
    if (message.length > 2 && !trivial.test(message.trim())) {
      try {
        const memories = await this.memory.recall(message);
        if (memories.length > 0) {
          memoryContext = memories.map(m => `- ${m}`).join('\n');
        }
      } catch (err) {
        logger.error('Memory Recall failed', 'Brain', err);
      }
    }

    const finalSystemPrompt = this.promptBuilder.build(this.skillsPrompt, memoryContext);

    const messages: OpenAIMessage[] = [
      { role: 'system', content: finalSystemPrompt },
    ];

    messages.push(...history.map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content || (h.role === 'assistant' ? '[Executing tool...]' : '')
    })));

    messages.push({ role: 'user', content: message });
    return messages;
  }

  /** Chat with the model (non-streaming).
   *  Pass `lightweight: true` for internal utility calls (e.g. decomposition)
   *  that don't need the full system prompt, memory recall, or tool definitions.
   */
  async chat(
    message: string,
    history: { role: string; content: string }[] = [],
    tools?: OpenAITool[],
    options?: { lightweight?: boolean }
  ): Promise<ChatResult> {
    const messages = options?.lightweight
      ? [{ role: 'user' as const, content: message }]
      : await this.prepareMessages(message, history);
    return this.provider.chat(messages, tools);
  }

  /** Stream chat responses for real-time output. */
  async *chatStream(
    message: string,
    history: { role: string; content: string }[] = [],
    tools?: OpenAITool[]
  ): AsyncGenerator<{ content?: string; toolCalls?: ToolCall[]; done: boolean }> {
    const messages = await this.prepareMessages(message, history);
    yield* this.provider.chatStream(messages, tools);
  }

  /** Check if the LLM backend is reachable. */
  async healthCheck() {
    try {
      return await this.provider.healthCheck();
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}
