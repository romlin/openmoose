import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalSandbox } from './sandbox.js';

// Mock config
vi.mock('../config/index.js', () => ({
    config: {
        sandbox: {
            defaultImage: 'python:3.12-slim',
            defaultTimeoutMs: 30000,
            defaultMemory: '256m',
            defaultCpus: 1,
            playwrightImage: 'mcr.microsoft.com/playwright:v1.58.0-noble',
            profileDir: '/tmp/test-profiles',
            previewsDir: '/tmp/test-previews',
        },
    },
}));

// Mock child_process.spawn to capture Docker args without running Docker
vi.mock('node:child_process', () => ({
    spawn: vi.fn(),
}));

describe('LocalSandbox', () => {
    let sandbox: LocalSandbox;

    beforeEach(() => {
        vi.clearAllMocks();
        sandbox = new LocalSandbox('test-sandbox');
    });

    describe('constructor', () => {
        it('creates unique container names', () => {
            const a = new LocalSandbox('prefix');
            const b = new LocalSandbox('prefix');
            // Container names include random hex, so they should differ
            const nameA = (a as unknown as { containerName: string }).containerName;
            const nameB = (b as unknown as { containerName: string }).containerName;
            expect(nameA).not.toBe(nameB);
            expect(nameA).toMatch(/^prefix-[0-9a-f]{8}$/);
        });

        it('uses default prefix when none provided', () => {
            const s = new LocalSandbox();
            const name = (s as unknown as { containerName: string }).containerName;
            expect(name).toMatch(/^openmoose-sandbox-[0-9a-f]{8}$/);
        });
    });

    describe('runLanguage (stdin piping)', () => {
        it('pipes code via stdin to prevent shell injection', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockStdin = { write: vi.fn(), end: vi.fn() };
            const mockChild = {
                stdin: mockStdin,
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            await sandbox.runPython("print('hello')");

            // Verify spawn was called with --interactive and stdio pipes
            expect(mockSpawn).toHaveBeenCalledWith(
                'docker',
                expect.arrayContaining(['--interactive']),
                expect.objectContaining({ stdio: expect.any(Array) })
            );

            // Verify stdin.write was called with the code
            expect(mockStdin.write).toHaveBeenCalledWith("print('hello')");
            expect(mockStdin.end).toHaveBeenCalled();
        });
    });

    describe('run', () => {
        it('passes command directly to execute', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockChild = {
                stdout: { on: vi.fn((e: string, cb: (d: Buffer) => void) => { if (e === 'data') cb(Buffer.from('output')); }) },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            const result = await sandbox.run('echo hello');
            expect(result.stdout).toBe('output');
            expect(result.exitCode).toBe(0);
        });
    });

    describe('security hardening', () => {
        it('uses --read-only flag', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockChild = {
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            await sandbox.run('echo test');
            const args = mockSpawn.mock.calls[0][1] as string[];
            expect(args).toContain('--read-only');
        });

        it('drops dangerous capabilities for non-browser containers', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockChild = {
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            await sandbox.run('echo test');
            const args = mockSpawn.mock.calls[0][1] as string[];
            expect(args).toContain('--cap-drop');
            expect(args).toContain('NET_RAW');
        });

        it('sets memory and CPU limits', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockChild = {
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            await sandbox.run('echo test');
            const args = mockSpawn.mock.calls[0][1] as string[];
            expect(args).toContain('--memory');
            expect(args).toContain('256m');
            expect(args).toContain('--cpus');
            expect(args).toContain('1');
        });

        it('uses non-root user 1000:1000', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockChild = {
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            await sandbox.run('echo test');
            const args = mockSpawn.mock.calls[0][1] as string[];
            expect(args).toContain('--user');
            expect(args).toContain('1000:1000');
        });

        it('uses security-opt no-new-privileges and pids-limit', async () => {
            const { spawn } = await import('node:child_process');
            const mockSpawn = vi.mocked(spawn);

            const mockChild = {
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, cb: (code: number) => void) => {
                    if (event === 'close') cb(0);
                }),
            };
            mockSpawn.mockReturnValue(mockChild as never);

            await sandbox.run('echo test');
            const args = mockSpawn.mock.calls[0][1] as string[];
            expect(args).toContain('--security-opt');
            expect(args).toContain('no-new-privileges');
            expect(args).toContain('--pids-limit');
            expect(args).toContain('50');
        });
    });
});
