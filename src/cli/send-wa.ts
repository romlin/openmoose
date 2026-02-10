/**
 * CLI utility to send a WhatsApp message via the running gateway.
 * Usage: pnpm send-wa --name "Contact" --text "Hello"
 */

import { Command } from 'commander';
import { config } from '../config/index.js';
import { WebSocket } from 'ws';

/** Timeout for waiting on a gateway response (ms). */
const GATEWAY_RESPONSE_TIMEOUT_MS = 5_000;

const program = new Command();

interface WaSendResult {
    type: string;
    success: boolean;
    message?: string;
    error?: string;
}

program
    .name('send-wa')
    .description('Send a WhatsApp message via the running Gateway')
    .requiredOption('--name <string>', 'Contact name')
    .requiredOption('--text <string>', 'Message text')
    .option('--port <number>', 'Gateway port', config.gateway.port.toString())
    .action(async (options) => {
        const ws = new WebSocket(`ws://localhost:${options.port}`);

        ws.on('open', () => {
            ws.send(JSON.stringify({
                type: 'whatsapp.send',
                name: options.name,
                text: options.text
            }));
        });

        ws.on('message', (data) => {
            try {
                const resp = JSON.parse(data.toString()) as WaSendResult;
                if (resp.type === 'whatsapp.send.result') {
                    if (resp.success) {
                        console.log(`  ${resp.message}`);
                        process.exit(0);
                    } else {
                        console.error(`  Error: ${resp.error}`);
                        process.exit(1);
                    }
                }
            } catch {
                console.error('  Failed to parse gateway response');
                process.exit(1);
            }
        });

        ws.on('error', () => {
            console.error('  Failed to connect to Gateway. Is it running?');
            process.exit(1);
        });

        setTimeout(() => {
            console.error('  Timeout waiting for Gateway response');
            process.exit(1);
        }, GATEWAY_RESPONSE_TIMEOUT_MS);
    });

program.parse();
