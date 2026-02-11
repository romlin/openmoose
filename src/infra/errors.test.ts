import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errors.js';

describe('getErrorMessage', () => {
    it('extracts message from an Error instance', () => {
        expect(getErrorMessage(new Error('something broke'))).toBe('something broke');
    });

    it('falls back to String() for non-Error values', () => {
        expect(getErrorMessage('raw string')).toBe('raw string');
        expect(getErrorMessage(42)).toBe('42');
        expect(getErrorMessage(null)).toBe('null');
    });
});
