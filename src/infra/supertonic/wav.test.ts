/**
 * Tests for createWavBuffer -- WAV file generation from raw audio samples.
 */

import { describe, it, expect } from 'vitest';
import { createWavBuffer } from './index.js';

describe('createWavBuffer', () => {
    it('creates a valid WAV header', () => {
        const buffer = createWavBuffer([0, 0, 0, 0], 22050);

        expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
        expect(buffer.toString('ascii', 8, 12)).toBe('WAVE');
        expect(buffer.toString('ascii', 12, 16)).toBe('fmt ');
        expect(buffer.toString('ascii', 36, 40)).toBe('data');
    });

    it('sets correct sample rate', () => {
        const buffer = createWavBuffer([0], 44100);
        expect(buffer.readUInt32LE(24)).toBe(44100);
    });

    it('sets mono channel (1)', () => {
        const buffer = createWavBuffer([0], 22050);
        expect(buffer.readUInt16LE(22)).toBe(1);
    });

    it('sets 16-bit samples', () => {
        const buffer = createWavBuffer([0], 22050);
        expect(buffer.readUInt16LE(34)).toBe(16);
    });

    it('has correct total size (44 header + 2 bytes per sample)', () => {
        const samples = [0, 0.5, -0.5, 1.0];
        const buffer = createWavBuffer(samples, 22050);
        expect(buffer.length).toBe(44 + samples.length * 2);
    });

    it('encodes silence as zero samples', () => {
        const buffer = createWavBuffer([0, 0], 22050);
        expect(buffer.readInt16LE(44)).toBe(0);
        expect(buffer.readInt16LE(46)).toBe(0);
    });

    it('clamps samples to [-1, 1] range', () => {
        const buffer = createWavBuffer([2.0, -2.0], 22050);
        const sample1 = buffer.readInt16LE(44);
        const sample2 = buffer.readInt16LE(46);
        // Max positive = 32767, max negative = -32767
        expect(sample1).toBe(32767);
        expect(sample2).toBe(-32767);
    });

    it('handles empty audio data', () => {
        const buffer = createWavBuffer([], 22050);
        expect(buffer.length).toBe(44); // header only
    });
});
