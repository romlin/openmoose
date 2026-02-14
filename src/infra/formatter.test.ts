import { describe, it, expect } from 'vitest';
import { Formatter, StreamingFormatter } from './formatter.js';

describe('Formatter.cleanForUser', () => {
    it('strips <think> blocks', () => {
        const input = '<think>internal reasoning</think>Hello world';
        expect(Formatter.cleanForUser(input)).toBe('Hello world');
    });

    it('strips <thought> blocks', () => {
        const input = '<thought>planning step</thought>Result here';
        expect(Formatter.cleanForUser(input)).toBe('Result here');
    });

    it('strips multiline thought blocks', () => {
        const input = '<think>\nstep 1\nstep 2\n</think>\nThe answer is 42.';
        expect(Formatter.cleanForUser(input)).toBe('The answer is 42.');
    });

    it('is case-insensitive for thought tags', () => {
        const input = '<THINK>hidden</THINK>visible';
        expect(Formatter.cleanForUser(input)).toBe('visible');
    });

    it('preserves markdown bold', () => {
        const input = 'This is **bold** text';
        expect(Formatter.cleanForUser(input)).toBe('This is **bold** text');
    });

    it('preserves markdown italic', () => {
        const input = 'This is *italic* text';
        expect(Formatter.cleanForUser(input)).toBe('This is *italic* text');
    });

    it('preserves markdown headers', () => {
        const input = '## Header\nContent';
        expect(Formatter.cleanForUser(input)).toBe('## Header\nContent');
    });

    it('removes "Assistant:" prefix', () => {
        const input = 'Assistant: Here is the answer.';
        expect(Formatter.cleanForUser(input)).toBe('Here is the answer.');
    });

    it('removes "Response:" prefix', () => {
        const input = '**Response:** The result is 5.';
        expect(Formatter.cleanForUser(input)).toBe('The result is 5.');
    });

    it('filters emojis', () => {
        const input = 'Hello! 😊 How are you? 🚀';
        expect(Formatter.cleanForUser(input)).toBe('Hello!  How are you?');
    });

    it('collapses excessive newlines', () => {
        const input = 'Line 1\n\n\n\n\nLine 2';
        expect(Formatter.cleanForUser(input)).toBe('Line 1\n\nLine 2');
    });

    it('handles empty string', () => {
        expect(Formatter.cleanForUser('')).toBe('');
    });

    it('handles whitespace-only string', () => {
        expect(Formatter.cleanForUser('   \n  ')).toBe('');
    });

    it('unwraps <final> tags', () => {
        const input = '<final>The answer is 42.</final>';
        expect(Formatter.cleanForUser(input)).toBe('The answer is 42.');
    });
});

describe('StreamingFormatter', () => {
    it('passes through clean text', () => {
        const sf = new StreamingFormatter();
        expect(sf.process('Hello world')).toBe('Hello world');
    });

    it('suppresses thought blocks in a single delta', () => {
        const sf = new StreamingFormatter();
        const result = sf.process('<think>reasoning</think>Answer');
        expect(result).toBe('Answer');
    });

    it('suppresses thought blocks split across deltas', () => {
        const sf = new StreamingFormatter();
        let output = '';
        output += sf.process('<thi');
        output += sf.process('nk>internal');
        output += sf.process(' reasoning</think>');
        output += sf.process('The answer.');
        expect(output).toBe('The answer.');
    });

    it('trims leading whitespace before first content', () => {
        const sf = new StreamingFormatter();
        const result = sf.process('   Hello');
        expect(result).toBe('Hello');
    });

    it('preserves markdown in streaming output', () => {
        const sf = new StreamingFormatter();
        const result = sf.process('This is **bold** and *italic*');
        expect(result).toContain('**');
        expect(result).toContain('*');
    });

    it('flush returns cleaned remaining buffer', () => {
        const sf = new StreamingFormatter();
        sf.process('Some text');
        const flushed = sf.flush();
        expect(typeof flushed).toBe('string');
    });

    it('flush resets state for next interaction', () => {
        const sf = new StreamingFormatter();
        sf.process('<think>hidden</think>visible');
        sf.flush();
        // After flush, a new interaction should work cleanly
        const result = sf.process('Fresh start');
        expect(result).toBe('Fresh start');
    });
});
