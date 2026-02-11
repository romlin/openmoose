/**
 * Core TTS inference engine using ONNX Runtime.
 * Ported from supertone-inc/supertonic Node.js implementation.
 */

import * as ort from 'onnxruntime-node';
import { UnicodeProcessor, lengthToMask, chunkText } from './text-processor.js';

/** Style class containing voice embedding tensors. */
export class Style {
    constructor(public ttl: ort.Tensor, public dp: ort.Tensor) { }
}

/** TTS configuration loaded from tts.json. */
export interface TTSConfig {
    ae: { sample_rate: number; base_chunk_size: number };
    ttl: { chunk_compress_factor: number; latent_dim: number };
}

/** Convert a nested number array to an ONNX float32 tensor. */
export function arrayToTensor(array: number[] | number[][] | number[][][], dims: number[]): ort.Tensor {
    const flat = (array as number[]).flat(Infinity) as number[];
    return new ort.Tensor('float32', Float32Array.from(flat), dims);
}

/** Convert a 2D number array to an ONNX int64 tensor. */
export function intArrayToTensor(array: number[][], dims: number[]): ort.Tensor {
    const flat: number[] = [];
    for (const row of array) {
        for (const val of row) {
            flat.push(val);
        }
    }
    return new ort.Tensor('int64', BigInt64Array.from(flat.map(x => BigInt(x))), dims);
}

/** Compute latent mask from wave lengths. */
function getLatentMask(wavLengths: number[], baseChunkSize: number, chunkCompressFactor: number): number[][][] {
    const latentSize = baseChunkSize * chunkCompressFactor;
    const latentLengths = wavLengths.map(len => Math.floor((len + latentSize - 1) / latentSize));
    return lengthToMask(latentLengths);
}

/** Main TTS inference class. */
export class TextToSpeech {
    sampleRate: number;
    baseChunkSize: number;
    chunkCompressFactor: number;
    ldim: number;

    constructor(
        cfgs: TTSConfig,
        private textProcessor: UnicodeProcessor,
        private dpOrt: ort.InferenceSession,
        private textEncOrt: ort.InferenceSession,
        private vectorEstOrt: ort.InferenceSession,
        private vocoderOrt: ort.InferenceSession
    ) {
        this.sampleRate = cfgs.ae.sample_rate;
        this.baseChunkSize = cfgs.ae.base_chunk_size;
        this.chunkCompressFactor = cfgs.ttl.chunk_compress_factor;
        this.ldim = cfgs.ttl.latent_dim;
    }

    private sampleNoisyLatent(duration: number[]): { noisyLatent: number[][][], latentMask: number[][][] } {
        const wavLenMax = Math.max(...duration) * this.sampleRate;
        const wavLengths = duration.map(d => Math.floor(d * this.sampleRate));
        const chunkSize = this.baseChunkSize * this.chunkCompressFactor;
        const latentLen = Math.floor((wavLenMax + chunkSize - 1) / chunkSize);
        const latentDim = this.ldim * this.chunkCompressFactor;

        const noisyLatent: number[][][] = [];
        for (let b = 0; b < duration.length; b++) {
            const batch: number[][] = [];
            for (let d = 0; d < latentDim; d++) {
                const row: number[] = [];
                for (let t = 0; t < latentLen; t++) {
                    const eps = 1e-10;
                    const u1 = Math.max(eps, Math.random());
                    const u2 = Math.random();
                    row.push(Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2));
                }
                batch.push(row);
            }
            noisyLatent.push(batch);
        }

        const latentMask = getLatentMask(wavLengths, this.baseChunkSize, this.chunkCompressFactor);

        for (let b = 0; b < noisyLatent.length; b++) {
            for (let d = 0; d < noisyLatent[b].length; d++) {
                for (let t = 0; t < noisyLatent[b][d].length; t++) {
                    noisyLatent[b][d][t] *= latentMask[b][0][t];
                }
            }
        }

        return { noisyLatent, latentMask };
    }

    private async infer(textList: string[], langList: string[], style: Style, totalStep: number, speed = 1.05): Promise<{ wav: number[], duration: number[] }> {
        if (textList.length !== style.ttl.dims[0]) {
            throw new Error('Number of texts must match number of style vectors');
        }
        const bsz = textList.length;
        const { textIds, textMask } = this.textProcessor.call(textList, langList);
        const textIdsShape = [bsz, textIds[0].length];
        const textMaskShape = [bsz, 1, textMask[0][0].length];

        const textMaskTensor = arrayToTensor(textMask, textMaskShape);

        const dpResult = await this.dpOrt.run({
            text_ids: intArrayToTensor(textIds, textIdsShape),
            style_dp: style.dp,
            text_mask: textMaskTensor
        });

        const durOnnx = Array.from(dpResult.duration.data as Float32Array);
        for (let i = 0; i < durOnnx.length; i++) {
            durOnnx[i] /= speed;
        }

        const textEncResult = await this.textEncOrt.run({
            text_ids: intArrayToTensor(textIds, textIdsShape),
            style_ttl: style.ttl,
            text_mask: textMaskTensor
        });

        const textEmbTensor = textEncResult.text_emb;
        const { noisyLatent, latentMask } = this.sampleNoisyLatent(durOnnx);
        const latentShape = [bsz, noisyLatent[0].length, noisyLatent[0][0].length];
        const latentMaskShape = [bsz, 1, latentMask[0][0].length];

        const latentMaskTensor = arrayToTensor(latentMask, latentMaskShape);
        const totalStepArray = new Array(bsz).fill(totalStep);
        const scalarShape = [bsz];
        const totalStepTensor = arrayToTensor(totalStepArray, scalarShape);

        for (let step = 0; step < totalStep; step++) {
            const currentStepArray = new Array(bsz).fill(step);
            const vectorEstResult = await this.vectorEstOrt.run({
                noisy_latent: arrayToTensor(noisyLatent, latentShape),
                text_emb: textEmbTensor,
                style_ttl: style.ttl,
                text_mask: textMaskTensor,
                latent_mask: latentMaskTensor,
                total_step: totalStepTensor,
                current_step: arrayToTensor(currentStepArray, scalarShape)
            });

            const denoisedLatent = Array.from(vectorEstResult.denoised_latent.data as Float32Array);
            let idx = 0;
            for (let b = 0; b < noisyLatent.length; b++) {
                for (let d = 0; d < noisyLatent[b].length; d++) {
                    for (let t = 0; t < noisyLatent[b][d].length; t++) {
                        noisyLatent[b][d][t] = denoisedLatent[idx++];
                    }
                }
            }
        }

        const vocoderResult = await this.vocoderOrt.run({
            latent: arrayToTensor(noisyLatent, latentShape)
        });

        const wav = Array.from(vocoderResult.wav_tts.data as Float32Array);
        return { wav, duration: durOnnx };
    }

    async call(text: string, lang: string, style: Style, totalStep: number, speed = 1.05, silenceDuration = 0.3): Promise<{ wav: number[], duration: number[] }> {
        if (style.ttl.dims[0] !== 1) {
            throw new Error('Single speaker TTS only supports single style');
        }
        const maxLen = lang === 'ko' ? 120 : 300;
        const textList = chunkText(text, maxLen);
        let wavCat: number[] | null = null;
        let durCat = 0;

        for (const chunk of textList) {
            const { wav, duration } = await this.infer([chunk], [lang], style, totalStep, speed);
            if (wavCat === null) {
                wavCat = wav;
                durCat = duration[0];
            } else {
                const silenceLen = Math.floor(silenceDuration * this.sampleRate);
                const silence = new Array(silenceLen).fill(0);
                wavCat = [...wavCat, ...silence, ...wav];
                durCat += duration[0] + silenceDuration;
            }
        }

        return { wav: wavCat!, duration: [durCat] };
    }
}
