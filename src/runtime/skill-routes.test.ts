import { describe, it, expect } from 'vitest';
import { extractFirstMatch } from './skill-routes.js';

describe('extractFirstMatch', () => {
    it('returns the first capture group from a matching pattern', () => {
        const patterns = [/weather in (.+)/i];
        const result = extractFirstMatch('weather in Berlin', patterns);
        expect(result).toBe('Berlin');
    });

    it('returns null when no patterns match', () => {
        const patterns = [/weather in (.+)/i];
        const result = extractFirstMatch('what time is it', patterns);
        expect(result).toBeNull();
    });

    it('returns the match from the first matching pattern', () => {
        const patterns = [
            /weather in (.+)/i,
            /forecast for (.+)/i,
        ];
        const result = extractFirstMatch('forecast for Tokyo', patterns);
        expect(result).toBe('Tokyo');
    });

    it('tries patterns in order and returns first match', () => {
        const patterns = [
            /send (.+) to/i,
            /message (.+)/i,
        ];
        const result = extractFirstMatch('send hello to Vanja', patterns);
        expect(result).toBe('hello');
    });

    it('returns null for an empty patterns array', () => {
        const result = extractFirstMatch('hello world', []);
        expect(result).toBeNull();
    });

    it('trims whitespace from the matched result', () => {
        const patterns = [/weather in (.+)/i];
        const result = extractFirstMatch('weather in  Berlin  ', patterns);
        expect(result).toBe('Berlin');
    });
});
