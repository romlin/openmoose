/**
 * Docker-based sandbox for secure, isolated code execution.
 * All user-triggered commands run inside hardened containers with
 * resource limits, capability dropping, and read-only filesystems.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config } from '../config/index.js';

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB cap

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
   * Internal wrapper for child_process.spawn that handles output buffering,
   * timeouts, and cleanup.
   */
  private async managedSpawn(
    binary: string,
    args: string[],
    options: {
      timeout: number;
      cwd?: string;
      code?: string;
      onTimeout?: () => void;
      errorPrefix?: string;
    }
  ): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const child = spawn(binary, args, {
        stdio: options.code ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'pipe', 'pipe'],
        cwd: options.cwd || process.cwd(),
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        if (options.onTimeout) {
          options.onTimeout();
        } else {
          child.kill();
        }
        resolve({
          stdout: stdout.trim(),
          stderr: (stderr + `\n${options.errorPrefix || '[Error]'} Timeout reached.`).trim(),
          exitCode: 124
        });
      }, options.timeout);

      if (options.code && child.stdin) {
        child.stdin.write(options.code);
        child.stdin.end();
      }

      child.stdout?.on('data', (d) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += d;
      });
      child.stderr?.on('data', (d) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += d;
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.trim(),
          stderr: (stderr + `\n${options.errorPrefix || '[Error]'} Spawn failed: ${err.message}`).trim(),
          exitCode: 1
        });
      });
    });
  }

  /**
   * Internal helper to generate common Docker CLI arguments.
   */
  private getCommonDockerArgs(options: SandboxOptions, interactive: boolean): string[] {
    const {
      image = config.sandbox.defaultImage,
      memory = config.sandbox.defaultMemory,
      cpus = config.sandbox.defaultCpus,
      network,
    } = options;

    const isPlaywright = image.includes('playwright');
    const args = [
      'run', '--rm',
      '--name', this.containerName,
      '--network', network || 'bridge',
      '--memory', memory,
      '--cpus', String(cpus),
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--user', '1000:1000',
      '--security-opt', 'no-new-privileges',
      '--pids-limit', '50',
      '--label', 'com.openmoose.app=true',
      '--label', 'com.openmoose.version=1',
      '--label', `com.openmoose.container_id=${this.containerName}`,
    ];

    if (interactive) {
      args.splice(2, 0, '--interactive');
    }

    if (isPlaywright) {
      args.push('--cap-add', 'SYS_ADMIN');
      const profileDir = config.sandbox.profileDir;
      args.push('-v', `${profileDir}:/root/.config/google-chrome:ro`, '-v', `${profileDir}:/root/.mozilla:ro`);
    } else {
      args.push('--cap-drop', 'NET_RAW', '--cap-drop', 'MKNOD', '--cap-drop', 'AUDIT_WRITE', '--cap-drop', 'NET_BIND_SERVICE', '--cap-drop', 'SYS_CHROOT');
    }

    if (options.workspacePath) {
      const mode = options.readonlyWorkspace !== false ? ':ro' : '';
      args.push('-v', `${options.workspacePath}:/workspace${mode}`);
      args.push('--workdir', '/workspace');
    }

    return args;
  }

  /**
   * Internal runner for shell commands.
   */
  private async execute(command: string, options: SandboxOptions = {}): Promise<SandboxResult> {
    const {
      image = config.sandbox.defaultImage,
      timeout = config.sandbox.defaultTimeoutMs,
    } = options;

    const args = [...this.getCommonDockerArgs(options, false), image, 'sh', '-c', command];

    return this.managedSpawn('docker', args, {
      timeout,
      errorPrefix: '[Security]',
      onTimeout: () => {
        spawn('docker', ['kill', this.containerName]).on('error', () => { });
      }
    });
  }

  /**
   * Generalized language runner using stdin to avoid shell escaping issues.
   */
  private async runLanguage(image: string, cmd: string, code: string, options: SandboxOptions = {}) {
    const { timeout = config.sandbox.defaultTimeoutMs } = options;
    const args = [...this.getCommonDockerArgs(options, true), image, 'sh', '-c', `${cmd} -`];

    return this.managedSpawn('docker', args, {
      timeout,
      code,
      errorPrefix: '[Security]',
      onTimeout: () => {
        spawn('docker', ['kill', this.containerName]).on('error', () => { });
      }
    });
  }


  /** Run an arbitrary shell command in a sandboxed container. */
  async run(command: string, options: SandboxOptions = {}) {
    return this.execute(command, options);
  }

  /** Execute Python code in a sandboxed container. */
  async runPython(code: string, options: SandboxOptions = {}) {
    return this.runLanguage('python:3.12-slim', 'python3', code, options);
  }

  /** Execute Node.js code in a sandboxed container. */
  async runNode(code: string, options: SandboxOptions = {}) {
    const { image = 'node:22-slim' } = options;
    return this.runLanguage(image, 'node', code, options);
  }

  /** Execute Playwright browser automation code in a sandboxed container. */
  async runPlaywright(code: string, options: SandboxOptions = {}) {
    const { image = config.sandbox.playwrightImage } = options;
    return this.runLanguage(image, 'node', code, options);
  }
}
