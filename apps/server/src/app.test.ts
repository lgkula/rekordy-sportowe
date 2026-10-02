import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { HealthDeps, HealthResponse } from './routes/health';

const healthy: HealthDeps = {
  checkDb: async () => {},
  migrationStatus: async () => ({ total: 1, applied: 1, pending: [] }),
  checkStorage: async () => true,
};

let webDir: string;

beforeAll(() => {
  webDir = mkdtempSync(path.join(tmpdir(), 'rekordy-web-'));
  writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Rekordy</title>');
  mkdirSync(path.join(webDir, 'assets'));
  writeFileSync(path.join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
});

afterAll(() => {
  rmSync(webDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('returns 200 and ok when all checks pass', async () => {
    const app = await buildApp({ webDir, health: healthy });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    const body = res.json<HealthResponse>();
    expect(body.status).toBe('ok');
    expect(body.db.ok).toBe(true);
    expect(body.migrations).toEqual({ ok: true, applied: 1, pending: [] });
    expect(body.storage.writable).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 503 when the database is unreachable', async () => {
    const app = await buildApp({
      webDir,
      health: {
        ...healthy,
        checkDb: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
    });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    const body = res.json<HealthResponse>();
    expect(body.status).toBe('degraded');
    expect(body.db).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
    expect(body.migrations.ok).toBe(false);
  });

  it('returns 503 when migrations are pending', async () => {
    const app = await buildApp({
      webDir,
      health: {
        ...healthy,
        migrationStatus: async () => ({ total: 2, applied: 1, pending: ['0001_next'] }),
      },
    });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
    expect(res.json<HealthResponse>().migrations.pending).toEqual(['0001_next']);
  });

  it('returns 503 when storage is not writable', async () => {
    const app = await buildApp({ webDir, health: { ...healthy, checkStorage: async () => false } });
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(503);
  });
});

describe('SPA serving', () => {
  it('serves index.html for client-side routes', async () => {
    const app = await buildApp({ webDir, health: healthy });
    const res = await app.inject('/records');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Rekordy</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('answers HEAD requests for client-side routes', async () => {
    const app = await buildApp({ webDir, health: healthy });
    const res = await app.inject({ method: 'HEAD', url: '/races' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets with long-term caching', async () => {
    const app = await buildApp({ webDir, health: healthy });
    const res = await app.inject('/assets/app-abc123.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const app = await buildApp({ webDir, health: healthy });
    const res = await app.inject('/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Nie znaleziono' });
  });

  it('returns 404 for non-GET requests outside the API', async () => {
    const app = await buildApp({ webDir, health: healthy });
    const res = await app.inject({ method: 'POST', url: '/records' });
    expect(res.statusCode).toBe(404);
  });

  it('works without a built web app (API only)', async () => {
    const app = await buildApp({ webDir: path.join(webDir, 'missing'), health: healthy });
    expect((await app.inject('/records')).statusCode).toBe(404);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });
});
