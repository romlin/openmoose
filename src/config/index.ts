/**
 * Centralized configuration -- loads environment variables and provides
 * typed, defaulted access to all OpenMoose settings.
 */

import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const VALID_PROVIDERS = ['mistral', 'node-llama-cpp'] as const;
const VALID_GPU_VALUES = ['auto', 'metal', 'cuda', 'vulkan', 'false'] as const;

function validateProvider(raw: string | undefined): 'mistral' | 'node-llama-cpp' {
    const value = raw || 'node-llama-cpp';
    if (VALID_PROVIDERS.includes(value as typeof VALID_PROVIDERS[number])) {
        return value as 'mistral' | 'node-llama-cpp';
    }
    console.warn(`[Config] Invalid LLM_PROVIDER "${value}", falling back to "node-llama-cpp". Valid: ${VALID_PROVIDERS.join(', ')}`);
    return 'node-llama-cpp';
}

function validateGpu(raw: string | undefined): 'auto' | 'metal' | 'cuda' | 'vulkan' | false {
    const value = raw || 'auto';
    if (!VALID_GPU_VALUES.includes(value as typeof VALID_GPU_VALUES[number])) {
        console.warn(`[Config] Invalid LLAMA_CPP_GPU "${value}", falling back to "auto". Valid: ${VALID_GPU_VALUES.join(', ')}`);
        return 'auto';
    }
    return value === 'false' ? false : (value as 'auto' | 'metal' | 'cuda' | 'vulkan');
}

export const config = {
    gateway: {
        port: parseInt(process.env.GATEWAY_PORT || '18789', 10),
        maxHistoryLength: 20,
        portKillDelayMs: 500,
    },

    brain: {
        provider: validateProvider(process.env.LLM_PROVIDER),
        mistral: {
            model: process.env.MISTRAL_MODEL || 'mistral-large-latest',
            apiKey: process.env.MISTRAL_API_KEY,
        },
        llamaCpp: {
            modelPath: process.env.LLAMA_CPP_MODEL_PATH || path.join(process.cwd(), 'models/llama-cpp/ministral-8b-reasoning-q4km.gguf'),
            gpu: validateGpu(process.env.LLAMA_CPP_GPU),
        }
    },

    router: {
        /** Minimum confidence for considering a skill match. */
        routeThreshold: 0.5,
        /** Minimum confidence for actually executing a skill. */
        executeThreshold: 0.68,
    },

    runner: {
        maxToolIterations: 10,
        autoCaptureTriggers: ['remember', 'my name is', 'i like', 'favorite'],
    },

    scheduler: {
        pollIntervalMs: 60_000,
    },

    skills: {
        /** Execution timeout for portable YAML skills (ms). */
        timeoutMs: 15_000,
        customDir: path.join(process.cwd(), 'src/tools/custom'),
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

    whatsapp: {
        authDir: path.join(process.cwd(), '.moose/data', 'whatsapp-auth'),
        contactsPath: path.join(process.cwd(), '.moose/data', 'contacts.json'),
        reconnectDelayMs: 5_000,
    },

    sandbox: {
        profileDir: process.env.BROWSER_PROFILE_DIR || path.join(process.cwd(), '.moose/data', 'browser-profiles'),
        previewsDir: path.join(process.cwd(), '.moose/data', 'browser-previews'),
        defaultImage: 'python:3.12-slim',
        playwrightImage: 'mcr.microsoft.com/playwright:v1.58.0-noble',
        defaultTimeoutMs: 30_000,
        defaultMemory: '512m',
        defaultCpus: 1.0,
    },

    logging: {
        level: process.env.LOG_LEVEL || 'info',
        silent: process.env.LOG_SILENT === 'true',
    }
} as const;

// Type export for use elsewhere
export type Config = typeof config;
