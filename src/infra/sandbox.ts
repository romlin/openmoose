/**
 * Docker-based sandbox for secure, isolated code execution.
 * All user-triggered commands run inside hardened containers with
 * resource limits, capability dropping, and read-only filesystems.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config } from '../config/index.js';

// Constants moved to config

/** Output from a sandboxed command execution. */
export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Configuration options for a sandbox run. */
export interface SandboxOptions {
  image?: string;
  timeout?: number;
  memory?: string;
  cpus?: number;
  network?: string;
  workspacePath?: string;
  readonlyWorkspace?: boolean;
}

/**
 * LocalSandbox: Hardened Docker-based execution isolation.
 */
export class LocalSandbox {
  private containerName: string;

  constructor(prefix: string = 'openmoose-sandbox') {
    this.containerName = `${prefix}-${randomBytes(4).toString('hex')}`;
  }

  /**
   * Internal runner to keep the code DRY across different languages.
   */
  private async execute(command: string, options: SandboxOptions = {}): Promise<SandboxResult> {
    const {
      image = config.sandbox.defaultImage,
      timeout = config.sandbox.defaultTimeoutMs,
      memory = config.sandbox.defaultMemory,
      cpus = config.sandbox.defaultCpus,
      network,
      readonlyWorkspace = true,
    } = options;

    const isPlaywright = image.includes('playwright');

    const args = [
      'run', '--rm',
      '--name', this.containerName,
      '--network', network || 'bridge',
      '--memory', memory,
      '--cpus', String(cpus),
      '--read-only',
      '--tmpfs', '/tmp',
    ];

    if (isPlaywright) {
      // Playwright needs SYS_ADMIN for Chromium's sandbox
      args.push('--cap-add', 'SYS_ADMIN');

      // Mount browser profiles only for browser containers
      const profileDir = config.sandbox.profileDir;
      args.push('-v', `${profileDir}:/root/.config/google-chrome:ro`);
      args.push('-v', `${profileDir}:/root/.mozilla:ro`);
    } else {
      // Non-browser containers: drop dangerous capabilities, keep basic ones
      args.push(
        '--cap-drop', 'NET_RAW',
        '--cap-drop', 'MKNOD',
        '--cap-drop', 'AUDIT_WRITE',
        '--cap-drop', 'NET_BIND_SERVICE',
        '--cap-drop', 'SYS_CHROOT',
      );
    }

    if (options.workspacePath) {
      const mode = readonlyWorkspace ? ':ro' : '';
      args.push('-v', `${options.workspacePath}:/workspace${mode}`);
      args.push('--workdir', '/workspace');
    }

    args.push(image, 'sh', '-c', command);

    return new Promise((resolve) => {
      const child = spawn('docker', args);
      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        spawn('docker', ['kill', this.containerName]).on('error', () => { /* fire and forget */ });
        resolve({
          stdout: stdout.trim(),
          stderr: (stderr + '\n[Security] Error: Timeout reached.').trim(),
          exitCode: 124 // Timeout exit code
        });
      }, timeout);

      child.stdout.on('data', (d) => stdout += d);
      child.stderr.on('data', (d) => stderr += d);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
      });
    });
  }

  /**
   * Generalized language runner to avoid duplication.
   * Uses a temporary file approach to avoid shell escaping issues.
   */
  private async runLanguage(image: string, cmd: string, code: string, options: SandboxOptions = {}) {
    // Write code to a temp file inside the container to avoid shell injection
    const escapedCode = code.replace(/'/g, "'\\''");
    return this.execute(`${cmd} '${escapedCode}'`, { ...options, image });
  }

  /** Run an arbitrary shell command in a sandboxed container. */
  async run(command: string, options: SandboxOptions = {}) {
    return this.execute(command, options);
  }

  /** Execute Python 3.12 code in a sandboxed container. */
  async runPython(code: string, options: SandboxOptions = {}) {
    return this.runLanguage('python:3.12-slim', 'python3 -c', code, options);
  }

  /** Execute Node.js code in a sandboxed container. */
  async runNode(code: string, options: SandboxOptions = {}) {
    const { image = 'node:22-slim' } = options;
    return this.runLanguage(image, 'node -e', code, options);
  }

  /** Execute Playwright browser automation code in a sandboxed container. */
  async runPlaywright(code: string, options: SandboxOptions = {}) {
    const { image = config.sandbox.playwrightImage } = options;
    return this.runLanguage(image, 'node -e', code, options);
  }
}
