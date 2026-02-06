/**
 * Contact lookup service -- resolves WhatsApp JIDs from contact names
 * stored in the local contacts JSON file.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * ContactsManager - Centralizes contact lookup logic
 */
export class ContactsManager {
    /**
     * Look up a WhatsApp JID by contact name
     */
    static async lookup(name: string): Promise<{ name: string; jid: string } | null> {
        if (!existsSync(config.whatsapp.contactsPath)) {
            return null;
        }

        try {
            const data = await readFile(config.whatsapp.contactsPath, 'utf-8');
            const contacts = JSON.parse(data) as Record<string, string>;

            const key = Object.keys(contacts).find(
                k => k.toLowerCase() === name.toLowerCase()
            );

            if (key) {
                return { name: key, jid: contacts[key] };
            }
        } catch (error) {
            logger.error('Failed to parse contacts file', 'Contacts', error);
        }

        return null;
    }

    /**
     * Get all contact names
     */
    static async getAllNames(): Promise<string[]> {
        if (!existsSync(config.whatsapp.contactsPath)) {
            return [];
        }

        try {
            const data = await readFile(config.whatsapp.contactsPath, 'utf-8');
            const contacts = JSON.parse(data) as Record<string, string>;
            return Object.keys(contacts);
        } catch {
            return [];
        }
    }
}
