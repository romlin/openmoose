/**
 * WhatsApp bridge -- wires WhatsApp events to the agent runner,
 * handling message filtering, session management, and QR display.
 */

import { WhatsAppManager, WhatsAppMessage } from '../infra/whatsapp.js';
import { logger } from '../infra/logger.js';
import qrcode from 'qrcode-terminal';

/** Keyword prefix that triggers the agent in group chats. */
const GROUP_TRIGGER = 'moose';

type SessionStore = Map<string, { role: 'user' | 'assistant'; content: string }[]>;
type ProcessFn = (
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    saveHistory: (h: { role: 'user' | 'assistant'; content: string }[]) => void,
) => Promise<string>;

/**
 * Attach message, QR, and ready handlers to the WhatsApp manager.
 * Delegates agent processing to the provided callback.
 */
export function setupWhatsAppBridge(
    whatsapp: WhatsAppManager,
    processRequest: ProcessFn,
    sessions: SessionStore,
): void {
    whatsapp.on('message', async (msg: WhatsAppMessage) => {
        if (msg.fromMe) return;

        const text = msg.text.trim();
        const isDM = msg.jid.endsWith('@s.whatsapp.net');
        const startsWithTrigger = text.toLowerCase().startsWith(GROUP_TRIGGER);

        if (!isDM && !startsWithTrigger) return;

        const query = startsWithTrigger ? text.slice(GROUP_TRIGGER.length).trim() : text;
        if (!query) return;

        logger.info(`Message from ${msg.sender}: ${query}`, 'WhatsApp');

        try {
            const response = await processRequest(
                query,
                sessions.get(msg.jid) || [],
                (h) => sessions.set(msg.jid, h),
            );

            if (response) {
                await whatsapp.sendMessage(msg.jid, response);
            }
        } catch (error) {
            logger.error('Error processing WhatsApp message', 'WhatsApp', error);
            await whatsapp.sendMessage(msg.jid, 'Sorry, I encountered an error processing your request.');
        }
    });

    whatsapp.on('qr', (qr) => {
        logger.important('Scan this QR code to link your account:', 'WhatsApp');
        qrcode.generate(qr, { small: true });
    });

    whatsapp.on('ready', () => {
        logger.success('Agent is online and listening!', 'WhatsApp');
    });
}
