/**
 * BrowserManager — manages the lifecycle of the persistent Playwright
 * daemon container: image build, container start/stop, health checks.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { getErrorMessage } from '../../infra/errors.js';
import {
    BROWSER_DAEMON_PORT,
    BROWSER_DAEMON_CONTAINER_NAME,
    BROWSER_DAEMON_HEALTH_URL,
    BROWSER_IMAGE_PREFIX,
} from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Extract Playwright version from the Docker image tag (e.g. "v1.58.0-noble" → "1.58.0"). */
function playwrightVersion(): string {
    return config.sandbox.playwrightImage.match(/:v([\d.]+)/)?.[1] || '';
}

/** Derive the local image tag from the configured Playwright version. */
function imageTag(): string {
    return `${BROWSER_IMAGE_PREFIX}:${playwrightVersion() || 'latest'}`;
}

type DockerResult = { code: number; stdout: string; stderr: string };

/**
 * Run a docker command. With capture: true returns code + output for error surfacing;
 * otherwise returns exit code only and can optionally log output to logger (debug).
 */
function runDocker(
    args: string[],
    options?: { logTag?: string }
): Promise<number>;
function runDocker(
    args: string[],
    options: { capture: true }
): Promise<DockerResult>;
function runDocker(
    args: string[],
    options?: { logTag?: string; capture?: true }
): Promise<number | DockerResult> {
    return new Promise(resolve => {
        const child = spawn('docker', args);
        const capture = options?.capture === true;
        let stdout = '';
        let stderr = '';

        if (capture) {
            child.stdout.on('data', d => { stdout += d; });
            child.stderr.on('data', d => { stderr += d; });
        } else {
            const logTag = options?.logTag;
            child.stdout.on('data', logTag ? d => logger.debug(String(d), logTag) : () => { });
            child.stderr.on('data', logTag ? d => logger.debug(String(d), logTag) : () => { });
        }

        child.on('error', () =>
            resolve(capture ? { code: 1, stdout, stderr } : 1));
        child.on('close', code => {
            const exitCode = code ?? 1;
            resolve(capture ? { code: exitCode, stdout, stderr } : exitCode);
        });
    });
}

export class BrowserManager {
    /** In-flight promise to serialize concurrent ensureRunning() calls. */
    private static _ensureRunningPromise: Promise<void> | null = null;
    private static isCleaning = false;

    /** Ensure the browser daemon container is running and healthy. */
    static ensureRunning(): Promise<void> {
        if (this._ensureRunningPromise) return this._ensureRunningPromise;
        this._ensureRunningPromise = this._doEnsureRunning().finally(() => {
            this._ensureRunningPromise = null;
        });
        return this._ensureRunningPromise;
    }

    /** Actual start sequence -- only one runs at a time. */
    private static async _doEnsureRunning(): Promise<void> {
        if (await this.isHealthy()) return;

        // Non-blocking Hygiene:
        // 1. Critical: Clear the socket/lock files (fast)
        await this.clearLocks().catch(() => { });

        // 2. Heavy: Purge HARs, snapshots, and traces (slow, in background if not already cleaning)
        if (!this.isCleaning) {
            this.cleanup().catch(err => {
                logger.debug(`Background cleanup error: ${getErrorMessage(err)}`, 'BrowserManager');
            });
        }

        // Remove any stale container before starting fresh
        await this.stop();

        const tag = await this.ensureImageBuilt();

        const profileDir = config.sandbox.profileDir;
        const previewsDir = config.sandbox.previewsDir;
        fs.mkdirSync(profileDir, { recursive: true });
        fs.mkdirSync(previewsDir, { recursive: true });

        // In production we don't bind-mount daemon.js; the image already contains it from the build.
        const isProduction = __dirname.includes('resources/gateway') || __dirname.includes('/usr/lib/openmoose');

        logger.info('Starting Browser Daemon...', 'BrowserManager');

        const args = [
            'run', '-d', '--rm',
            '--name', BROWSER_DAEMON_CONTAINER_NAME,
            '-p', `${BROWSER_DAEMON_PORT}:${BROWSER_DAEMON_PORT}`,
            '--ipc=host',
            '-e', `PORT=${BROWSER_DAEMON_PORT}`,
        ];

        // Only bind-mount daemon.js in development for hot-reloading
        if (!isProduction) {
            const daemonSrc = path.resolve(__dirname, 'daemon.js');
            if (fs.existsSync(daemonSrc)) {
                args.push('-v', `${daemonSrc}:/app/daemon.js:ro`);
            }
        }

        args.push(
            // Browser profiles
            '-v', `${profileDir}:/root/.config/google-chrome`,
            '-v', `${profileDir}:/root/.mozilla`,
            // Screenshots
            '-v', `${previewsDir}:/app/previews`,
            '--cap-add', 'SYS_ADMIN',
            tag,
            'node', 'daemon.js',
        );

        const startCode = await runDocker(args, { logTag: 'BrowserDaemon' });
        if (startCode !== 0) {
            logger.error(`Docker run failed with exit code ${startCode}. Check if an image or container named "${BROWSER_DAEMON_CONTAINER_NAME}" already exists or if you have permissions to run Docker.`, 'BrowserManager');
            throw new Error(`Failed to start browser daemon (exit ${startCode})`);
        }

        await this.waitForHealthy();
    }

    /** Targeted cleanup of lock files to allow fast startup. */
    private static async clearLocks(): Promise<void> {
        const profileDir = config.sandbox.profileDir;
        if (fs.existsSync(profileDir)) {
            const files = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
            for (const file of files) {
                const fullPath = path.join(profileDir, file);
                if (fs.existsSync(fullPath)) {
                    await fs.promises.unlink(fullPath).catch(() => { });
                }
            }
        }
    }

    /** Stop and remove the daemon container. No-op if not found. */
    static async stop(): Promise<void> {
        // -f removes running containers, ignore error if missing
        await runDocker(['rm', '-f', BROWSER_DAEMON_CONTAINER_NAME]);
    }

    /** 
     * Thorough cleanup of host artifacts and stopped containers.
     * Fully async to prevent blocking the event loop on exit.
     */
    static async cleanup(): Promise<void> {
        if (this.isCleaning) return;
        this.isCleaning = true;

        try {
            logger.info('Performing deep cleanup of browser artifacts...', 'BrowserManager');

            // 1. Force stop container
            await this.stop();

            const previewsDir = config.sandbox.previewsDir;
            const profileDir = config.sandbox.profileDir;

            // 2. Clean up old preview images/screenshots/logs (Async)
            if (fs.existsSync(previewsDir)) {
                try {
                    const files = await fs.promises.readdir(previewsDir);
                    const extensions = ['.png', '.jpg', '.har', '.trace', '.log', '.json'];
                    await Promise.all(
                        files.filter(f => extensions.some(ext => f.endsWith(ext)))
                            .map(f => fs.promises.unlink(path.join(previewsDir, f)).catch(() => { }))
                    );
                } catch (err) {
                    logger.warn(`Failed to clean previews: ${getErrorMessage(err)}`, 'BrowserManager');
                }
            }

            // 3. Optional: Clear profile dir on hard reset (deep purge)
            if (fs.existsSync(profileDir)) {
                try {
                    const files = await fs.promises.readdir(profileDir, { recursive: true });
                    await Promise.all(
                        files.filter(f => typeof f === 'string' && (f.includes('Singleton') || f.includes('Session') || f.endsWith('.lock')))
                            .map(f => fs.promises.unlink(path.join(profileDir, f as string)).catch(() => { }))
                    );
                } catch {
                    // Ignore profile cleanup errors
                }
            }
        } finally {
            this.isCleaning = false;
        }
    }

    /** Check if the daemon is reachable and healthy. */
    private static async isHealthy(): Promise<boolean> {
        try {
            const res = await fetch(BROWSER_DAEMON_HEALTH_URL, { signal: AbortSignal.timeout(3_000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    /** Poll the health endpoint until ready (max 30 s). */
    private static async waitForHealthy(): Promise<void> {
        for (let i = 0; i < 30; i++) {
            if (await this.isHealthy()) {
                logger.success('Browser Daemon is ready.', 'BrowserManager');
                return;
            }
            await new Promise(r => setTimeout(r, 1_000));
        }
        throw new Error('Browser daemon failed to start within 30 s.');
    }

    /**
     * Build the custom browser image if it doesn't exist locally.
     * Pipes Dockerfile via stdin and the build context as a tar stream so
     * snap-confined Docker (which can't read host files) works.
     */
    private static async ensureImageBuilt(): Promise<string> {
        const tag = imageTag();

        const inspectCode = await runDocker(['image', 'inspect', tag]);
        if (inspectCode === 0) return tag;

        const version = playwrightVersion() || '1.58.0';
        logger.info(`Building browser image ${tag} (first time only)...`, 'BrowserManager');

        const daemonSrc = path.join(__dirname, 'daemon.js');
        if (!fs.existsSync(daemonSrc)) {
            throw new Error(`Browser build files missing in ${__dirname}. Reinstall the app or run from source.`);
        }

        const dockerfileContent = [
            `ARG PW_VERSION=${version}`,
            'FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble',
            'WORKDIR /app',
            'ARG PW_VERSION',
            'ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1',
            'RUN npm init -y > /dev/null 2>&1 && npm install playwright@${PW_VERSION}',
            'RUN chown -R pwuser:pwuser /app',
            'USER pwuser',
            'COPY daemon.js .',
            'HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\',
            '  CMD node -e "fetch(\'http://localhost:4000/health\').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"',
            '',
        ].join('\n');

        const daemonContent = fs.readFileSync(daemonSrc);

        const buildDocker = (): Promise<DockerResult> => {
            return new Promise(resolve => {
                const child = spawn('docker', [
                    'build', '-t', tag,
                    '--build-arg', `PW_VERSION=${version}`,
                    '-',  // context (tar with Dockerfile inside) from stdin
                ]);

                let stdout = '';
                let stderr = '';
                child.stdout.on('data', d => { stdout += d; });
                child.stderr.on('data', d => { stderr += d; });
                child.on('error', () => resolve({ code: 1, stdout, stderr }));
                child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));

                // Build a minimal tar archive containing Dockerfile + daemon.js and pipe to stdin.
                const tar = buildTar({
                    'Dockerfile': Buffer.from(dockerfileContent, 'utf8'),
                    'daemon.js': daemonContent,
                });
                child.stdin.write(tar);
                child.stdin.end();
            });
        };

        let result = await buildDocker();
        if (result.code !== 0) {
            logger.info('Build failed, retrying once...', 'BrowserManager');
            result = await buildDocker();
        }
        if (result.code !== 0) {
            if (result.stderr) logger.error(result.stderr.trimEnd(), 'BrowserBuild');
            if (result.stdout) logger.info(result.stdout.trimEnd(), 'BrowserBuild');
            throw new Error(`Browser image build failed (exit ${result.code}). Ensure Docker is running and has network access.`);
        }
        return tag;
    }
}

/**
 * Build a minimal POSIX tar archive (uncompressed) from a map of filename → Buffer.
 * Avoids any external dependency; only used for the small browser image context.
 */
function buildTar(files: Record<string, Buffer>): Buffer {
    const blocks: Buffer[] = [];
    for (const [name, data] of Object.entries(files)) {
        const header = Buffer.alloc(512, 0);
        // name (0..100)
        header.write(name, 0, Math.min(name.length, 100), 'utf8');
        // mode (100..108) — 0644
        header.write('0000644\0', 100, 8, 'utf8');
        // uid (108..116)
        header.write('0000000\0', 108, 8, 'utf8');
        // gid (116..124)
        header.write('0000000\0', 116, 8, 'utf8');
        // size (124..136) — octal
        header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8');
        // mtime (136..148) — current time
        const mtime = Math.floor(Date.now() / 1000);
        header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf8');
        // typeflag (156) — '0' regular file
        header.write('0', 156, 1, 'utf8');
        // magic (257..263) — "ustar\0"
        header.write('ustar\0', 257, 6, 'utf8');
        // version (263..265) — "00"
        header.write('00', 263, 2, 'utf8');

        // checksum (148..156) — compute over header with spaces in checksum field
        header.fill(0x20, 148, 156);
        let chksum = 0;
        for (let i = 0; i < 512; i++) chksum += header[i];
        header.write(chksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');

        blocks.push(header);
        blocks.push(data);
        // Pad data to 512-byte boundary
        const remainder = data.length % 512;
        if (remainder > 0) blocks.push(Buffer.alloc(512 - remainder, 0));
    }
    // Two zero blocks = end of archive
    blocks.push(Buffer.alloc(1024, 0));
    return Buffer.concat(blocks);
}
