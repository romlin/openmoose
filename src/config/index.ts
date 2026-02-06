/**
 * Centralized configuration -- loads environment variables and provides
 * typed, defaulted access to all OpenMoose settings.
 */

import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();
export const config = {
    gateway: {
        port: parseInt(process.env.GATEWAY_PORT || '18789', 10),
    },

    brain: {
        provider: (process.env.LLM_PROVIDER || 'ollama') as 'ollama' | 'mistral',
        ollama: {
            host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
            model: process.env.OLLAMA_MODEL || 'ministral-3:3b',
        },
        mistral: {
            model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
            apiKey: process.env.MISTRAL_API_KEY,
        }
    },

    audio: {
        modelDir: path.join(process.cwd(), 'models/supertonic/onnx'),
        voiceStyle: path.join(process.cwd(), 'models/supertonic/voice_styles/M1.json'),
        lang: process.env.TTS_LANG || 'en',
        totalSteps: parseInt(process.env.TTS_STEPS || '2', 10),
        speed: parseFloat(process.env.TTS_SPEED || '1.05'),
    },

    memory: {
        dbPath: process.env.MEMORY_DB_PATH || '.moose/memory',
    },

    skills: {
        customDir: path.join(process.cwd(), 'src/tools/custom'),
    },

    whatsapp: {
        authDir: path.join(process.cwd(), '.moose/data', 'whatsapp-auth'),
        contactsPath: path.join(process.cwd(), '.moose/data', 'contacts.json'),
    },
    sandbox: {
        profileDir: process.env.BROWSER_PROFILE_DIR || path.join(process.cwd(), '.moose/data', 'browser-profiles'),
        defaultImage: 'python:3.12-slim',
        playwrightImage: 'mcr.microsoft.com/playwright:v1.49.0-noble',
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        silent: process.env.LOG_SILENT === 'true',
    }
} as const;

// Type export for use elsewhere
export type Config = typeof config;
