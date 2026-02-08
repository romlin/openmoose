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
import { config } from '../config/index.js';
import { BrowserManager } from '../runtime/browser/manager.js';

/** Maximum number of history messages kept per session. */
const MAX_HISTORY_LENGTH = 20;

/** Delay after killing a conflicting process before rebinding the port. */
const PORT_KILL_DELAY_MS = 500;

/** Polling interval for the task scheduler (ms). */
const SCHEDULER_POLL_MS = 60_000;

/** Zod schema for validating incoming WebSocket payloads. */
const WsPayloadSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('agent.run'), message: z.string(), audio: z.boolean().optional() }),
    z.object({ type: z.literal('whatsapp.send'), name: z.string(), text: z.string() }),
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
        ].slice(-MAX_HISTORY_LENGTH);

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
            const shouldKill = await askConfirm(`Kill existing process and restart? (y/n): `);

            if (shouldKill) {
                if (killProcess(pid)) {
                    logger.success(`Killed process ${pid}`, 'Gateway');
                    await new Promise(r => setTimeout(r, PORT_KILL_DELAY_MS));
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
        // Memory
        const docsDir = path.join(process.cwd(), 'docs');
        try { await this.memory.syncDocs(docsDir); } catch (err) {
            logger.error('Document sync failed', 'Gateway', err);
        }
        printStatus('Memory', config.memory.dbPath);

        // Skills
        this.skillRegistry.loadDefaults();
        const customSkillsDir = new URL('../skills/custom', import.meta.url).pathname;
        await this.skillRegistry.loadExtensions(customSkillsDir);

        const skillsDir = path.join(process.cwd(), 'skills');
        const skillEntries = await loadSkillEntries(skillsDir);
        this.skillsPrompt = buildSkillsPrompt(skillEntries);

        // Count portable YAML skills
        let yamlCount = 0;
        try {
            const files = await readdir(skillsDir);
            yamlCount = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
        } catch { /* skills dir may not exist */ }

        const builtInCount = this.skillRegistry.getAll().length;
        printStatus('Skills', `${builtInCount} built-in · ${yamlCount} portable`);

        // WhatsApp (created here, connected later in connectWhatsApp)
        const dataDir = path.join(process.cwd(), '.moose/data');
        this.whatsapp = new WhatsAppManager();

        // Scheduler
        this.scheduler = new TaskScheduler(dataDir, {
            pollInterval: SCHEDULER_POLL_MS,
            onTaskRun: async (task) => {
                logger.info(`Running task: ${task.name}`, 'Scheduler');
                return await this.runner.run(task.prompt, { onDelta: () => { }, onToolCall: () => { } });
            }
        });

        // Brain + Runner
        const model = config.brain.provider === 'mistral' ? config.brain.mistral.model : config.brain.ollama.model;
        this.brain = new LocalBrain({ memory: this.memory, registry: this.skillRegistry, skillsPrompt: this.skillsPrompt });
        this.runner = new AgentRunner(this.brain, this.memory, this.sandbox, this.skillRegistry, this.scheduler, this.whatsapp);
        await this.runner.init();
        printStatus('Brain', `${config.brain.provider} · ${model}`);

        // Scheduler start
        await this.scheduler.init();
        this.scheduler.start();
        printStatus('Scheduler', `active · ${SCHEDULER_POLL_MS / 1000}s poll`);

        // Browser Daemon
        try {
            await BrowserManager.ensureRunning();
            printStatus('Browser', 'daemon active');
        } catch (e) {
            logger.error('Failed to start Browser Daemon', 'Gateway', e);
        }

        // Shutdown hooks
        const shutdown = async () => {
            logger.info('Shutting down Gateway...', 'Gateway');
            // Attempt clean shutdown but don't block exit on failure
            await BrowserManager.stop().catch(err => {
                logger.warn(`Error stopping browser: ${err.message}`, 'Gateway');
            });
            process.exit(0);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
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
