import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        exclude: ['app/**', 'node_modules/**', 'dist/**'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/types.d.ts'],
        },
    },
});
