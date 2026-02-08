/**
 * Startup banner and formatted console helpers for OpenMoose CLI.
 * Provides a consistent, polished look across all entry points.
 */

import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Box inner width for the banner frame. */
const BOX_WIDTH = 42;

/** Read version from package.json (sync, runs once at startup). */
function getVersion(): string {
    try {
        const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf-8');
        const pkg = JSON.parse(raw) as { version?: string };
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/** Center a string within the box width. */
function center(text: string): string {
    const left = Math.max(0, Math.floor((BOX_WIDTH - text.length) / 2));
    const right = Math.max(0, BOX_WIDTH - left - text.length);
    return ' '.repeat(left) + text + ' '.repeat(right);
}

/**
 * Print the OpenMoose startup banner.
 * @param subtitle Optional second line (e.g. "Talk Mode", "WhatsApp Setup")
 */
export function printBanner(subtitle?: string): void {
    const version = `v${getVersion()}`;
    const title = 'O P E N M O O S E';
    const bar = '─'.repeat(BOX_WIDTH);

    console.log('');
    console.log(chalk.cyan(`  ╭${bar}╮`));
    console.log(chalk.cyan('  │') + chalk.bold.white(center(title)) + chalk.cyan('│'));
    if (subtitle) {
        console.log(chalk.cyan('  │') + chalk.dim(center(subtitle)) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('  │') + chalk.dim(center(version)) + chalk.cyan('│'));
    console.log(chalk.cyan(`  ╰${bar}╯`));
    console.log('');
}

/** Print a service status line (e.g. "  ✓ Brain         node-llama-cpp · model"). */
export function printStatus(label: string, detail: string): void {
    console.log(`  ${chalk.green('✓')} ${chalk.bold(label.padEnd(14))}${chalk.dim(detail)}`);
}

/** Print a status line for a pending/async service. */
export function printPending(label: string, detail: string): void {
    console.log(`  ${chalk.yellow('○')} ${chalk.bold(label.padEnd(14))}${chalk.dim(detail)}`);
}

/** Print the final "ready" URL line. */
export function printReady(url: string): void {
    console.log('');
    console.log(`  ${chalk.green('→')} ${chalk.bold('Ready at')} ${chalk.cyan.underline(url)}`);
    console.log('');
}

/** Print a hint/instruction line. */
export function printHint(text: string): void {
    console.log(chalk.dim(`  ${text}`));
}
