import type { Config } from './config.js';
import type { Orchestrator } from './core/orchestrator.js';
import { logger } from './logger.js';

/**
 * Periodic sync loop.
 *
 * Uses a self-rescheduling timer rather than `setInterval` so a pass that
 * runs long cannot overlap the next one, and so a failure backs off instead
 * of hammering a provider that is already unhappy.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private consecutiveFailures = 0;

  constructor(
    private readonly config: Config,
    private readonly orchestrator: Orchestrator,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info({ intervalSeconds: this.config.pollIntervalSeconds }, 'scheduler started');
    // Sync immediately so a restart picks up anything missed while down.
    this.scheduleNext(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info('scheduler stopped');
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    // Do not hold the process open purely for the next poll.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;

    try {
      const results = await this.orchestrator.syncAll('poll');
      const failed = results.filter((r) => !r.ok).length;
      this.consecutiveFailures = failed > 0 ? this.consecutiveFailures + 1 : 0;
    } catch (err) {
      this.consecutiveFailures += 1;
      logger.error({ err: (err as Error).message }, 'scheduled sync failed');
    }

    this.scheduleNext(this.nextDelayMs());
  }

  /**
   * Exponential backoff on repeated failure, capped at 30 minutes, with
   * jitter so several instances or a restart storm do not synchronise.
   */
  private nextDelayMs(): number {
    const base = this.config.pollIntervalSeconds * 1000;
    if (this.consecutiveFailures === 0) {
      return base + Math.random() * 1000;
    }
    const backoff = Math.min(base * 2 ** Math.min(this.consecutiveFailures, 5), 30 * 60 * 1000);
    logger.warn({ consecutiveFailures: this.consecutiveFailures, nextInMs: backoff }, 'backing off after failures');
    return backoff + Math.random() * 5000;
  }
}
