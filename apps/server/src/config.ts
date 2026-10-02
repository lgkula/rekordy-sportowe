import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

/**
 * The app root is the process working directory:
 * - production (Passenger): the application root set in the hosting panel,
 * - SSH maintenance commands: run from the application root,
 * - local development: `apps/server`.
 */
export const appRoot = process.cwd();

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  WEB_DIR: z.string().default('dist/web'),
  MIGRATIONS_DIR: z.string().default('drizzle'),
  STORAGE_DIR: z.string().default('storage'),
});

export type Config = {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  logLevel: z.infer<typeof configSchema>['LOG_LEVEL'];
  db: { host: string; port: number; user: string; password: string; database: string };
  webDir: string;
  migrationsDir: string;
  storageDir: string;
};

/**
 * Reads `.env` (path from `ENV_FILE` or `<appRoot>/.env`) without overriding variables
 * that are already set in the environment (e.g. by the hosting panel).
 */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): void {
  const file = env.ENV_FILE ?? path.join(appRoot, '.env');
  if (!existsSync(file)) return;
  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined && value !== undefined) env[key] = value;
  }
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const e = result.data;
  const resolve = (p: string) => path.resolve(appRoot, p);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      database: e.DB_NAME,
    },
    webDir: resolve(e.WEB_DIR),
    migrationsDir: resolve(e.MIGRATIONS_DIR),
    storageDir: resolve(e.STORAGE_DIR),
  };
}

export function loadConfig(): Config {
  loadEnvFile();
  return parseConfig(process.env);
}
