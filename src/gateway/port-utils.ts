/**
 * Port conflict detection and resolution utilities for the gateway.
 */

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createConnection } from 'node:net';

/**
 * Check if a port is in use by attempting to connect to it.
 */
export async function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = createConnection({ port, host: '127.0.0.1' });
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => {
            resolve(false);
        });
    });
}

/**
 * Find PID using the port (Linux/macOS compatible).
 */
export function findPidOnPort(port: number): number | null {
    try {
        const safePort = Math.floor(Number(port));
        if (isNaN(safePort) || safePort < 1 || safePort > 65535) return null;

        const output = execSync(
            `lsof -ti :${safePort} 2>/dev/null || ss -tlnp 2>/dev/null | grep :${safePort} | sed 's/.*pid=\\([0-9]*\\).*/\\1/'`,
            { encoding: 'utf-8' }
        );
        const pid = parseInt(output.trim().split('\n')[0], 10);
        return isNaN(pid) ? null : pid;
    } catch {
        return null;
    }
}

/**
 * Ask user a yes/no question via stdin.
 */
export async function askConfirm(question: string): Promise<boolean> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase().startsWith('y'));
        });
    });
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number): boolean {
    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch {
        return false;
    }
}
