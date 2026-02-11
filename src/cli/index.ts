/**
 * OpenMoose CLI -- provides `chat` (one-shot) and `talk` (interactive)
 * commands that communicate with the gateway over WebSocket.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../config/index.js';
import { getErrorMessage } from '../infra/errors.js';
import { MooseClient } from './client.js';

const program = new Command();

program
    .name('openmoose')
    .description('OpenMoose: The local-first AI assistant.')
    .version(config.version);

program
    .command('chat')
    .description('Chat with the local assistant')
    .argument('<message>', 'Message to send')
    .option('-p, --port <number>', 'Gateway port', config.gateway.port.toString())
    .option('-v, --voice', 'Enable voice output', false)
    .action(async (message, options) => {
        const client = new MooseClient(options.port);
        try {
            await client.connect();
            await client.run(message, options.voice);
        } catch (err) {
            console.error(`  ${chalk.red('Failed to connect to Gateway:')}`, getErrorMessage(err));
            process.exit(1);
        }
    });

program
    .command('talk')
    .description('Interactive text chat with optional voice output')
    .option('-p, --port <number>', 'Gateway port', config.gateway.port.toString())
    .option('-v, --voice', 'Enable voice output', false)
    .action(async (options) => {
        const client = new MooseClient(options.port);
        try {
            await client.connect();
            await client.startInteractive(options.voice);

            process.on('SIGINT', () => {
                client.close();
                process.exit();
            });
        } catch (err) {
            console.error(`  ${chalk.red('Gateway Connection Error:')}`, getErrorMessage(err));
            process.exit(1);
        }
    });

program
    .command('gateway')
    .description('Start the gateway server')
    .option('-p, --port <number>', 'Port to run on', config.gateway.port.toString())
    .action(async (options) => {
        const { LocalGateway } = await import('../gateway/server.js');
        const gateway = new LocalGateway(parseInt(options.port));
        await gateway.start();
    });

program.parse();
