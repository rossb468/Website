import pino from 'pino';
import { loadConfig } from './config.js';

const level = process.env.NODE_ENV === 'test' ? 'silent' : loadConfig().logLevel;

export const logger = pino({
  level,
  // Pretty output for humans at a terminal; raw JSON when piped to a log
  // collector, which is what you want under a process manager.
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : undefined,
});

export type Logger = typeof logger;
