/**
 * LocalBrain -- LLM interface using the OpenAI-compatible chat completions API.
 * Supports both local (integrated) and cloud (Mistral) providers with streaming,
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

  // node-llama-cpp members
  private llama?: import('node-llama-cpp').Llama;
  private llamaModel?: import('node-llama-cpp').LlamaModel;
  private llamaContext?: import('node-llama-cpp').LlamaContext;
  private llamaChat?: import('node-llama-cpp').LlamaChat;

  constructor(options: BrainOptions) {
    const provider = config.brain.provider;

    if (provider === 'mistral') {
      this.mistralApiKey = options.mistralApiKey || config.brain.mistral.apiKey;
      this.baseUrl = (options.host || 'https://api.mistral.ai').replace(/\/$/, '') + '/v1';
      this.model = options.model || config.brain.mistral.model;
    } else {
      // Default/Local provider: node-llama-cpp
      this.baseUrl = ''; // Local, no base URL
      this.model = config.brain.llamaCpp.modelPath;
    }

    this.memory = options.memory;
    this.skillsPrompt = options.skillsPrompt;
    this.promptBuilder = new PromptBuilder(options.registry);
  }

  private async ensureLlamaInitialized() {
    if (this.llamaChat) return;

    try {
      // Lazy load to avoid forcing dependency if not used
      const { getLlama, LlamaChat, LlamaLogLevel } = await import('node-llama-cpp');
      this.llama = await getLlama({
        gpu: config.brain.llamaCpp.gpu,
        logLevel: LlamaLogLevel.error, // Suppress non-fatal warnings
        logger: (level, message) => {
          // Direct library logs to our logger
          if (level === LlamaLogLevel.fatal || level === LlamaLogLevel.error) {
            logger.error(message, 'LlamaCPP');
          } else if (config.logging.level === 'debug') {
            logger.debug(message, 'LlamaCPP');
          }
        }
      });
      this.llamaModel = await this.llama.loadModel({
        modelPath: config.brain.llamaCpp.modelPath
      });
      this.llamaContext = await this.llamaModel.createContext();
      this.llamaChat = new LlamaChat({
        contextSequence: this.llamaContext.getSequence()
      });
      logger.info(`node-llama-cpp initialized with model: ${config.brain.llamaCpp.modelPath}`, 'Brain');
    } catch (err) {
      logger.error('Failed to initialize node-llama-cpp', 'Brain', err);
      throw new Error(`Inference engine initialization failed: ${String(err)}`);
    }
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
    if (config.brain.provider === 'node-llama-cpp' || config.brain.provider !== 'mistral') {
      const { systemPrompt } = await this.prepareLlamaExecution(message, history);
      await this.ensureLlamaInitialized();


      const functions = this.mapOpenAIToolsToLlamaFunctions(tools);
      const llamaHistory = await this.mapHistoryToLlamaHistory(history, systemPrompt);

      const response = await this.llamaChat!.generateResponse([
        ...llamaHistory,
        { type: 'user', text: message }
      ], {
        functions: Object.keys(functions).length > 0 ? functions : undefined
      });

      const toolCalls: ToolCall[] = [];
      if (response.functionCalls) {
        for (const fc of response.functionCalls) {
          toolCalls.push({
            id: `call_${Math.random().toString(36).slice(2)}`,
            type: 'function',
            function: {
              name: fc.functionName,
              arguments: JSON.stringify(fc.params)
            }
          });
        }
      }

      return {
        content: response.response,
        toolCalls,
        finishReason: response.metadata.stopReason === 'functionCalls' ? 'tool_calls' : 'stop',
      };
    }

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
    if (config.brain.provider === 'node-llama-cpp' || config.brain.provider !== 'mistral') {
      const { systemPrompt } = await this.prepareLlamaExecution(message, history);
      await this.ensureLlamaInitialized();


      // Manual queue to convert callback to AsyncGenerator
      const queue: (string | null)[] = [];
      let resolver: ((value: string | null) => void) | null = null;

      const push = (chunk: string | null) => {
        if (resolver) {
          resolver(chunk);
          resolver = null;
        } else {
          queue.push(chunk);
        }
      };

      const pull = (): Promise<string | null> => {
        if (queue.length > 0) return Promise.resolve(queue.shift()!);
        return new Promise(resolve => { resolver = resolve; });
      };

      // Start inference in "background"
      const functions = this.mapOpenAIToolsToLlamaFunctions(tools);
      this.mapHistoryToLlamaHistory(history, systemPrompt).then(llamaHistory => {
        this.llamaChat!.generateResponse([
          ...llamaHistory,
          { type: 'user', text: message }
        ], {
          onTextChunk: (chunk: string) => push(chunk),
          functions: Object.keys(functions).length > 0 ? functions : undefined
        }).then((response) => {
          const toolCalls: ToolCall[] = [];
          if (response.functionCalls) {
            for (const fc of response.functionCalls) {
              toolCalls.push({
                id: `call_${Math.random().toString(36).slice(2)}`,
                type: 'function',
                function: {
                  name: fc.functionName,
                  arguments: JSON.stringify(fc.params)
                }
              });
            }
          }

          if (toolCalls.length > 0) {
            // We yield tool calls at the very end of the stream
            push(`__TOOL_CALLS__${JSON.stringify(toolCalls)}`);
          }
          push(null);
        }).catch((err: unknown) => {
          logger.error('node-llama-cpp prompt failed', 'Brain', err);
          push(null);
        });
      });

      let capturedToolCalls: ToolCall[] | undefined;

      while (true) {
        const chunk = await pull();
        if (chunk === null) break;
        if (chunk.startsWith('__TOOL_CALLS__')) {
          capturedToolCalls = JSON.parse(chunk.slice(14)) as ToolCall[];
          continue;
        }
        yield { content: chunk, done: false };
      }

      yield { toolCalls: capturedToolCalls, done: true };
      return;
    }

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
      if (config.brain.provider === 'node-llama-cpp' || config.brain.provider !== 'mistral') {
        const fs = await import('node:fs/promises');
        const exists = await fs.access(config.brain.llamaCpp.modelPath).then(() => true).catch(() => false);
        return {
          ok: exists,
          host: 'local',
          model: config.brain.llamaCpp.modelPath,
          modelInstalled: exists
        };
      }

      return { ok: true, host: this.baseUrl, model: this.model, isCloud: true };
    } catch (error) {
      return { ok: false, host: this.baseUrl, error: String(error) };
    }
  }

  private async prepareLlamaExecution(message: string, history: { role: string; content: string }[]) {
    const templateMessages = await this.prepareMessages(message, history);
    const systemPrompt = templateMessages.find(m => m.role === 'system')?.content ?? undefined;
    return { systemPrompt };
  }

  private async mapHistoryToLlamaHistory(history: { role: string; content: string }[], systemPrompt?: string): Promise<any[]> {
    const llamaHistory: any[] = [];
    if (systemPrompt) {
      llamaHistory.push({ type: 'system', text: systemPrompt });
    }
    for (const h of history) {
      if (h.role === 'system') {
        // We already added the most current system prompt
        continue;
      } else if (h.role === 'user') {
        llamaHistory.push({ type: 'user', text: h.content });
      } else if (h.role === 'assistant') {
        llamaHistory.push({ type: 'model', response: [h.content || ''] });
      }
    }
    return llamaHistory;
  }

  private mapOpenAIToolsToLlamaFunctions(tools?: OpenAITool[]): any {
    if (!tools || tools.length === 0) return {};

    const functions: any = {};
    for (const tool of tools) {
      if (tool.type === 'function') {
        functions[tool.function.name] = {
          description: tool.function.description,
          params: tool.function.parameters
        };
      }
    }
    return functions;
  }
}
