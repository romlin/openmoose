/**
 * node-llama-cpp Local Backend -- implements the BrainProvider interface
 * using an integrated GGUF model via node-llama-cpp.
 */

import { config } from '../config/index.js';
import { logger } from '../infra/logger.js';
import type { OpenAIMessage, OpenAITool, ToolCall, ChatResult } from './types.js';
import type { BrainProvider } from './providers.js';

export class LlamaProvider implements BrainProvider {
    private llama?: import('node-llama-cpp').Llama;
    private llamaModel?: import('node-llama-cpp').LlamaModel;
    private llamaContext?: import('node-llama-cpp').LlamaContext;
    private llamaChat?: import('node-llama-cpp').LlamaChat;

    private async ensureInitialized() {
        if (this.llamaChat) return;

        try {
            const { getLlama, LlamaChat, LlamaLogLevel } = await import('node-llama-cpp');
            this.llama = await getLlama({
                gpu: config.brain.llamaCpp.gpu,
                logLevel: LlamaLogLevel.error,
                logger: (level, message) => {
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

    async chat(messages: OpenAIMessage[], tools?: OpenAITool[]): Promise<ChatResult> {
        await this.ensureInitialized();
        const { systemPrompt, userMessage, history } = this.parseMessages(messages);

        const functions = this.mapToolsToFunctions(tools);
        const llamaHistory = this.mapHistory(history, systemPrompt);

        const response = await this.llamaChat!.generateResponse([
            ...llamaHistory,
            { type: 'user', text: userMessage }
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

    async *chatStream(messages: OpenAIMessage[], tools?: OpenAITool[]): AsyncGenerator<{ content?: string; toolCalls?: ToolCall[]; done: boolean }> {
        await this.ensureInitialized();
        const { systemPrompt, userMessage, history } = this.parseMessages(messages);

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

        const functions = this.mapToolsToFunctions(tools);
        const llamaHistory = this.mapHistory(history, systemPrompt);

        this.llamaChat!.generateResponse([
            ...llamaHistory,
            { type: 'user', text: userMessage }
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
                push(`__TOOL_CALLS__${JSON.stringify(toolCalls)}`);
            }
            push(null);
        }).catch((err: unknown) => {
            logger.error('node-llama-cpp prompt failed', 'Brain', err);
            push(null);
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
    }

    async healthCheck() {
        const fs = await import('node:fs/promises');
        const exists = await fs.access(config.brain.llamaCpp.modelPath).then(() => true).catch(() => false);
        return {
            ok: exists,
            host: 'local',
            model: config.brain.llamaCpp.modelPath,
            modelInstalled: exists
        };
    }

    private parseMessages(messages: OpenAIMessage[]) {
        const systemPrompt = messages.find(m => m.role === 'system')?.content || undefined;
        const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
        const userMessage = lastUserIdx !== -1 ? (messages[lastUserIdx].content || '') : '';
        const history = messages.slice(0, lastUserIdx).filter(m => m.role !== 'system');
        return { systemPrompt, userMessage, history };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mapHistory(history: OpenAIMessage[], systemPrompt?: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const llamaHistory: any[] = [];
        if (systemPrompt) llamaHistory.push({ type: 'system', text: systemPrompt });
        for (const h of history) {
            if (h.role === 'user') {
                llamaHistory.push({ type: 'user', text: h.content || '' });
            } else if (h.role === 'assistant') {
                llamaHistory.push({ type: 'model', response: [h.content || ''] });
            }
        }
        return llamaHistory;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mapToolsToFunctions(tools?: OpenAITool[]): any {
        if (!tools || tools.length === 0) return {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
