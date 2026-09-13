import { loadConfig, validateConfig } from './config.js';
import { closeDatabase, getDatabase } from './db/index.js';
import { createRepositories } from './db/repositories.js';
import { Orchestrator } from './core/orchestrator.js';
import { NotificationDispatcher } from './notify/dispatcher.js';
import { createProvider } from './providers/index.js';
import { Scheduler } from './scheduler.js';
import { createApp } from './server/app.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const problems = validateConfig(config);
  if (problems.length > 0) {
    for (const problem of problems) logger.error(problem);
    logger.fatal('configuration is invalid; refusing to start');
    process.exit(1);
  }

  const db = getDatabase();
  const repos = createRepositories(db);
  const provider = createProvider(config);
  const dispatcher = new NotificationDispatcher(config, repos);
  const orchestrator = new Orchestrator(config, repos, provider, dispatcher);
  const scheduler = new Scheduler(config, orchestrator);

  const app = createApp({ config, repos, provider, orchestrator, dispatcher });
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        provider: provider.name,
        channels: dispatcher.channels,
        webhookUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/webhooks/plaid` : '(poll-only: PUBLIC_BASE_URL unset)',
      },
      'finance-tracker listening',
    );
    if (repos.items.listAll().length === 0) {
      logger.info(`No banks connected yet — open http://localhost:${config.port}/link to add one`);
    }
  });

  scheduler.start();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    scheduler.stop();
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    // Do not let a hung connection block shutdown indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'startup failed');
  process.exit(1);
});
