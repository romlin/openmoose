/**
 * Tests for centralized configuration -- verifies defaults and structure.
 */

import { describe, it, expect } from 'vitest';
import { config } from './index.js';

describe('config', () => {
    it('has a gateway port number', () => {
        expect(typeof config.gateway.port).toBe('number');
        expect(config.gateway.port).toBeGreaterThan(0);
    });

    it('has brain provider set to node-llama-cpp or mistral', () => {
        expect(['node-llama-cpp', 'mistral']).toContain(config.brain.provider);
    });

    it('has llama-cpp model path', () => {
        expect(config.brain.llamaCpp.modelPath).toBeTruthy();
        expect(config.brain.llamaCpp.modelPath).toContain('ministral-3b');
    });

    it('has mistral model name', () => {
        expect(config.brain.mistral.model).toBeTruthy();
    });

    it('has audio config with valid lang', () => {
        expect(config.audio.lang).toBeTruthy();
        expect(config.audio.totalSteps).toBeGreaterThan(0);
        expect(config.audio.speed).toBeGreaterThan(0);
    });

    it('has memory db path', () => {
        expect(config.memory.dbPath).toBeTruthy();
    });

    it('has whatsapp config paths', () => {
        expect(config.whatsapp.authDir).toContain('whatsapp-auth');
        expect(config.whatsapp.contactsPath).toContain('contacts.json');
    });

    it('has sandbox config', () => {
        expect(config.sandbox.profileDir).toBeTruthy();
        expect(config.sandbox.defaultImage).toContain('python');
        expect(config.sandbox.playwrightImage).toContain('playwright');
    });

    it('has logging config', () => {
        expect(config.logging.level).toBeTruthy();
        expect(typeof config.logging.silent).toBe('boolean');
    });
});
