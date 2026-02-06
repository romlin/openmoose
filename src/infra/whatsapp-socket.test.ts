/**
 * Tests for WhatsApp socket configuration factory.
 */

import { describe, it, expect } from 'vitest';
import { getWASocketConfig } from './whatsapp-socket.js';
import pino from 'pino';

const mockAuthState = {
    creds: {} as never,
    keys: {} as never,
};

const mockLogger = pino({ level: 'silent' });

describe('getWASocketConfig', () => {
    it('returns a config object with auth credentials', () => {
        const config = getWASocketConfig(mockAuthState, mockLogger);
        expect(config.auth).toBeDefined();
        expect(config.auth.creds).toBe(mockAuthState.creds);
        expect(config.auth.keys).toBe(mockAuthState.keys);
    });

    it('disables QR printing in terminal', () => {
        const config = getWASocketConfig(mockAuthState, mockLogger);
        expect(config.printQRInTerminal).toBe(false);
    });

    it('sets browser identity as OpenMoose', () => {
        const config = getWASocketConfig(mockAuthState, mockLogger);
        expect(config.browser).toEqual(['OpenMoose', 'Chrome', '1.0.0']);
    });

    it('has timeout values set', () => {
        const config = getWASocketConfig(mockAuthState, mockLogger);
        expect(config.connectTimeoutMs).toBeGreaterThan(0);
        expect(config.defaultQueryTimeoutMs).toBeGreaterThan(0);
        expect(config.keepAliveIntervalMs).toBeGreaterThan(0);
    });
});
