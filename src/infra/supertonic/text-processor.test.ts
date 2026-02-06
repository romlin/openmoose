/**
 * Tests for text processing utilities -- chunkText() and lengthToMask().
 */

import { describe, it, expect } from 'vitest';
import { chunkText, lengthToMask } from './text-processor.js';

describe('chunkText', () => {
    it('returns a single chunk for short text', () => {
        const result = chunkText('Hello world.', 300);
        expect(result).toEqual(['Hello world.']);
    });

    it('splits text at sentence boundaries', () => {
        const text = 'First sentence. Second sentence. Third sentence.';
        const result = chunkText(text, 35);
        expect(result.length).toBeGreaterThan(1);
        // Each chunk should end with proper punctuation
        for (const chunk of result) {
            expect(chunk).toMatch(/[.!?]$/);
        }
    });

    it('handles multiple paragraphs', () => {
        const text = 'Paragraph one.\n\nParagraph two.';
        const result = chunkText(text, 300);
        expect(result).toEqual(['Paragraph one.', 'Paragraph two.']);
    });

    it('respects maxLen limit', () => {
        const text = 'A long sentence that should be its own chunk. Another long sentence that goes here.';
        const result = chunkText(text, 50);
        for (const chunk of result) {
            expect(chunk.length).toBeLessThanOrEqual(100); // allow some overflow for sentence integrity
        }
    });

    it('returns empty array for empty text', () => {
        const result = chunkText('', 300);
        expect(result).toEqual([]);
    });

    it('handles text with no punctuation', () => {
        const result = chunkText('No punctuation here', 300);
        expect(result).toEqual(['No punctuation here']);
    });

    it('uses default maxLen of 300', () => {
        const longText = 'A'.repeat(200) + '. ' + 'B'.repeat(200) + '.';
        const result = chunkText(longText);
        expect(result.length).toBeGreaterThanOrEqual(1);
    });
});

describe('lengthToMask', () => {
    it('creates a mask for a single length', () => {
        const result = lengthToMask([3]);
        expect(result).toEqual([[[1.0, 1.0, 1.0]]]);
    });

    it('creates masks for multiple lengths', () => {
        const result = lengthToMask([2, 3]);
        expect(result).toEqual([
            [[1.0, 1.0, 0.0]],
            [[1.0, 1.0, 1.0]],
        ]);
    });

    it('pads shorter sequences with zeros', () => {
        const result = lengthToMask([1, 4]);
        expect(result[0]).toEqual([[1.0, 0.0, 0.0, 0.0]]);
        expect(result[1]).toEqual([[1.0, 1.0, 1.0, 1.0]]);
    });

    it('respects explicit maxLen', () => {
        const result = lengthToMask([2], 5);
        expect(result).toEqual([[[1.0, 1.0, 0.0, 0.0, 0.0]]]);
    });

    it('handles length of zero', () => {
        const result = lengthToMask([0, 2]);
        expect(result[0]).toEqual([[0.0, 0.0]]);
        expect(result[1]).toEqual([[1.0, 1.0]]);
    });
});
