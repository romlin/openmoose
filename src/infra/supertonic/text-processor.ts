/**
 * Unicode text processor for Supertonic TTS.
 * Handles text normalization, emoji removal, and language tagging.
 */

import fs from 'node:fs';

const AVAILABLE_LANGS = ["en", "ko", "es", "pt", "fr"];

export class UnicodeProcessor {
    indexer: Record<number, number>;

    constructor(unicodeIndexerJsonPath: string) {
        try {
            this.indexer = JSON.parse(fs.readFileSync(unicodeIndexerJsonPath, 'utf8'));
        } catch (err) {
            throw new Error(`Failed to load unicode indexer "${unicodeIndexerJsonPath}": ${err instanceof Error ? err.message : err}`);
        }
    }

    private preprocessText(text: string, lang: string): string {
        text = text.normalize('NFKD');

        // Remove emojis
        const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
        text = text.replace(emojiPattern, '');

        // Replace various dashes and symbols
        const replacements: Record<string, string> = {
            '\u2013': '-', '\u2011': '-', '\u2014': '-', '_': ' ',
            '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
            '\u00B4': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ',
            '#': ' ', '\u2192': ' ', '\u2190': ' ',
        };
        for (const [k, v] of Object.entries(replacements)) {
            text = text.replaceAll(k, v);
        }

        text = text.replace(/[\u2665\u2606\u2661\u00A9\\]/g, '');

        const exprReplacements: Record<string, string> = {
            '@': ' at ', 'e.g.,': 'for example, ', 'i.e.,': 'that is, ',
        };
        for (const [k, v] of Object.entries(exprReplacements)) {
            text = text.replaceAll(k, v);
        }

        // Fix spacing
        text = text.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!')
            .replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'");

        while (text.includes('""')) text = text.replace('""', '"');
        while (text.includes("''")) text = text.replace("''", "'");

        text = text.replace(/\s+/g, ' ').trim();

        if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) {
            text += '.';
        }

        if (!AVAILABLE_LANGS.includes(lang)) {
            throw new Error(`Invalid language: ${lang}. Available: ${AVAILABLE_LANGS.join(', ')}`);
        }

        return `<${lang}>` + text + `</${lang}>`;
    }

    private textToUnicodeValues(text: string): number[] {
        return Array.from(text).map(char => char.charCodeAt(0));
    }

    call(textList: string[], langList: string[]): { textIds: number[][], textMask: number[][][] } {
        const processedTexts = textList.map((t, i) => this.preprocessText(t, langList[i]));
        const textIdsLengths = processedTexts.map(t => t.length);
        const maxLen = Math.max(...textIdsLengths);

        const textIds: number[][] = [];
        for (let i = 0; i < processedTexts.length; i++) {
            const row = new Array(maxLen).fill(0);
            const unicodeVals = this.textToUnicodeValues(processedTexts[i]);
            for (let j = 0; j < unicodeVals.length; j++) {
                row[j] = this.indexer[unicodeVals[j]];
            }
            textIds.push(row);
        }

        const textMask = lengthToMask(textIdsLengths);
        return { textIds, textMask };
    }
}

/** Convert lengths to a binary mask tensor. */
export function lengthToMask(lengths: number[], maxLen: number | null = null): number[][][] {
    maxLen = maxLen || Math.max(...lengths);
    const mask: number[][][] = [];
    for (let i = 0; i < lengths.length; i++) {
        const row: number[] = [];
        for (let j = 0; j < maxLen; j++) {
            row.push(j < lengths[i] ? 1.0 : 0.0);
        }
        mask.push([row]);
    }
    return mask;
}

/** Split text into sentence-aware chunks respecting maxLen. */
export function chunkText(text: string, maxLen = 300): string[] {
    const paragraphs = text.trim().split(/\n\s*\n+/).filter(p => p.trim());
    const chunks: string[] = [];

    for (let paragraph of paragraphs) {
        paragraph = paragraph.trim();
        if (!paragraph) continue;

        const sentences = paragraph.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/);
        let currentChunk = "";

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length + 1 <= maxLen) {
                currentChunk += (currentChunk ? " " : "") + sentence;
            } else {
                if (currentChunk) chunks.push(currentChunk.trim());
                currentChunk = sentence;
            }
        }
        if (currentChunk) chunks.push(currentChunk.trim());
    }

    return chunks;
}
