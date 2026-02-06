/**
 * Task Scheduler for OpenMoose
 * Runs scheduled tasks using cron expressions or intervals
 */
import { CronExpressionParser } from 'cron-parser';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../infra/logger.js';

/** Persisted definition of a scheduled task. */
export interface ScheduledTask {
    id: string;
    name: string;
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;  // Cron expression or interval in ms
    status: 'active' | 'paused' | 'completed';
    nextRun: string | null;
    lastRun: string | null;
    lastResult: string | null;
    createdAt: string;
}

interface TaskStorage {
    tasks: ScheduledTask[];
}

/** Maximum length of stored task results to prevent unbounded growth. */
const MAX_RESULT_LENGTH = 500;

/**
 * Polling-based task scheduler supporting cron, interval, and one-time schedules.
 * Tasks are persisted to disk and survive gateway restarts.
 */
export class TaskScheduler {
    private tasks: Map<string, ScheduledTask> = new Map();
    private storagePath: string;
    private pollInterval: number;
    private running = false;
    private onTaskRun?: (task: ScheduledTask) => Promise<string>;
    private dataDir: string;

    constructor(
        dataDir: string,
        options: {
            pollInterval?: number;
            onTaskRun?: (task: ScheduledTask) => Promise<string>;
        } = {}
    ) {
        this.dataDir = dataDir;
        this.storagePath = join(dataDir, 'tasks.json');
        this.pollInterval = options.pollInterval || 60000;
        this.onTaskRun = options.onTaskRun;
    }

    async init(): Promise<void> {
        await mkdir(this.dataDir, { recursive: true });
        await this.loadTasks();
    }

    private async loadTasks(): Promise<void> {
        if (existsSync(this.storagePath)) {
            try {
                const content = await readFile(this.storagePath, 'utf-8');
                const data = JSON.parse(content) as TaskStorage;
                for (const task of data.tasks) {
                    this.tasks.set(task.id, task);
                }
                logger.debug(`Loaded ${this.tasks.size} tasks`, 'Scheduler');
            } catch (err) {
                logger.error('Failed to load tasks', 'Scheduler', err);
            }
        }
    }

    private async saveTasks(): Promise<void> {
        const data: TaskStorage = {
            tasks: Array.from(this.tasks.values())
        };
        try {
            await writeFile(this.storagePath, JSON.stringify(data, null, 2));
        } catch (err) {
            logger.error('Failed to save tasks', 'Scheduler', err);
        }
    }

    async addTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRun' | 'lastResult' | 'nextRun'>): Promise<ScheduledTask> {
        const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const fullTask: ScheduledTask = {
            ...task,
            id,
            createdAt: new Date().toISOString(),
            lastRun: null,
            lastResult: null,
            nextRun: null,
        };

        fullTask.nextRun = this.calculateNextRun(fullTask);

        this.tasks.set(id, fullTask);
        await this.saveTasks();
        logger.info(`Added task: ${task.name} (${id})`, 'Scheduler');
        return fullTask;
    }

    async removeTask(id: string): Promise<boolean> {
        const deleted = this.tasks.delete(id);
        if (deleted) {
            await this.saveTasks();
            logger.info(`Removed task: ${id}`, 'Scheduler');
        }
        return deleted;
    }

    async pauseTask(id: string): Promise<boolean> {
        const task = this.tasks.get(id);
        if (task) {
            task.status = 'paused';
            await this.saveTasks();
            logger.info(`Paused task: ${task.name}`, 'Scheduler');
            return true;
        }
        return false;
    }

    async resumeTask(id: string): Promise<boolean> {
        const task = this.tasks.get(id);
        if (task && task.status === 'paused') {
            task.status = 'active';
            task.nextRun = this.calculateNextRun(task);
            await this.saveTasks();
            logger.info(`Resumed task: ${task.name}`, 'Scheduler');
            return true;
        }
        return false;
    }

    getAllTasks(): ScheduledTask[] {
        return Array.from(this.tasks.values());
    }

    getDueTasks(): ScheduledTask[] {
        const now = new Date();
        return Array.from(this.tasks.values()).filter(task => {
            if (task.status !== 'active') return false;
            if (!task.nextRun) return false;
            return new Date(task.nextRun) <= now;
        });
    }

    private calculateNextRun(task: ScheduledTask): string | null {
        if (task.status === 'completed') return null;

        switch (task.scheduleType) {
            case 'cron': {
                try {
                    const interval = CronExpressionParser.parse(task.scheduleValue);
                    return interval.next().toISOString();
                } catch {
                    logger.error(`Invalid cron: ${task.scheduleValue}`, 'Scheduler');
                    return null;
                }
            }
            case 'interval': {
                const ms = parseInt(task.scheduleValue, 10);
                return new Date(Date.now() + ms).toISOString();
            }
            case 'once': {
                return task.lastRun ? null : task.scheduleValue;
            }
            default:
                return null;
        }
    }

    private async executeTask(task: ScheduledTask): Promise<void> {
        logger.info(`Executing task: ${task.name}`, 'Scheduler');
        const startTime = Date.now();

        try {
            let result = 'No handler configured';
            if (this.onTaskRun) {
                result = await this.onTaskRun(task);
            }

            task.lastRun = new Date().toISOString();
            task.lastResult = result.slice(0, MAX_RESULT_LENGTH);

            if (task.scheduleType === 'once') {
                task.status = 'completed';
                task.nextRun = null;
            } else {
                task.nextRun = this.calculateNextRun(task);
            }

            const duration = Date.now() - startTime;
            logger.success(`Task completed: ${task.name} (${duration}ms)`, 'Scheduler');
        } catch (err) {
            task.lastRun = new Date().toISOString();
            task.lastResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
            task.nextRun = this.calculateNextRun(task);
            logger.error(`Task failed: ${task.name}`, 'Scheduler', err);
        }

        await this.saveTasks();
    }

    start(): void {
        if (this.running) {
            logger.warn('Already running', 'Scheduler');
            return;
        }

        this.running = true;
        logger.info(`Started (poll every ${this.pollInterval}ms)`, 'Scheduler');

        const loop = async () => {
            if (!this.running) return;

            try {
                const dueTasks = this.getDueTasks();
                if (dueTasks.length > 0) {
                    logger.debug(`${dueTasks.length} task(s) due`, 'Scheduler');
                }

                for (const task of dueTasks) {
                    await this.executeTask(task);
                }
            } catch (err) {
                logger.error('Loop error', 'Scheduler', err);
            }

            setTimeout(loop, this.pollInterval);
        };

        loop();
    }

    stop(): void {
        this.running = false;
        logger.info('Stopped', 'Scheduler');
    }
}
