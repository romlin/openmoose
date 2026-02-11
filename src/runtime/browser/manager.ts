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

/** Run a docker command and return the exit code. Optionally pipe output to logger. */
function dockerRun(args: string[], logTag?: string): Promise<number> {
    return new Promise(resolve => {
        const child = spawn('docker', args);
        child.stdout.on('data', logTag ? d => logger.debug(`${d}`, logTag) : () => { });
        child.stderr.on('data', logTag ? d => logger.debug(`${d}`, logTag) : () => { });
        child.on('error', () => resolve(1));
        child.on('close', code => resolve(code ?? 1));
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

        logger.info('Starting Browser Daemon...', 'BrowserManager');

        const args = [
            'run', '-d', '--rm',
            '--name', BROWSER_DAEMON_CONTAINER_NAME,
            '-p', `${BROWSER_DAEMON_PORT}:${BROWSER_DAEMON_PORT}`,
            '--ipc=host',
            '-e', `PORT=${BROWSER_DAEMON_PORT}`,
        ];

        // In dev, daemon.js lives alongside this file in src/; bind-mount it
        // so changes take effect without rebuilding the image.  In prod the
        // file is baked into the image via COPY, so no mount is needed.
        const daemonSrc = path.resolve(__dirname, 'daemon.js');
        if (fs.existsSync(daemonSrc)) {
            args.push('-v', `${daemonSrc}:/app/daemon.js:ro`);
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

        const startCode = await dockerRun(args, 'BrowserDaemon');
        if (startCode !== 0) throw new Error(`Failed to start browser daemon (exit ${startCode})`);

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
        await dockerRun(['rm', '-f', BROWSER_DAEMON_CONTAINER_NAME]);
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
     * The image pre-installs the playwright npm package so the container
     * starts instantly without needing network access at runtime.
     */
    private static async ensureImageBuilt(): Promise<string> {
        const tag = imageTag();

        const inspectCode = await dockerRun(['image', 'inspect', tag]);
        if (inspectCode === 0) return tag;

        const version = playwrightVersion() || '1.58.0';
        logger.info(`Building browser image ${tag} (first time only)...`, 'BrowserManager');

        const contextDir = __dirname;
        const buildCode = await dockerRun([
            'build', '-t', tag,
            '--build-arg', `PW_VERSION=${version}`,
            contextDir,
        ], 'BrowserBuild');

        if (buildCode !== 0) throw new Error(`Browser image build failed (exit ${buildCode})`);
        return tag;
    }
}
