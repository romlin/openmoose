/**
 * Tests for WhatsApp bridge -- event wiring between WhatsApp and the agent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { setupWhatsAppBridge } from './whatsapp-bridge.js';

vi.mock('../infra/logger.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn(), important: vi.fn() },
}));

vi.mock('qrcode-terminal', () => ({
    default: { generate: vi.fn() },
}));

class MockWhatsApp extends EventEmitter {
    sendMessage = vi.fn().mockResolvedValue(undefined);
}

describe('setupWhatsAppBridge', () => {
    let wa: MockWhatsApp;
    let processFn: ReturnType<typeof vi.fn>;
    let sessions: Map<string, { role: 'user' | 'assistant'; content: string }[]>;

    beforeEach(() => {
        wa = new MockWhatsApp();
        processFn = vi.fn().mockResolvedValue({ text: 'Agent response', source: 'brain' });
        sessions = new Map();
        setupWhatsAppBridge(wa as never, processFn, sessions);
    });

    it('processes a direct message', async () => {
        wa.emit('message', {
            jid: '123@s.whatsapp.net',
            sender: 'Alice',
            text: 'Hello agent',
            timestamp: Date.now(),
            fromMe: false,
        });

        // Allow async handler to complete
        await new Promise(r => setTimeout(r, 50));

        expect(processFn).toHaveBeenCalledWith(
            'Hello agent',
            [],
            expect.any(Function),
        );
        expect(wa.sendMessage).toHaveBeenCalledWith('123@s.whatsapp.net', 'Agent response');
    });

    it('ignores messages from self', async () => {
        wa.emit('message', {
            jid: '123@s.whatsapp.net',
            sender: 'Me',
            text: 'My own message',
            timestamp: Date.now(),
            fromMe: true,
        });

        await new Promise(r => setTimeout(r, 50));
        expect(processFn).not.toHaveBeenCalled();
    });

    it('ignores group messages without trigger word', async () => {
        wa.emit('message', {
            jid: '123@g.us', // group chat
            sender: 'Alice',
            text: 'Random chat',
            timestamp: Date.now(),
            fromMe: false,
        });

        await new Promise(r => setTimeout(r, 50));
        expect(processFn).not.toHaveBeenCalled();
    });

    it('processes group messages starting with "moose"', async () => {
        wa.emit('message', {
            jid: '123@g.us',
            sender: 'Alice',
            text: 'moose what is the weather',
            timestamp: Date.now(),
            fromMe: false,
        });

        await new Promise(r => setTimeout(r, 50));
        expect(processFn).toHaveBeenCalledWith(
            'what is the weather',
            [],
            expect.any(Function),
        );
    });

    it('emits ready event without error', () => {
        expect(() => wa.emit('ready')).not.toThrow();
    });
});
