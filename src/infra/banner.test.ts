import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printBanner, printStatus, printPending, printReady, printHint } from './banner.js';

describe('banner', () => {
    let logs: string[];

    beforeEach(() => {
        logs = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            logs.push(args.map(String).join(' '));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('printBanner outputs a box with the title', () => {
        printBanner();
        const output = logs.join('\n');
        expect(output).toContain('O P E N M O O S E');
        expect(output).toContain('╭');
        expect(output).toContain('╰');
    });

    it('printBanner includes subtitle when provided', () => {
        printBanner('Talk Mode');
        const output = logs.join('\n');
        expect(output).toContain('Talk Mode');
        expect(output).toContain('O P E N M O O S E');
    });

    it('printBanner includes version', () => {
        printBanner();
        const output = logs.join('\n');
        expect(output).toMatch(/v\d+\.\d+\.\d+/);
    });

    it('printStatus outputs label and detail', () => {
        printStatus('Brain', 'node-llama-cpp · ministral');
        expect(logs.length).toBe(1);
        expect(logs[0]).toContain('Brain');
        expect(logs[0]).toContain('node-llama-cpp');
    });

    it('printPending outputs label and detail', () => {
        printPending('WhatsApp', 'connecting');
        expect(logs.length).toBe(1);
        expect(logs[0]).toContain('WhatsApp');
        expect(logs[0]).toContain('connecting');
    });

    it('printReady outputs the URL', () => {
        printReady('http://localhost:18789');
        const output = logs.join('\n');
        expect(output).toContain('http://localhost:18789');
        expect(output).toContain('Ready at');
    });

    it('printHint outputs dim text', () => {
        printHint('Type a message');
        expect(logs.length).toBe(1);
        expect(logs[0]).toContain('Type a message');
    });
});
