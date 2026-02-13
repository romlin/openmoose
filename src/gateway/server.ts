/**
 * OpenMoose Gateway -- central HTTP/WebSocket server that orchestrates
 * the brain, memory, sandbox, audio, WhatsApp, and scheduler services.
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { LocalBrain } from '../agents/brain.js';
import { LocalAudio } from '../infra/audio.js';
import { LocalMemory } from '../infra/memory.js';
import { LocalSandbox } from '../infra/sandbox.js';
import { WhatsAppManager } from '../infra/whatsapp.js';
import { HistoryManager } from '../infra/history.js';
import { AgentRunner } from '../runtime/runner.js';
import { SkillRegistry } from '../runtime/registry.js';
import { loadSkillEntries, buildSkillsPrompt } from '../runtime/skill-loader.js';
import { logger } from '../infra/logger.js';
import { readdir } from 'node:fs/promises';
import { TaskScheduler } from '../runtime/scheduler.js';
import { isPortInUse, findPidOnPort, askConfirm, killProcess } from './port-utils.js';
import { setupWhatsAppBridge } from './whatsapp-bridge.js';
import { printBanner, printStatus, printPending, printReady } from '../infra/banner.js';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config, getModelName } from '../config/index.js';
import { BrowserManager } from '../runtime/browser/manager.js';
import { getErrorMessage } from '../infra/errors.js';

/** Zod schema for validating incoming WebSocket payloads. */
const WsPayloadSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('agent.run'), message: z.string(), audio: z.boolean().optional() }),
    z.object({ type: z.literal('agent.history'), limit: z.number().optional() }),
    z.object({ type: z.literal('agent.history.clear') }),
    z.object({ type: z.literal('agent.memory.list'), limit: z.number().optional(), source: z.enum(['chat', 'doc']).optional() }),
    z.object({ type: z.literal('agent.memory.search'), query: z.string(), limit: z.number().optional(), source: z.enum(['chat', 'doc']).optional() }),
    z.object({ type: z.literal('agent.memory.clear') }),
    z.object({ type: z.literal('whatsapp.send'), name: z.string(), text: z.string() }),
    z.object({ type: z.literal('agent.system.info') }),
]);

/**
 * Central gateway that wires all OpenMoose services together.
 * Exposes a WebSocket API for real-time agent interaction and
 * an HTTP endpoint for health checks.
 */
export class LocalGateway {
    private wss: WebSocketServer;
    private port: number;

    private memory: LocalMemory;
    private sandbox: LocalSandbox;
    private audio: LocalAudio;
    private brain!: LocalBrain;
    private runner!: AgentRunner;
    private skillRegistry = new SkillRegistry();
    private scheduler!: TaskScheduler;
    private whatsapp!: WhatsAppManager;
    private history = new HistoryManager();
    private sessions = new Map<WebSocket, { role: 'user' | 'assistant', content: string }[]>();
    private whatsappSessions = new Map<string, { role: 'user' | 'assistant', content: string }[]>();
    private skillsPrompt = '';

    constructor(port: number = config.gateway.port) {
        this.port = port;
        this.wss = new WebSocketServer({ noServer: true });
        this.memory = new LocalMemory();
        this.sandbox = new LocalSandbox();
        this.audio = new LocalAudio();
        this.setupWSS();
    }

    private setupWSS() {
        this.wss.on('connection', (ws: WebSocket) => {
            logger.success('Node connected to Gateway', 'Gateway');
            ws.on('message', (data) => this.onSocketMessage(ws, data));
            ws.on('close', () => {
                this.sessions.delete(ws);
                logger.info('Node disconnected from Gateway', 'Gateway');
            });
        });
    }

    private async onSocketMessage(ws: WebSocket, data: RawData) {
        try {
            await this.handleJsonMessage(ws, data.toString());
        } catch (error) {
            logger.error('Gateway Socket Error', 'Gateway', error);
            ws.send(JSON.stringify({ type: 'error', message: String(error) }));
        }
    }

    private async handleJsonMessage(ws: WebSocket, data: string) {
        let raw: unknown;
        try {
            raw = JSON.parse(data);
        } catch {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            return;
        }

        const parsed = WsPayloadSchema.safeParse(raw);
        if (!parsed.success) {
            ws.send(JSON.stringify({ type: 'error', message: `Invalid payload: ${parsed.error.message}` }));
            return;
        }

        const payload = parsed.data;

        if (payload.type === 'agent.run') {
            const response = await this._processAgentRequest(
                payload.message,
                this.sessions.get(ws) || [],
                (history) => this.sessions.set(ws, history),
                {
                    onDelta: (text) => ws.send(JSON.stringify({ type: 'agent.delta', text })),
                    onToolCall: (tool) => ws.send(JSON.stringify({ type: 'agent.tool_call', ...tool })),
                    onToolResult: (payload) => ws.send(JSON.stringify({ type: 'agent.tool_result', ...payload }))
                }
            );

            if (payload.audio && response) {
                const audioBuffer = await this.audio.generateWav(response);
                ws.send(JSON.stringify({ type: 'agent.audio', audio: audioBuffer.toString('base64') }));
            }
            ws.send(JSON.stringify({ type: 'agent.final' }));
        } else if (payload.type === 'agent.history') {
            const history = await this.history.loadLast(payload.limit || 50);
            ws.send(JSON.stringify({ type: 'agent.history.result', history }));
        } else if (payload.type === 'agent.history.clear') {
            await this.history.clear();
            this.sessions.delete(ws);
            ws.send(JSON.stringify({ type: 'agent.history.clear.result', success: true }));
        } else if (payload.type === 'agent.memory.list') {
            const memories = await this.memory.list(payload.limit || 100, payload.source);
            ws.send(JSON.stringify({ type: 'agent.memory.list.result', memories }));
        } else if (payload.type === 'agent.memory.search') {
            const memories = await this.memory.search(payload.query, payload.limit || 50, payload.source);
            ws.send(JSON.stringify({ type: 'agent.memory.search.result', memories }));
        } else if (payload.type === 'agent.memory.clear') {
            await this.memory.clear();
            ws.send(JSON.stringify({ type: 'agent.memory.clear.result', success: true }));
        } else if (payload.type === 'whatsapp.send') {
            try {
                const contact = await (await import('../infra/contacts.js')).ContactsManager.lookup(payload.name);
                if (!contact) {
                    ws.send(JSON.stringify({ type: 'whatsapp.send.result', success: false, error: `Contact ${payload.name} not found` }));
                    return;
                }
                await this.whatsapp.sendMessage(contact.jid, payload.text);
                ws.send(JSON.stringify({ type: 'whatsapp.send.result', success: true, message: `Message sent to ${contact.name}` }));
            } catch (err) {
                ws.send(JSON.stringify({ type: 'whatsapp.send.result', success: false, error: String(err) }));
            }
        } else if (payload.type === 'agent.system.info') {
            const info = {
                type: 'agent.system.info.result',
                cpu: process.cpuUsage(),
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                platform: process.platform,
                arch: process.arch,
                version: process.version,
                brain: {
                    provider: config.brain.provider,
                    model: getModelName(),
                    gpu: config.brain.llamaCpp.gpu || 'none',
                    status: await this.brain.healthCheck(),
                },
                skills: {
                    builtin: this.skillRegistry.getAll().map(s => s.name),
                    portable: await (async () => {
                        const skillsDir = config.skills.portableDir;
                        try {
                            const files = await readdir(skillsDir);
                            return files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
                                .map(f => path.basename(f, path.extname(f)));
                        } catch { return []; }
                    })()
                },
                scheduler: {
                    status: 'active',
                    pollInterval: config.scheduler.pollIntervalMs
                },
                browser: {
                    status: 'daemon active'
                }
            };
            ws.send(JSON.stringify(info));
        }
    }

    private async _processAgentRequest(
        message: string,
        history: { role: 'user' | 'assistant', content: string }[],
        saveHistory: (history: { role: 'user' | 'assistant', content: string }[]) => void,
        callbacks: {
            onDelta?: (text: string) => void,
            onToolCall?: (payload: { name: string; args: Record<string, unknown> }) => void,
            onToolResult?: (payload: { name: string; success: boolean; error?: string }) => void
        } = {}
    ): Promise<string> {
        const fullResponse = await this.runner.run(message, {
            onDelta: callbacks.onDelta || (() => { }),
            onToolCall: callbacks.onToolCall,
            onToolResult: callbacks.onToolResult
        }, history);

        const updatedHistory = [...history,
        { role: 'user' as const, content: message },
        { role: 'assistant' as const, content: fullResponse }
        ].slice(-config.gateway.maxHistoryLength);

        // Persist to disk
        await this.history.append('user', message);
        await this.history.append('assistant', fullResponse);

        saveHistory(updatedHistory);
        return fullResponse;
    }

    /** Boot the gateway: resolve port conflicts, init all services, and start listening. */
    public async start() {
        printBanner();

        await this.resolvePortConflict();
        await this.initServices();
        this.startHttpServer();

        // WhatsApp: connect if authenticated, skip otherwise
        const waAuthExists = existsSync(path.join(config.whatsapp.authDir, 'creds.json'));
        if (waAuthExists) {
            printPending('WhatsApp', 'connecting...');
        } else {
            printStatus('WhatsApp', 'skipped (run pnpm auth to enable)');
        }

        printReady(`http://localhost:${this.port}`);

        if (waAuthExists) {
            await this.connectWhatsApp();
        }
    }

    private async resolvePortConflict() {
        if (!(await isPortInUse(this.port))) return;

        const pid = findPidOnPort(this.port);
        logger.warn(`Port ${this.port} is already in use.`, 'Gateway');

        if (pid) {
            logger.info(`Process ID: ${pid}`, 'Gateway');

            // When running headlessly (e.g. spawned by the desktop app),
            // auto-kill the stale gateway instead of prompting via stdin.
            const isInteractive = process.stdin.isTTY === true;
            const shouldKill = isInteractive
                ? await askConfirm(`Kill existing process and restart? (y/n): `)
                : true;

            if (shouldKill) {
                if (!isInteractive) {
                    logger.info(`Non-interactive mode: auto-killing process ${pid}`, 'Gateway');
                }
                if (killProcess(pid)) {
                    logger.success(`Killed process ${pid}`, 'Gateway');
                    await new Promise(r => setTimeout(r, config.gateway.portKillDelayMs));
                } else {
                    logger.error(`Failed to kill process ${pid}. Try manually: kill -9 ${pid}`, 'Gateway');
                    process.exit(1);
                }
            } else {
                logger.info('Aborted.', 'Gateway');
                process.exit(0);
            }
        } else {
            logger.error(`Could not find the process using port ${this.port}.`, 'Gateway');
            process.exit(1);
        }
    }

    private async initServices() {
        await this.initMemory();
        await this.initSkills();
        this.initWhatsApp();
        this.createScheduler();
        await this.initBrainAndRunner();
        await this.startScheduler();
        await this.initBrowser();
        this.registerShutdownHooks();
    }

    private async initMemory() {
        const docsDir = path.join(config.mooseHome, 'docs');
        try { await this.memory.syncDocs(docsDir); } catch (err) {
            logger.error('Document sync failed', 'Gateway', err);
        }
        printStatus('Memory', config.memory.dbPath);
    }

    private async initSkills() {
        await this.skillRegistry.loadDefaults();
        await this.skillRegistry.loadExtensions(config.skills.customDir);

        const portableDir = config.skills.portableDir;
        const skillEntries = await loadSkillEntries(portableDir);
        this.skillsPrompt = buildSkillsPrompt(skillEntries);

        let yamlCount = 0;
        try {
            const files = await readdir(portableDir);
            yamlCount = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
        } catch { /* skills dir may not exist */ }

        printStatus('Skills', `${this.skillRegistry.getAll().length} built-in · ${yamlCount} portable`);
    }

    private initWhatsApp() {
        this.whatsapp = new WhatsAppManager();
    }

    private createScheduler() {
        const dataDir = path.join(config.mooseHome, 'data');
        this.scheduler = new TaskScheduler(dataDir, {
            pollInterval: config.scheduler.pollIntervalMs,
            onTaskRun: async (task) => {
                logger.info(`Running task: ${task.name}`, 'Scheduler');
                return await this.runner.run(task.prompt, { onDelta: () => { }, onToolCall: () => { } });
            }
        });
    }

    private async initBrainAndRunner() {
        const modelName = getModelName();

        this.brain = new LocalBrain({ memory: this.memory, registry: this.skillRegistry, skillsPrompt: this.skillsPrompt });
        this.runner = new AgentRunner(this.brain, this.memory, this.sandbox, this.skillRegistry, this.scheduler, this.whatsapp);
        await this.runner.init();

        const brainStatus = config.brain.provider === 'mistral'
            ? `${config.brain.provider} · ${modelName}`
            : `${config.brain.provider} · ${config.brain.llamaCpp.gpu} · ${modelName}`;

        printStatus('Brain', brainStatus);

        // Async warmup with status broadcast
        (async () => {
            try {
                this.broadcast({ type: 'brain.status', status: 'warming_up', message: 'Loading model into RAM...' });
                await this.brain.warmup();
                this.broadcast({ type: 'brain.status', status: 'ready', message: 'Brain is ready' });
            } catch (err) {
                logger.error('Warmup failed', 'Gateway', err);
                this.broadcast({ type: 'brain.status', status: 'error', message: String(err) });
            }
        })();
    }

    private broadcast(payload: Record<string, unknown>) {
        const msg = JSON.stringify(payload);
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg);
            }
        }
    }

    private async startScheduler() {
        await this.scheduler.init();
        this.scheduler.start();
        printStatus('Scheduler', `active · ${config.scheduler.pollIntervalMs / 1000}s poll`);
    }

    private async initBrowser() {
        try {
            await BrowserManager.ensureRunning();
            printStatus('Browser', 'daemon active');
        } catch (e) {
            logger.error('Failed to start Browser Daemon', 'Gateway', e);
        }
    }

    private registerShutdownHooks() {
        let isShuttingDown = false;
        const shutdown = async () => {
            if (isShuttingDown) return;
            isShuttingDown = true;

            logger.info('Shutting down Gateway...', 'Gateway');

            // Force exit after configured timeout if cleanup hangs
            const forceTimeout = setTimeout(() => {
                logger.warn(`Cleanup timed out after ${config.gateway.shutdownTimeoutMs}ms, forcing exit.`, 'Gateway');
                process.exit(1);
            }, config.gateway.shutdownTimeoutMs);

            try {
                await BrowserManager.cleanup();
                logger.success('Cleanup complete.', 'Gateway');
            } catch (err) {
                logger.warn(`Error during cleanup: ${getErrorMessage(err)}`, 'Gateway');
            } finally {
                clearTimeout(forceTimeout);
                process.exit(0);
            }
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }

    /** Connect WhatsApp and set up the message bridge. */
    private async connectWhatsApp() {
        setupWhatsAppBridge(
            this.whatsapp,
            (msg, history, save) => this._processAgentRequest(msg, history, save),
            this.whatsappSessions,
        );
        await this.whatsapp.init();
    }

    private startHttpServer() {
        const app = new Hono();
        app.get('/health', async (c) => c.json({ gateway: 'ok', brain: await this.brain.healthCheck() }));
        const server = serve({ fetch: app.fetch, port: this.port });
        server.on('upgrade', (req, socket, head) => {
            this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
        });
    }
}

if (import.meta.url.endsWith('server.ts')) {
    new LocalGateway().start();
}
