/**
 * WhatsApp integration using the Baileys library.
 * Handles authentication, contact management, and message routing
 * through an EventEmitter-based interface.
 */

import { EventEmitter } from 'node:events';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import {
    DisconnectReason,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    makeWASocket,
    type WASocket,
    type AuthenticationState
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import ora from 'ora';
import { config } from '../config/index.js';
import { getWASocketConfig } from './whatsapp-socket.js';

/** Normalized representation of an incoming WhatsApp message. */
export interface WhatsAppMessage {
    jid: string;
    sender: string;
    text: string;
    timestamp: number;
    fromMe: boolean;
}

/**
 * Manages the WhatsApp connection lifecycle, authentication, contact
 * auto-learning, and message send/receive. Emits `message`, `qr`,
 * `ready`, and `logout` events.
 */
export class WhatsAppManager extends EventEmitter {
    private sock: WASocket | null = null;
    private authState: AuthenticationState | null = null;
    private saveCreds: (() => Promise<void>) | null = null;
    private authDir: string;
    private logger: pino.Logger;
    private spinner = ora({ text: 'Connecting to WhatsApp...', color: 'cyan' });
    private contacts: Record<string, string> = {}; // Name -> JID

    constructor() {
        super();
        this.authDir = config.whatsapp.authDir;
        this.logger = pino({ level: 'silent' });

        // SILENCE: libsignal-node's hardcoded console logs
        const originalInfo = console.info;
        console.info = (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].includes('Closing session:')) return;
            originalInfo(...args);
        };
    }

    /** Initialize authentication state, load contacts, and connect. */
    async init() {
        if (!existsSync(this.authDir)) {
            await mkdir(this.authDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        this.authState = state;
        this.saveCreds = saveCreds;

        // Load existing contacts
        await this.loadContacts();

        this.connect();
    }

    private async loadContacts() {
        logger.debug(`Loading contacts from ${config.whatsapp.contactsPath}...`, 'WhatsApp');
        try {
            if (existsSync(config.whatsapp.contactsPath)) {
                const data = await readFile(config.whatsapp.contactsPath, 'utf8');
                this.contacts = JSON.parse(data);
                logger.debug(`Loaded ${Object.keys(this.contacts).length} contacts from disk.`, 'WhatsApp');
            } else {
                logger.debug('Contacts file not found, starting fresh.', 'WhatsApp');
            }
        } catch (err) {
            logger.error('Failed to load contacts', 'WhatsApp', err);
        }
    }

    private async saveContacts() {
        try {
            const count = Object.keys(this.contacts).length;
            logger.debug(`Saving ${count} contacts to disk...`, 'WhatsApp');
            await writeFile(config.whatsapp.contactsPath, JSON.stringify(this.contacts, null, 2));
            logger.debug('Contacts saved successfully.', 'WhatsApp');
        } catch (err) {
            logger.error('Failed to save contacts', 'WhatsApp', err);
        }
    }



    private connect() {
        this.spinner.start();

        const authState = {
            creds: this.authState!.creds,
            keys: makeCacheableSignalKeyStore(this.authState!.keys, this.logger)
        };

        this.sock = makeWASocket(getWASocketConfig(authState, this.logger));

        this.sock.ev.on('creds.update', async () => {
            if (this.saveCreds) await this.saveCreds();
        });

        // Track contacts from all event sources
        this.sock.ev.on('contacts.upsert', (contacts) => this.mergeContacts(contacts, 'upsert'));
        this.sock.ev.on('contacts.update', (updates) => this.mergeContacts(updates, 'update'));
        this.sock.ev.on('messaging-history.set', ({ contacts }) => this.mergeContacts(contacts, 'history'));

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.spinner.stop();
                logger.important('Authentication required! Please run: pnpm auth', 'WhatsApp');
                this.emit('qr', qr);
                this.spinner.start('Waiting for scan...');
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    logger.warn('WhatsApp connection closed, reconnecting...', 'WhatsApp');
                    this.spinner.text = 'Reconnecting...';
                    setTimeout(() => this.connect(), config.whatsapp.reconnectDelayMs);
                } else {
                    this.spinner.fail('Session expired or Logged out.');
                    logger.important('WhatsApp authentication required! Please run: pnpm auth', 'WhatsApp');
                    logger.info('To fix: Run `pnpm auth` to re-link your account.', 'WhatsApp');
                    this.emit('logout');
                }
            } else if (connection === 'open') {
                this.spinner.succeed('WhatsApp connected');
                logger.debug('WhatsApp connected and ready', 'WhatsApp');

                // Fetch all contacts on startup to populate our file
                logger.debug(`Requesting status fetch...`, 'WhatsApp');
                try {
                    const dataDir = path.dirname(config.whatsapp.contactsPath);
                    if (!existsSync(dataDir)) {
                        await mkdir(dataDir, { recursive: true });
                    }
                    await this.sock!.fetchStatus('all');
                } catch (err) {
                    logger.debug(`fetchStatus failed: ${err}`, 'WhatsApp');
                }

                await this.saveContacts();

                this.emit('ready');
            }
        });

        this.sock.ev.on('messages.upsert', (m) => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

                    const text = msg.message.conversation ||
                        msg.message.extendedTextMessage?.text ||
                        '';

                    if (!text) continue;

                    const name = msg.pushName || 'Unknown';
                    const message: WhatsAppMessage = {
                        jid: msg.key.remoteJid!,
                        sender: name,
                        text: text,
                        timestamp: Number(msg.messageTimestamp),
                        fromMe: msg.key.fromMe || false,
                    };

                    // Auto-learn contact from message
                    if (name !== 'Unknown' && !msg.key.fromMe) {
                        if (this.contacts[name] !== msg.key.remoteJid) {
                            this.contacts[name] = msg.key.remoteJid!;
                            this.saveContacts(); // Fire and forget
                        }
                    }


                    this.emit('message', message);
                }
            }
        });
    }

    /** Merge a batch of contacts into the local map and persist if changed. */
    private async mergeContacts(contacts: Array<{ id?: string | null; name?: string | null; notify?: string | null; verifiedName?: string | null }>, source: string) {
        logger.debug(`Processing ${contacts.length} contacts from ${source}`, 'WhatsApp');
        let changed = false;
        for (const c of contacts) {
            const name = c.name || c.notify || c.verifiedName;
            if (name && c.id && this.contacts[name] !== c.id) {
                this.contacts[name] = c.id;
                changed = true;
            }
        }
        if (changed) await this.saveContacts();
    }

    /** Send a text message to a WhatsApp JID. */
    async sendMessage(jid: string, text: string) {
        if (!this.sock) throw new Error('WhatsApp not connected');
        await this.sock.sendMessage(jid, { text });
    }

    /** Gracefully log out and disconnect. */
    async logout() {
        if (this.sock) {
            await this.sock.logout();
            this.sock = null;
        }
    }

    /** Remove stored authentication credentials from disk. */
    async clearAuth() {
        if (existsSync(this.authDir)) {
            await rm(this.authDir, { recursive: true, force: true });
        }
    }
}
