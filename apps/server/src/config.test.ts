import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRoot, loadEnvFile, parseConfig } from './config';

describe('parseConfig', () => {
  it('applies defaults and resolves paths against the app root', () => {
    const config = parseConfig({ DB_USER: 'u', DB_NAME: 'n' });
    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.db).toEqual({
      host: 'localhost',
      port: 3306,
      user: 'u',
      password: '',
      database: 'n',
    });
    expect(config.webDir).toBe(path.resolve(appRoot, 'dist/web'));
    expect(config.migrationsDir).toBe(path.resolve(appRoot, 'drizzle'));
  });

  it('coerces numeric values', () => {
    const config = parseConfig({ DB_USER: 'u', DB_NAME: 'n', PORT: '8080', DB_PORT: '3307' });
    expect(config.port).toBe(8080);
    expect(config.db.port).toBe(3307);
  });

  it('reports missing required variables', () => {
    expect(() => parseConfig({})).toThrow(/DB_USER/);
  });
});

describe('loadEnvFile', () => {
  it('reads values without overriding existing environment variables', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rekordy-env-'));
    try {
      const file = path.join(dir, '.env');
      writeFileSync(
        file,
        'DB_NAME=from_file\nNODE_ENV=development\n# comment\nDB_PASSWORD="p#ss"\n',
      );
      const env: NodeJS.ProcessEnv = { ENV_FILE: file, NODE_ENV: 'production' };
      loadEnvFile(env);
      expect(env.DB_NAME).toBe('from_file');
      expect(env.NODE_ENV).toBe('production');
      expect(env.DB_PASSWORD).toBe('p#ss');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when the file does not exist', () => {
    const env: NodeJS.ProcessEnv = { ENV_FILE: path.join(tmpdir(), 'no-such-file.env') };
    loadEnvFile(env);
    expect(Object.keys(env)).toEqual(['ENV_FILE']);
  });
});
