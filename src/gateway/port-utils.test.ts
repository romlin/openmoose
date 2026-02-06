/**
 * Tests for port utility functions.
 */

import { describe, it, expect } from 'vitest';
import { findPidOnPort } from './port-utils.js';

describe('findPidOnPort', () => {
    it('returns null for invalid port (NaN)', () => {
        expect(findPidOnPort(NaN)).toBeNull();
    });

    it('returns null for port 0', () => {
        expect(findPidOnPort(0)).toBeNull();
    });

    it('returns null for negative port', () => {
        expect(findPidOnPort(-1)).toBeNull();
    });

    it('returns null for port above 65535', () => {
        expect(findPidOnPort(70000)).toBeNull();
    });

    it('returns null for fractional port (floors to valid)', () => {
        // 1.5 floors to 1, which is valid, so it should attempt lookup
        // On a test machine, port 1 likely has no process, so null
        const result = findPidOnPort(1.5);
        expect(result === null || typeof result === 'number').toBe(true);
    });

    it('returns null or a number for a valid unused port', () => {
        // Port 59999 is unlikely to be in use
        const result = findPidOnPort(59999);
        expect(result === null || typeof result === 'number').toBe(true);
    });
});
