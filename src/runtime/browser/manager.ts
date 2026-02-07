/**
 * BrowserManager — manages the lifecycle of the persistent Playwright
 * daemon container: image build, container start/stop, health checks.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import {
    BROWSER_DAEMON_PORT,
    BROWSER_DAEMON_CONTAINER_NAME,
    BROWSER_DAEMON_HEALTH_URL,
    BROWSER_IMAGE_PREFIX,
} from './constants.js';

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
        child.stdout.on('data', logTag ? d => logger.debug(`${d}`, logTag) : () => {});
        child.stderr.on('data', logTag ? d => logger.debug(`${d}`, logTag) : () => {});
        child.on('error', () => resolve(1));
        child.on('close', code => resolve(code ?? 1));
    });
}

export class BrowserManager {
    /** Ensure the browser daemon container is running and healthy. */
    static async ensureRunning(): Promise<void> {
        if (await this.isHealthy()) return;

        // Remove any stale container before starting fresh
        await this.stop();

        const tag = await this.ensureImageBuilt();

        const profileDir = config.sandbox.profileDir;
        const previewsDir = path.join(process.cwd(), '.moose/data', 'browser-previews');
        fs.mkdirSync(profileDir, { recursive: true });
        fs.mkdirSync(previewsDir, { recursive: true });

        logger.info('Starting Browser Daemon...', 'BrowserManager');

        const args = [
            'run', '-d', '--rm',
            '--name', BROWSER_DAEMON_CONTAINER_NAME,
            '-p', `${BROWSER_DAEMON_PORT}:${BROWSER_DAEMON_PORT}`,
            '--ipc=host',
            '-e', `PORT=${BROWSER_DAEMON_PORT}`,
            // Daemon script (read-only bind mount for dev iteration)
            '-v', `${path.join(process.cwd(), 'src/runtime/browser/daemon.js')}:/app/daemon.js:ro`,
            // Browser profiles
            '-v', `${profileDir}:/root/.config/google-chrome`,
            '-v', `${profileDir}:/root/.mozilla`,
            // Screenshots
            '-v', `${previewsDir}:/app/previews`,
            '--cap-add', 'SYS_ADMIN',
            tag,
            'node', 'daemon.js',
        ];

        const startCode = await dockerRun(args, 'BrowserDaemon');
        if (startCode !== 0) throw new Error(`Failed to start browser daemon (exit ${startCode})`);

        await this.waitForHealthy();
    }

    /** Stop and remove the daemon container. */
    static async stop(): Promise<void> {
        await dockerRun(['rm', '-f', BROWSER_DAEMON_CONTAINER_NAME]);
    }

    /** Check if the daemon is reachable and healthy. */
    private static async isHealthy(): Promise<boolean> {
        try {
            const res = await fetch(BROWSER_DAEMON_HEALTH_URL);
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

        const contextDir = path.join(process.cwd(), 'src/runtime/browser');
        const buildCode = await dockerRun([
            'build', '-t', tag,
            '--build-arg', `PW_VERSION=${version}`,
            contextDir,
        ], 'BrowserBuild');

        if (buildCode !== 0) throw new Error(`Browser image build failed (exit ${buildCode})`);
        return tag;
    }
}
