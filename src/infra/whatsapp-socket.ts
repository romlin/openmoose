import { UserFacingSocketConfig, AuthenticationState } from '@whiskeysockets/baileys';
import pino from 'pino';

/**
 * Centralized WhatsApp Socket Configuration
 * Ensures consistency between the gateway and CLI auth tool.
 */
export const getWASocketConfig = (authState: AuthenticationState, logger: pino.Logger): UserFacingSocketConfig => {
    return {
        auth: {
            creds: authState.creds,
            keys: authState.keys,
        },
        printQRInTerminal: false,
        logger: logger.child({}, { level: 'silent' }), // Force child logger to be silent too
        browser: ['OpenMoose', 'Chrome', '1.0.0'] as [string, string, string],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
    };
};
