import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { assertSafePath } from './safe-path.js';

const ROOT = '/tmp/test-project';

describe('assertSafePath', () => {
    it('accepts a simple relative path', () => {
        const result = assertSafePath('src/index.ts', ROOT);
        expect(result).toBe(path.join(ROOT, 'src/index.ts'));
    });

    it('accepts the project root itself', () => {
        const result = assertSafePath('.', ROOT);
        expect(result).toBe(ROOT);
    });

    it('accepts nested paths', () => {
        const result = assertSafePath('src/infra/memory.ts', ROOT);
        expect(result).toBe(path.join(ROOT, 'src/infra/memory.ts'));
    });

    it('blocks path traversal with ../', () => {
        expect(() => assertSafePath('../outside', ROOT)).toThrow('Path traversal blocked');
    });

    it('blocks path traversal with deep ../', () => {
        expect(() => assertSafePath('src/../../outside', ROOT)).toThrow('Path traversal blocked');
    });

    it('blocks absolute paths outside root', () => {
        expect(() => assertSafePath('/etc/passwd', ROOT)).toThrow('Path traversal blocked');
    });

    it('blocks access to .env files', () => {
        expect(() => assertSafePath('.env', ROOT)).toThrow('blocked pattern ".env"');
    });

    it('blocks access to .env.local', () => {
        expect(() => assertSafePath('.env.local', ROOT)).toThrow('blocked pattern ".env"');
    });

    it('blocks access to whatsapp-auth directory', () => {
        expect(() => assertSafePath('whatsapp-auth/creds.json', ROOT)).toThrow('blocked pattern');
    });

    it('blocks access to creds.json anywhere', () => {
        expect(() => assertSafePath('data/creds.json', ROOT)).toThrow('blocked pattern "creds.json"');
    });

    it('blocks access to node_modules', () => {
        expect(() => assertSafePath('node_modules/some-pkg/index.js', ROOT)).toThrow('blocked pattern "node_modules"');
    });

    it('normalizes paths with redundant segments', () => {
        const result = assertSafePath('src/./infra/../infra/logger.ts', ROOT);
        expect(result).toBe(path.join(ROOT, 'src/infra/logger.ts'));
    });

    it('rejects paths that look like the root but are prefix attacks', () => {
        // e.g., /tmp/test-project-evil should not be accepted
        expect(() => assertSafePath('/tmp/test-project-evil/file.ts', ROOT)).toThrow('Path traversal blocked');
    });
});
