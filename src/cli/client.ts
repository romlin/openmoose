/**
 * MooseClient -- handles WebSocket communication with the OpenMoose Gateway,
 * including message rendering, audio playback, and interactive mode.
 */

import { WebSocket, RawData } from 'ws';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createInterface, Interface } from 'node:readline';
import { config } from '../config/index.js';
import { printBanner, printStatus, printHint } from '../infra/banner.js';

interface GatewayMessage {
    type: 'agent.run' | 'agent.delta' | 'agent.audio' | 'agent.tool_call' | 'agent.tool_result' | 'agent.final' | 'error';
    text?: string;
    message?: string;
    audio?: string;
    name?: string;
    args?: Record<string, unknown>;
    success?: boolean;
    error?: string;
}

export class MooseClient {
    private ws: WebSocket;
    private responseStarted = false;
    private currentAudioProcess: import('node:child_process').ChildProcess | null = null;
    private rl: Interface | null = null;

    /** Max length for the tool argument summary line. */
    private static readonly ARG_SUMMARY_MAX = 60;

    /** Prompt string shown before user input. */
    private static readonly PROMPT = '  ' + chalk.bold.green('you') + chalk.dim(' › ');

    /** Prefix shown before assistant responses. */
    private static readonly RESPONSE_PREFIX = '\n  ' + chalk.bold.cyan('moose') + chalk.dim(' › ');

    private port: string;

    constructor(port: string) {
        this.port = port;
        this.ws = new WebSocket(`ws://localhost:${port}`);
    }

    async connect(): Promise<void> {
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            try {
                await new Promise<void>((resolve, reject) => {
                    this.ws.on('open', () => resolve());
                    this.ws.on('error', (err) => reject(err));
                    this.ws.on('message', (data) => this.handleMessage(data));
                });
                return;
            } catch (err) {
                attempts++;
                if (attempts >= maxAttempts) throw err;

                printStatus('Gateway', chalk.yellow(`not ready, retrying... (${attempts}/${maxAttempts})`));

                this.ws.removeAllListeners();
                this.ws.terminate();
                this.ws = new WebSocket(`ws://localhost:${this.port}`);

                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    async run(message: string, voice = false) {
        this.ws.send(JSON.stringify({ type: 'agent.run', message, audio: voice }));

        this.ws.on('message', (data) => {
            try {
                const payload = JSON.parse(data.toString()) as GatewayMessage;
                if (payload.type === 'agent.final') {
                    setTimeout(() => {
                        this.close();
                        process.exit(0);
                    }, 1000);
                }
            } catch {
                // Ignore non-JSON messages
            }
        });
    }

    async startInteractive(voice = false) {
        const model = config.brain.provider === 'mistral'
            ? config.brain.mistral.model
            : basename(config.brain.llamaCpp.modelPath);

        printBanner('Talk Mode');
        printStatus('Brain', `${config.brain.provider} · ${model}`);
        printStatus('Voice', voice ? 'on' : 'off');
        console.log('');
        printHint('Type a message to start. Ctrl+C to exit.');
        console.log('');

        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: MooseClient.PROMPT,
        });

        this.rl.prompt();

        this.rl.on('line', (line) => {
            this.stopAudio();

            if (!line.trim()) {
                this.rl?.prompt();
                return;
            }
            this.ws.send(JSON.stringify({ type: 'agent.run', message: line, audio: voice }));
        });
    }

    /** Extract a short human-readable summary from tool args. */
    private static summarizeArgs(_tool: string, args?: Record<string, unknown>): string {
        if (!args) return '';
        const raw =
            (args.command as string) ||
            (args.code as string) ||
            (args.query as string) ||
            (args.url as string) ||
            (args.path as string) ||
            (args.text as string) ||
            '';
        if (!raw) return '';
        const oneLine = raw.replace(/\n/g, ' ').trim();
        if (oneLine.length <= MooseClient.ARG_SUMMARY_MAX) return oneLine;
        return oneLine.slice(0, MooseClient.ARG_SUMMARY_MAX - 1) + '\u2026';
    }

    private stopAudio() {
        if (this.currentAudioProcess) {
            try {
                this.currentAudioProcess.kill('SIGKILL');
            } catch (err) {
                // Process may have already exited
                void err;
            }
            this.currentAudioProcess = null;
        }
    }

    private handleMessage(data: RawData) {
        let payload: GatewayMessage;
        try {
            payload = JSON.parse(data.toString());
        } catch {
            return; // Ignore non-JSON messages
        }

        switch (payload.type) {
            case 'agent.delta':
                if (!this.responseStarted) {
                    process.stdout.write(MooseClient.RESPONSE_PREFIX);
                    this.responseStarted = true;
                }
                process.stdout.write(payload.text || '');
                break;

            case 'agent.audio':
                if (payload.audio) {
                    this.responseStarted = true;
                    this.playAudio(payload.audio);
                }
                break;

            case 'agent.tool_call': {
                const toolName = payload.name || 'unknown';
                const summary = MooseClient.summarizeArgs(toolName, payload.args);
                this.responseStarted = false;
                process.stdout.write('\n');
                process.stdout.write(
                    '  ' + chalk.bgYellow.black.bold(` ${toolName} `) +
                    (summary ? ' ' + chalk.dim(summary) : '') +
                    '\n'
                );
                break;
            }

            case 'agent.tool_result':
                if (payload.success !== true && payload.error) {
                    process.stdout.write(chalk.dim('  ↳ ') + chalk.red('failed: ' + payload.error) + '\n');
                }
                break;

            case 'agent.final':
                process.stdout.write('\n\n');
                this.responseStarted = false;
                this.rl?.prompt();
                break;

            case 'error':
                console.error(chalk.red('\n  Error:'), payload.message);
                this.responseStarted = false;
                this.rl?.prompt();
                break;
        }
    }

    private playAudio(base64Audio: string) {
        this.stopAudio();

        const buffer = Buffer.from(base64Audio, 'base64');
        const tempFile = join(tmpdir(), `moose_voice_${Date.now()}.wav`);
        writeFileSync(tempFile, buffer);

        const player = process.platform === 'darwin' ? 'afplay' : 'aplay';
        this.currentAudioProcess = spawn(player, [tempFile]);

        this.currentAudioProcess.on('close', () => {
            this.currentAudioProcess = null;
            try {
                unlinkSync(tempFile);
            } catch (err) {
                // File may have already been cleaned up
                void err;
            }
        });
    }

    close() {
        this.ws.close();
        this.rl?.close();
    }
}
