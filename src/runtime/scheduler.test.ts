import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskScheduler } from './scheduler.js';

// Mock file system
vi.mock('node:fs/promises', () => ({
    readFile: vi.fn().mockResolvedValue('{"tasks":[]}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', () => ({
    existsSync: vi.fn().mockReturnValue(false),
}));

// Mock logger to suppress output
vi.mock('../infra/logger.js', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
    },
}));

describe('TaskScheduler', () => {
    let scheduler: TaskScheduler;

    beforeEach(async () => {
        vi.clearAllMocks();
        scheduler = new TaskScheduler('/tmp/test-data', { pollInterval: 60000 });
        await scheduler.init();
    });

    describe('addTask', () => {
        it('creates a task with generated id and timestamps', async () => {
            const task = await scheduler.addTask({
                name: 'Test Task',
                prompt: 'do something',
                scheduleType: 'interval',
                scheduleValue: '60000',
                status: 'active',
            });

            expect(task.id).toMatch(/^task_/);
            expect(task.name).toBe('Test Task');
            expect(task.prompt).toBe('do something');
            expect(task.createdAt).toBeTruthy();
            expect(task.lastRun).toBeNull();
            expect(task.lastResult).toBeNull();
        });

        it('calculates nextRun for interval tasks', async () => {
            const task = await scheduler.addTask({
                name: 'Interval Task',
                prompt: 'repeat',
                scheduleType: 'interval',
                scheduleValue: '3600000',
                status: 'active',
            });

            expect(task.nextRun).toBeTruthy();
            const nextRun = new Date(task.nextRun!);
            expect(nextRun.getTime()).toBeGreaterThan(Date.now());
        });

        it('calculates nextRun for cron tasks', async () => {
            const task = await scheduler.addTask({
                name: 'Cron Task',
                prompt: 'daily check',
                scheduleType: 'cron',
                scheduleValue: '0 9 * * *',
                status: 'active',
            });

            expect(task.nextRun).toBeTruthy();
        });

        it('sets nextRun to scheduleValue for once tasks', async () => {
            const futureDate = new Date(Date.now() + 86400000).toISOString();
            const task = await scheduler.addTask({
                name: 'One-time Task',
                prompt: 'do once',
                scheduleType: 'once',
                scheduleValue: futureDate,
                status: 'active',
            });

            expect(task.nextRun).toBe(futureDate);
        });
    });

    describe('getAllTasks', () => {
        it('returns all added tasks', async () => {
            await scheduler.addTask({
                name: 'Task A',
                prompt: 'a',
                scheduleType: 'interval',
                scheduleValue: '1000',
                status: 'active',
            });
            await scheduler.addTask({
                name: 'Task B',
                prompt: 'b',
                scheduleType: 'interval',
                scheduleValue: '2000',
                status: 'active',
            });

            const tasks = scheduler.getAllTasks();
            expect(tasks).toHaveLength(2);
        });
    });

    describe('removeTask', () => {
        it('removes an existing task', async () => {
            const task = await scheduler.addTask({
                name: 'To Remove',
                prompt: 'bye',
                scheduleType: 'interval',
                scheduleValue: '1000',
                status: 'active',
            });

            const removed = await scheduler.removeTask(task.id);
            expect(removed).toBe(true);
            expect(scheduler.getAllTasks()).toHaveLength(0);
        });

        it('returns false for non-existent task', async () => {
            const removed = await scheduler.removeTask('fake_id');
            expect(removed).toBe(false);
        });
    });

    describe('pauseTask / resumeTask', () => {
        it('pauses an active task', async () => {
            const task = await scheduler.addTask({
                name: 'Pausable',
                prompt: 'run',
                scheduleType: 'interval',
                scheduleValue: '1000',
                status: 'active',
            });

            const paused = await scheduler.pauseTask(task.id);
            expect(paused).toBe(true);

            const tasks = scheduler.getAllTasks();
            expect(tasks[0].status).toBe('paused');
        });

        it('resumes a paused task', async () => {
            const task = await scheduler.addTask({
                name: 'Resumable',
                prompt: 'run',
                scheduleType: 'interval',
                scheduleValue: '1000',
                status: 'active',
            });

            await scheduler.pauseTask(task.id);
            const resumed = await scheduler.resumeTask(task.id);
            expect(resumed).toBe(true);

            const tasks = scheduler.getAllTasks();
            expect(tasks[0].status).toBe('active');
        });

        it('returns false when pausing non-existent task', async () => {
            const result = await scheduler.pauseTask('fake_id');
            expect(result).toBe(false);
        });
    });

    describe('getDueTasks', () => {
        it('returns tasks whose nextRun is in the past', async () => {
            const pastDate = new Date(Date.now() - 60000).toISOString();
            await scheduler.addTask({
                name: 'Overdue',
                prompt: 'run now',
                scheduleType: 'once',
                scheduleValue: pastDate,
                status: 'active',
            });

            const due = scheduler.getDueTasks();
            expect(due).toHaveLength(1);
            expect(due[0].name).toBe('Overdue');
        });

        it('excludes paused tasks', async () => {
            const pastDate = new Date(Date.now() - 60000).toISOString();
            const task = await scheduler.addTask({
                name: 'Paused Overdue',
                prompt: 'skip',
                scheduleType: 'once',
                scheduleValue: pastDate,
                status: 'active',
            });

            await scheduler.pauseTask(task.id);
            const due = scheduler.getDueTasks();
            expect(due).toHaveLength(0);
        });

        it('excludes future tasks', async () => {
            const futureDate = new Date(Date.now() + 86400000).toISOString();
            await scheduler.addTask({
                name: 'Future',
                prompt: 'later',
                scheduleType: 'once',
                scheduleValue: futureDate,
                status: 'active',
            });

            const due = scheduler.getDueTasks();
            expect(due).toHaveLength(0);
        });
    });
});
