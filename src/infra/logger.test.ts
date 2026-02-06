/**
 * Tests for the unified logger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test logger behavior, so we spy on console methods
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
});

// Import after spying
import { logger } from './logger.js';

describe('logger', () => {
    it('info calls console.log', () => {
        logger.info('test message', 'TestPrefix');
        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0] as string;
        expect(output).toContain('TestPrefix');
        expect(output).toContain('test message');
    });

    it('success calls console.log', () => {
        logger.success('done!', 'Test');
        expect(logSpy).toHaveBeenCalled();
    });

    it('warn calls console.warn', () => {
        logger.warn('careful', 'Test');
        expect(warnSpy).toHaveBeenCalled();
    });

    it('error calls console.error', () => {
        logger.error('bad thing', 'Test');
        expect(errorSpy).toHaveBeenCalled();
    });

    it('error includes stack trace when error object provided', () => {
        const err = new Error('boom');
        logger.error('failed', 'Test', err);
        expect(errorSpy).toHaveBeenCalledTimes(2); // message + stack
    });

    it('important calls console.log', () => {
        logger.important('notice', 'System');
        expect(logSpy).toHaveBeenCalled();
    });
});
