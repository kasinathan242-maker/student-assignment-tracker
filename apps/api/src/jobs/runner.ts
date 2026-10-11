import { hostname } from 'node:os';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { WorkerHeartbeat } from '../models';
import { drainOutbox } from '../services/outbox';
import { registerHandlers } from './handlers';
import {
  cleanupOrphanFiles,
  closeExpiredAssignments,
  expireInvitations,
  publishScheduledAnnouncements,
  publishScheduledAssignments,
  retryFileScans,
  sendDeadlineReminders,
} from './scheduled';

interface Job {
  name: string;
  intervalMs: number;
  run: () => Promise<number>;
}

/**
 * In-process scheduler for the worker. Each job runs on its own interval, never overlaps with itself,
 * and records its last run/error in the heartbeat document used by health checks. All jobs are safe to
 * run concurrently in several worker processes (see jobs/scheduled.ts).
 */
export class JobRunner {
  private timers: NodeJS.Timeout[] = [];
  private running = new Map<string, Promise<void>>();
  private stopped = false;
  private readonly id = `${hostname()}:${process.pid}`;
  private readonly status: Record<string, { lastRunAt: Date | null; lastError: string | null }> = {};

  constructor(private readonly jobs: Job[]) {}

  start(): void {
    registerHandlers();
    for (const job of this.jobs) {
      this.status[job.name] = { lastRunAt: null, lastError: null };
      const tick = () => {
        if (this.stopped || this.running.has(job.name)) return;
        const p = job
          .run()
          .then((n) => {
            this.status[job.name] = { lastRunAt: new Date(), lastError: null };
            if (n > 0) logger().info({ job: job.name, processed: n }, 'job completed');
          })
          .catch((err: unknown) => {
            this.status[job.name] = {
              lastRunAt: new Date(),
              lastError: err instanceof Error ? err.message : String(err),
            };
            logger().error({ err, job: job.name }, 'job failed');
          })
          .finally(() => this.running.delete(job.name));
        this.running.set(job.name, p);
      };
      this.timers.push(setInterval(tick, job.intervalMs));
      setTimeout(tick, 1_000).unref();
    }
    const beat = () =>
      WorkerHeartbeat.updateOne(
        { _id: this.id },
        { $set: { lastBeatAt: new Date(), jobs: this.status } },
        { upsert: true },
      ).catch((err: unknown) => logger().warn({ err }, 'heartbeat failed'));
    this.timers.push(setInterval(beat, 15_000));
    void beat();
    logger().info({ jobs: this.jobs.map((j) => j.name) }, 'worker started');
  }

  /** Stops scheduling and waits (bounded) for in-flight jobs; unfinished outbox events are reclaimed later. */
  async stop(timeoutMs = 20_000): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    await Promise.race([
      Promise.allSettled([...this.running.values()]),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
    await WorkerHeartbeat.deleteOne({ _id: this.id }).catch(() => undefined);
    logger().info('worker stopped');
  }
}

export function defaultJobs(): Job[] {
  const poll = env().WORKER_POLL_MS;
  const schedule = env().SCHEDULER_INTERVAL_MS;
  return [
    { name: 'outbox', intervalMs: poll, run: () => drainOutbox(200) },
    { name: 'publish-scheduled-assignments', intervalMs: schedule, run: () => publishScheduledAssignments() },
    { name: 'close-expired-assignments', intervalMs: schedule, run: () => closeExpiredAssignments() },
    {
      name: 'publish-scheduled-announcements',
      intervalMs: schedule,
      run: () => publishScheduledAnnouncements(),
    },
    { name: 'deadline-reminders', intervalMs: schedule, run: () => sendDeadlineReminders() },
    { name: 'expire-invitations', intervalMs: 3_600_000, run: () => expireInvitations() },
    { name: 'cleanup-orphan-files', intervalMs: 3_600_000, run: () => cleanupOrphanFiles() },
    { name: 'retry-file-scans', intervalMs: 300_000, run: () => retryFileScans() },
  ];
}
