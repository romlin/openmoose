/**
 * Supertonic TTS public API.
 * Re-exports the core engine and provides model loading helpers.
 *
 * Original: supertone-inc/supertonic (https://github.com/supertone-inc/supertonic)
 */

import fs from 'node:fs';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { UnicodeProcessor } from './text-processor.js';
import { TextToSpeech, Style, type TTSConfig } from './tts-engine.js';
import { logger } from '../logger.js';

export { TextToSpeech, Style } from './tts-engine.js';
export { chunkText } from './text-processor.js';

/** Safely parse a JSON model file, wrapping errors with the file path. */
function readModelJson(filePath: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        throw new Error(`Failed to load model file "${filePath}": ${err instanceof Error ? err.message : err}`);
    }
}

/** Load voice style embeddings from JSON files. */
export function loadVoiceStyle(voiceStylePaths: string[]): Style {
    const bsz = voiceStylePaths.length;
    const firstStyle = readModelJson(voiceStylePaths[0]) as { style_ttl: { dims: number[] }; style_dp: { dims: number[] } };
    const ttlDims = firstStyle.style_ttl.dims;
    const dpDims = firstStyle.style_dp.dims;

    const ttlDim1 = ttlDims[1];
    const ttlDim2 = ttlDims[2];
    const dpDim1 = dpDims[1];
    const dpDim2 = dpDims[2];

    const ttlFlat = new Float32Array(bsz * ttlDim1 * ttlDim2);
    const dpFlat = new Float32Array(bsz * dpDim1 * dpDim2);

    for (let i = 0; i < bsz; i++) {
        const voiceStyle = readModelJson(voiceStylePaths[i]) as {
            style_ttl: { data: number[][][] };
            style_dp: { data: number[][][] };
        };
        const ttlData = voiceStyle.style_ttl.data.flat(Infinity) as unknown as number[];
        ttlFlat.set(ttlData, i * ttlDim1 * ttlDim2);
        const dpData = voiceStyle.style_dp.data.flat(Infinity) as unknown as number[];
        dpFlat.set(dpData, i * dpDim1 * dpDim2);
    }

    const ttlStyle = new ort.Tensor('float32', ttlFlat, [bsz, ttlDim1, ttlDim2]);
    const dpStyle = new ort.Tensor('float32', dpFlat, [bsz, dpDim1, dpDim2]);
    return new Style(ttlStyle, dpStyle);
}

/** Load all TTS ONNX models from a directory. */
export async function loadTextToSpeech(onnxDir: string): Promise<TextToSpeech> {
    logger.info('Loading TTS models from: ' + onnxDir, 'Supertonic');
    const opts = {};

    const cfgs = readModelJson(path.join(onnxDir, 'tts.json')) as TTSConfig;

    const [dpOrt, textEncOrt, vectorEstOrt, vocoderOrt] = await Promise.all([
        ort.InferenceSession.create(path.join(onnxDir, 'duration_predictor.onnx'), opts),
        ort.InferenceSession.create(path.join(onnxDir, 'text_encoder.onnx'), opts),
        ort.InferenceSession.create(path.join(onnxDir, 'vector_estimator.onnx'), opts),
        ort.InferenceSession.create(path.join(onnxDir, 'vocoder.onnx'), opts)
    ]);

    const textProcessor = new UnicodeProcessor(path.join(onnxDir, 'unicode_indexer.json'));
    return new TextToSpeech(cfgs, textProcessor, dpOrt, textEncOrt, vectorEstOrt, vocoderOrt);
}

/** Convert raw audio samples to a WAV buffer. */
export function createWavBuffer(audioData: number[], sampleRate: number): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = audioData.length * bitsPerSample / 8;

    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < audioData.length; i++) {
        const sample = Math.max(-1, Math.min(1, audioData[i]));
        const intSample = Math.floor(sample * 32767);
        buffer.writeInt16LE(intSample, 44 + i * 2);
    }

    return buffer;
}
