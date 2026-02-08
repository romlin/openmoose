/**
 * Agent runner -- orchestrates the semantic router, LLM brain, tool execution,
 * and memory to process user messages end-to-end.
 */

import { LocalBrain, ToolCall, OpenAITool } from '../agents/brain.js';
import { LocalMemory } from '../infra/memory.js';
import { LocalSandbox } from '../infra/sandbox.js';
import { StreamingFormatter } from '../infra/formatter.js';
import { SkillRegistry } from './registry.js';
import { SkillContext } from './skill.js';
import { TaskScheduler } from './scheduler.js';
import { WhatsAppManager } from '../infra/whatsapp.js';
import { SemanticRouter } from './semantic-router.js';
import { builtInRoutes } from './skill-routes.js';
import { PortableSkillLoader } from './portable-skills.js';
import { logger } from '../infra/logger.js';
import path from 'node:path';

/** Maximum number of LLM tool-call iterations before halting. */
const MAX_TOOL_ITERATIONS = 10;

/** Keywords that trigger automatic fact capture. */
const AUTO_CAPTURE_TRIGGERS = ['remember', 'my name is', 'i like', 'favorite'];

/**
 * AgentRunner: Orchestrates the interaction between the Brain, Hands, and Memory.
 * Uses Semantic Router for fast intent matching, falls back to LLM for complex queries.
 */
export class AgentRunner {
    private router: SemanticRouter;

    constructor(
        private brain: LocalBrain,
        private memory: LocalMemory,
        private sandbox: LocalSandbox,
        private registry: SkillRegistry,
        private scheduler: TaskScheduler,
        private whatsapp: WhatsAppManager
    ) {
        this.router = new SemanticRouter();
    }

    async init() {
        for (const route of builtInRoutes) {
            this.router.register(route);
        }

        const skillsDir = path.join(process.cwd(), 'skills');
        const portableSkills = await PortableSkillLoader.loadDirectory(skillsDir);

        for (const route of portableSkills) {
            this.router.register(route);
        }

        logger.debug(`Initialized with ${builtInRoutes.length + portableSkills.length} skills`, 'Runner');
    }

    /** Build a shared SkillContext from the runner's services. */
    private buildContext(): SkillContext {
        return {
            memory: this.memory,
            sandbox: this.sandbox,
            brain: this.brain,
            scheduler: this.scheduler,
            whatsapp: this.whatsapp
        };
    }

    async run(
        message: string,
        options: {
            onDelta: (text: string) => void,
            onToolCall?: (payload: { name: string, args: Record<string, unknown> }) => void,
            onToolResult?: (payload: { name: string, success: boolean, error?: string }) => void
        },
        history: { role: string, content: string }[] = []
    ) {
        const formatter = new StreamingFormatter();
        const tools = this.registry.getOpenAITools();
        const skillContext = this.buildContext();

        // STEP 1: Try Semantic Router on the raw message first (fastest path)
        const directRouteResult = await this.router.tryExecute(message, message, '', skillContext);
        if (directRouteResult.handled && directRouteResult.success) {
            const summary = await this.summarizeResults(message, [message], [{ action: message, result: directRouteResult.result || '' }], history, options.onDelta, formatter);
            await this.autoCapture(message);
            return summary;
        }

        // STEP 2: Try Deconstruction (handles multi-intent or complex queries)
        const actions = await this.deconstructMessage(message);
        const routerResults: { action: string, result: string }[] = [];
        let cumulativeContext = '';

        // If deconstruction didn't actually split it, and we already tried direct route, 
        // we skip the loop if the router already failed for this specific string.
        if (actions.length === 1 && actions[0] === message && directRouteResult.handled === false) {
            logger.debug('Skipping redundant router check after failed direct attempt', 'Runner');
        } else {
            for (const action of actions) {
                logger.debug(`Executing step: "${action}"`, 'Runner');

                const routeResult = await this.router.tryExecute(action, action, cumulativeContext, skillContext);

                if (routeResult.handled) {
                    if (routeResult.success) {
                        logger.success(`Step success: ${routeResult.result}`, 'Runner');
                        routerResults.push({ action, result: routeResult.result || '' });
                        cumulativeContext += (cumulativeContext ? '\n' : '') + `Result of "${action}": ${routeResult.result}`;
                    } else {
                        logger.error(`Step failed: ${routeResult.result}`, 'Runner');
                        routerResults.push({ action, result: `ERROR: ${routeResult.result}` });
                        break;
                    }
                } else {
                    logger.info(`Step not handled by router: ${action}`, 'Runner');
                }
            }
        }

        if (routerResults.length > 0) {
            const summary = await this.summarizeResults(message, actions, routerResults, history, options.onDelta, formatter);
            await this.autoCapture(message);
            return summary;
        }

        // STEP 3: Fall back to full LLM with tools
        const currentHistory = [...history];
        let currentMessage = message;
        let accumulatedResponse = '';
        let iterations = 0;

        while (iterations < MAX_TOOL_ITERATIONS) {
            const { fullResponse, toolCalls } = await this.streamAndCollect(
                currentMessage, currentHistory, tools, formatter, options.onDelta
            );

            accumulatedResponse += (fullResponse + ' ');
            currentHistory.push({ role: 'user', content: currentMessage });
            currentHistory.push({ role: 'assistant', content: fullResponse });

            if (toolCalls && toolCalls.length > 0) {
                const results = await this.executeToolCalls(toolCalls, options.onToolCall, options.onToolResult);
                currentMessage = `Tool results: ${JSON.stringify(results)}. Please continue if the task is not complete, or provide a final answer.`;
                iterations++;
            } else {
                break;
            }
        }

        await this.autoCapture(message);
        return accumulatedResponse.trim();
    }

    private async streamAndCollect(
        message: string,
        history: { role: string, content: string }[],
        tools: OpenAITool[],
        formatter: StreamingFormatter,
        onDelta: (text: string) => void
    ): Promise<{ fullResponse: string, toolCalls?: ToolCall[] }> {
        let fullResponse = '';
        let finalToolCalls: ToolCall[] | undefined;

        for await (const chunk of this.brain.chatStream(message, history, tools)) {
            if (chunk.content) {
                const clean = formatter.process(chunk.content);
                if (clean) {
                    fullResponse += clean;
                    onDelta(clean);
                }
            }

            if (chunk.done) {
                const remaining = formatter.flush();
                if (remaining) {
                    fullResponse += remaining;
                    onDelta(remaining);
                }
                finalToolCalls = chunk.toolCalls;
            }
        }

        return { fullResponse, toolCalls: finalToolCalls };
    }

    private async executeToolCalls(
        toolCalls: ToolCall[],
        onToolCall?: (payload: { name: string, args: Record<string, unknown> }) => void,
        onToolResult?: (payload: { name: string, success: boolean, error?: string }) => void
    ): Promise<{ tool: string; result: unknown }[]> {
        const results: { tool: string; result: unknown }[] = [];
        logger.info(`Executing ${toolCalls.length} tool call(s).`, 'Runner');

        const context = this.buildContext();

        for (const tc of toolCalls) {
            const name = tc.function.name;
            let args: Record<string, unknown> = {};

            try {
                args = JSON.parse(tc.function.arguments || '{}');
            } catch {
                const raw = tc.function.arguments?.trim() || '';
                // LLMs sometimes concatenate multiple JSON objects ("{}{}").
                // Try to split on `}{` boundaries and use the first valid object.
                const parts = raw.includes('}{')
                    ? raw.split(/(?<=\})(?=\{)/)
                    : [];
                let recovered = false;
                if (parts.length > 1) {
                    try {
                        args = JSON.parse(parts[0]);
                        recovered = true;
                        logger.warn(`Recovered first of ${parts.length} concatenated JSON objects for ${name}.`, 'Runner');
                    } catch { /* fall through to _raw */ }
                }
                if (!recovered) {
                    logger.warn(`Failed to parse JSON args for ${name} (${typeof raw}, len=${raw.length}). Fallback to _raw.`, 'Runner');
                    args = { _raw: raw };
                }
            }

            onToolCall?.({ name, args });
            logger.info(`Executing tool: ${name}`, 'Runner');

            let result: { success: boolean; error?: string };
            try {
                result = await this.registry.execute(name, args, context);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                logger.warn(`Tool ${name} threw: ${errorMessage}`, 'Runner');
                result = { success: false, error: errorMessage };
            }

            if (result.success) {
                logger.success(`Tool ${name} succeeded.`, 'Runner');
            } else {
                const safeError = typeof result.error === 'string'
                    ? result.error.slice(0, 120)
                    : 'unknown error';
                logger.warn(`Tool ${name} failed: ${safeError}`, 'Runner');
            }
            onToolResult?.({ name, success: result.success, error: result.error as string | undefined });
            results.push({ tool: name, result });
        }

        return results;
    }

    private async deconstructMessage(message: string): Promise<string[]> {
        if (message.length < 20 && !message.includes(' and ') && !message.includes(' then ')) {
            return [message];
        }

        const prompt = `Break down the following user query into a sequence of atomic, standalone actions.
Each action MUST be a complete sentence that can be handled independently.
If the query is already simple and single-intent, return it as a single-item list.

Critically: Do NOT create steps for "summarizing", "composing" or "formatting" results if they are to be sent or spoken later. The system already handles final formatting. Focus only on data gathering or external actions.

Examples:
- "Weather in Malmö and Stockholm" -> ["Get the weather in Malmö", "Get the weather in Stockholm"]
- "What time is it and how is the weather in Paris?" -> ["What time is it?", "How is the weather in Paris?"]
- "Find the weather in Tokyo then message Vanja with the result" -> ["Find the weather in Tokyo", "Send a WhatsApp message to Vanja with the weather results"]

User Query: "${message}"

Return only a valid JSON array of strings. No conversational text.`;

        try {
            const response = await this.brain.chat(prompt, []);
            const cleaned = response.content.replace(/```json|```/g, '').trim();
            const actions = JSON.parse(cleaned);
            if (Array.isArray(actions) && actions.length > 0) {
                logger.info(`Decomposed into ${actions.length} actions: ${actions.join(' | ')}`, 'Runner');
                return actions;
            }
        } catch (err) {
            logger.error('Intent deconstruction failed', 'Runner', err);
        }

        return [message];
    }

    private async autoCapture(message: string) {
        if (AUTO_CAPTURE_TRIGGERS.some(t => message.toLowerCase().includes(t))) {
            await this.memory.store(message);
            logger.success('Auto-captured fact to long-term memory.', 'Memory');
        }
    }

    private async summarizeResults(
        originalMessage: string,
        actions: string[],
        results: { action: string, result: string }[],
        history: { role: string, content: string }[],
        onDelta: (text: string) => void,
        formatter: StreamingFormatter
    ): Promise<string> {
        const combinedResults = results.map(r => `Action: "${r.action}"\nResult: ${r.result}`).join('\n\n');

        const enhancedMessage = `The user asked: "${originalMessage}"
I decomposed this into ${actions.length} step(s) and successfully executed ${results.length} of them:

${combinedResults}

${results.length < actions.length
                ? 'Some steps could not be handled automatically. Please address the remaining parts of the user request based on these results.'
                : 'Please provide a natural, friendly summary of these results to the user.'}`;

        const { fullResponse } = await this.streamAndCollect(
            enhancedMessage, history, [], formatter, onDelta
        );

        return fullResponse.trim();
    }
}
