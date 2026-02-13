/**
 * Unified logging system for OpenMoose.
 * Provides colored, prefixed output with support for silent mode
 * and configurable log levels.
 */

import chalk from 'chalk';
import { config } from '../config/index.js';

/** Available log severity levels. */
export enum LogLevel {
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
    DEBUG = 'debug',
    SUCCESS = 'success',
}

/**
 * Unified Logger for OpenMoose.
 * Ensures consistent colors, prefixes, and respects the silence flag.
 */
export const logger = {
    info: (message: string, prefix: string = 'Gateway') => {
        if (config.logging.silent) return;
        console.log(`  ${chalk.yellow('i')} ${chalk.dim(`[${prefix}]`)} ${message}`);
    },

    success: (message: string, prefix: string = 'Gateway') => {
        if (config.logging.silent) return;
        console.log(`  ${chalk.green('+')} ${chalk.green(`[${prefix}]`)} ${chalk.bold(message)}`);
    },

    warn: (message: string, prefix: string = 'Gateway') => {
        if (config.logging.silent) return;
        console.warn(`  ${chalk.yellow('!')} ${chalk.yellow(`[${prefix}]`)} ${chalk.yellow(message)}`);
    },

    error: (message: string, prefix: string = 'Gateway', error?: unknown) => {
        console.error(`  ${chalk.red('x')} ${chalk.red(`[${prefix}]`)} ${chalk.red.bold(message)}`);
        if (error) {
            const errObj = error as { stack?: string };
            console.error(chalk.red(errObj.stack || String(error)));
        }
    },

    debug: (message: string, prefix: string = 'Debug') => {
        if (config.logging.silent || config.logging.level !== 'debug') return;
        console.log(`  ${chalk.magenta('.')} ${chalk.magenta(`[${prefix}]`)} ${chalk.gray(message)}`);
    },

    important: (message: string, prefix: string = 'System') => {
        if (config.logging.silent) return;
        console.log(`  ${chalk.bold.cyan('*')} ${chalk.bold.cyan(`[${prefix}]`)} ${chalk.bold(message)}`);
    }
};
