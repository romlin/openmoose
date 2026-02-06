/**
 * LocalAudio - Supertonic TTS Integration
 * 167x faster than real-time voice generation
 */

import path from 'node:path';
import { loadTextToSpeech, loadVoiceStyle, createWavBuffer, TextToSpeech, Style } from './supertonic/index.js';
import { logger } from './logger.js';

/**
 * Text-to-speech engine wrapping Supertonic 2 ONNX models.
 * Supports multiple voice styles (M1-M5, F1-F5) and languages.
 */
export class LocalAudio {
  private tts: TextToSpeech | null = null;
  private style: Style | null = null;
  private initialized: Promise<void> | null = null;

  private modelDir: string;
  private voiceStyle: string;
  private lang: string;
  private totalSteps: number;
  private speed: number;

  constructor(options: {
    modelDir?: string;
    voiceStyle?: string;
    lang?: string;
    totalSteps?: number;
    speed?: number;
  } = {}) {
    this.modelDir = options.modelDir || path.join(process.cwd(), 'models/supertonic/onnx');
    this.voiceStyle = options.voiceStyle || path.join(process.cwd(), 'models/supertonic/voice_styles/M1.json');
    this.lang = options.lang || 'en';
    this.totalSteps = options.totalSteps || 2; // Supertonic is fast, 2 steps is usually enough
    this.speed = options.speed || 1.05;
  }

  private async init() {
    if (this.initialized) return this.initialized;

    this.initialized = (async () => {
      logger.info('Initializing Supertonic TTS...', 'Audio');
      const start = Date.now();

      this.tts = await loadTextToSpeech(this.modelDir);
      this.style = loadVoiceStyle([this.voiceStyle]);

      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      logger.success(`Supertonic loaded in ${elapsed}s`, 'Audio');
    })();

    return this.initialized;
  }

  /** Generate a WAV audio buffer from the given text. */
  async generateWav(text: string): Promise<Buffer> {
    await this.init();

    if (!this.tts || !this.style) {
      throw new Error('TTS not initialized');
    }

    logger.debug(`Generating speech for: "${text.substring(0, 50)}..."`, 'Audio');
    const start = Date.now();

    const { wav, duration } = await this.tts.call(
      text,
      this.lang,
      this.style,
      this.totalSteps,
      this.speed
    );

    const sampleRate = this.tts.sampleRate;
    const buffer = createWavBuffer(wav, sampleRate);

    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    const audioDuration = duration[0].toFixed(2);
    const rtf = (parseFloat(elapsed) / parseFloat(audioDuration)).toFixed(3);

    logger.debug(`Generated ${audioDuration}s audio in ${elapsed}s (RTF: ${rtf})`, 'Audio');

    return buffer;
  }

  /** Switch voice style by providing a path to a voice style JSON file. */
  setVoice(voiceStylePath: string) {
    this.voiceStyle = voiceStylePath;
    this.style = null;
    this.initialized = null;
  }

  /** Set the output language. Supported: en, ko, es, pt, fr. */
  setLanguage(lang: string) {
    if (!['en', 'ko', 'es', 'pt', 'fr'].includes(lang)) {
      throw new Error(`Unsupported language: ${lang}. Supported: en, ko, es, pt, fr`);
    }
    this.lang = lang;
  }

  /** Release all loaded models and reset initialization state. */
  terminate() {
    // No worker to terminate in this implementation
    this.tts = null;
    this.style = null;
    this.initialized = null;
  }
}
