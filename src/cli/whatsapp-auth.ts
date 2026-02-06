/**
 * WhatsApp Authentication CLI -- links your WhatsApp account via QR code.
 * Clears expired sessions and uses WhatsAppManager's built-in spinner.
 */

import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import { WhatsAppManager } from '../infra/whatsapp.js';
import { printBanner, printHint } from '../infra/banner.js';

async function authenticate() {
    printBanner('WhatsApp Setup');

    const manager = new WhatsAppManager();

    // Clear any expired session so we get a fresh QR code
    await manager.clearAuth();

    manager.on('qr', (qr) => {
        console.log(chalk.bold('  Scan this QR code with WhatsApp:\n'));
        printHint('1. Open WhatsApp → Settings → Linked Devices');
        printHint('2. Tap "Link a Device"');
        console.log('');
        qrcode.generate(qr, { small: true });
    });

    manager.on('ready', () => {
        console.log('');
        printHint('You can now start the gateway with: pnpm gateway');
        console.log('');
        setTimeout(() => process.exit(0), 500);
    });

    manager.on('logout', () => {
        console.log('');
        printHint('Session expired. Run pnpm auth again.');
        process.exit(1);
    });

    // Force exit on Ctrl+C -- ora/Baileys intercept SIGINT, so catch it raw
    process.on('SIGINT', () => process.exit(0));
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', (key) => {
            // 0x03 = Ctrl+C
            if (key[0] === 0x03) process.exit(0);
        });
    }

    await manager.init();
}

authenticate().catch((err) => {
    console.error(chalk.red('Authentication failed:'), err);
    process.exit(1);
});
