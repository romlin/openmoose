/**
 * Shared type definitions for the OpenAI-compatible chat completions API.
 * Used by the Brain, Runner, and Registry modules.
 */

/** Options for constructing a LocalBrain instance. */
export interface BrainOptions {
    model?: string;
    host?: string;
    mistralApiKey?: string;
    memory: import('../infra/memory.js').LocalMemory;
    registry: import('../runtime/registry.js').SkillRegistry;
    skillsPrompt?: string;
}

/** OpenAI-compatible tool definition format. */
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/** Tool call from the model response. */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

/** Message in OpenAI format. */
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

/** Response choice from OpenAI-compatible API. */
export interface ChatChoice {
    index: number;
    message: {
        role: 'assistant';
        content: string | null;
        tool_calls?: ToolCall[];
    };
    delta?: {
        role?: 'assistant';
        content?: string | null;
        tool_calls?: Array<{
            index: number;
            id?: string;
            type?: 'function';
            function?: {
                name?: string;
                arguments?: string;
            };
        }>;
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
}

/** Full response from OpenAI-compatible API. */
export interface ChatResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: ChatChoice[];
}

/** Chat result with potential tool calls. */
export interface ChatResult {
    content: string;
    toolCalls: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | null;
}
