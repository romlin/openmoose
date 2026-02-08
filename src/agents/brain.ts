/**
 * LocalBrain -- LLM interface using the OpenAI-compatible chat completions API.
 * Supports both local (Ollama) and cloud (Mistral) providers with streaming,
 * tool calling, and automatic memory context injection.
 */

import { LocalMemory } from '../infra/memory.js';
import { PromptBuilder } from './prompts/builder.js';
import { logger } from '../infra/logger.js';
import { config } from '../config/index.js';
import type { BrainOptions, OpenAITool, ToolCall, OpenAIMessage, ChatResponse, ChatResult } from './types.js';

// Re-export types so existing imports from brain.ts still work
export type { BrainOptions, OpenAITool, ToolCall, ChatResult } from './types.js';

/**
 * LLM interface that wraps the OpenAI-compatible `/v1/chat/completions` endpoint.
 * Automatically builds system prompts with memory context and tool definitions.
 */
export class LocalBrain {
  private baseUrl: string;
  private model: string;
  private mistralApiKey?: string;
  private memory: LocalMemory;
  private promptBuilder: PromptBuilder;
  private skillsPrompt?: string;

  constructor(options: BrainOptions) {
    const provider = config.brain.provider;

    if (provider === 'mistral') {
      this.mistralApiKey = options.mistralApiKey || config.brain.mistral.apiKey;
      this.baseUrl = (options.host || 'https://api.mistral.ai').replace(/\/$/, '') + '/v1';
      this.model = options.model || config.brain.mistral.model;
    } else {
      this.baseUrl = (options.host || config.brain.ollama.host).replace(/\/$/, '') + '/v1';
      this.model = options.model || config.brain.ollama.model;
    }

    this.memory = options.memory;
    this.skillsPrompt = options.skillsPrompt;
    this.promptBuilder = new PromptBuilder(options.registry);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.mistralApiKey) {
      headers['Authorization'] = `Bearer ${this.mistralApiKey}`;
    }
    return headers;
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

  private buildRequestBody(messages: OpenAIMessage[], stream: boolean, tools?: OpenAITool[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.1,
      top_p: 0.9,
      stream,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    return body;
  }

  /** Chat with the model (non-streaming). */
  async chat(
    message: string,
    history: { role: string; content: string }[] = [],
    tools?: OpenAITool[]
  ): Promise<ChatResult> {
    const messages = await this.prepareMessages(message, history);
    const body = this.buildRequestBody(messages, false, tools);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat API error: ${response.status} - ${errorText}`);
    }

    let data: ChatResponse;
    try {
      data = await response.json() as ChatResponse;
    } catch {
      throw new Error('Failed to parse LLM response as JSON');
    }
    const choice = data.choices[0];

    return {
      content: choice.message.content ?? '',
      toolCalls: choice.message.tool_calls ?? [],
      finishReason: choice.finish_reason,
    };
  }

  /** Stream chat responses for real-time output. */
  async *chatStream(
    message: string,
    history: { role: string; content: string }[] = [],
    tools?: OpenAITool[]
  ): AsyncGenerator<{ content?: string; toolCalls?: ToolCall[]; done: boolean }> {
    const messages = await this.prepareMessages(message, history);
    const body = this.buildRequestBody(messages, true, tools);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat API error: ${response.status} - ${errorText}`);
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
        } catch {
          // Ignore parse errors for partial SSE chunks
        }
      }
    }
  }

  /** Check if the LLM backend is reachable and the configured model is available. */
  async healthCheck() {
    try {
      if (this.mistralApiKey) {
        return { ok: true, host: this.baseUrl, model: this.model, isCloud: true };
      }

      const response = await fetch(`${this.baseUrl.replace('/v1', '')}/api/tags`);
      if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
      const data = await response.json() as { models: Array<{ name: string }> };
      return {
        ok: true,
        host: this.baseUrl,
        model: this.model,
        modelInstalled: data.models.some(m => m.name.includes(this.model))
      };
    } catch (error) {
      return { ok: false, host: this.baseUrl, error: String(error) };
    }
  }
}
