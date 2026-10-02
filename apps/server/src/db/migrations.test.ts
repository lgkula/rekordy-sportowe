import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMigrationStatus } from './migrations';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'rekordy-migrations-'));
  mkdirSync(path.join(dir, 'meta'));
  writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({
      entries: [
        { idx: 0, when: 1000, tag: '0000_init' },
        { idx: 1, when: 2000, tag: '0001_next' },
      ],
    }),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('getMigrationStatus', () => {
  it('treats everything as pending when the migrations table is missing', async () => {
    const query = async () => {
      throw Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' });
    };
    expect(await getMigrationStatus(query, dir)).toEqual({
      total: 2,
      applied: 0,
      pending: ['0000_init', '0001_next'],
    });
  });

  it('lists migrations newer than the last applied one', async () => {
    const query = async () => [{ last: '1000' }];
    expect(await getMigrationStatus(query, dir)).toEqual({
      total: 2,
      applied: 1,
      pending: ['0001_next'],
    });
  });

  it('reports nothing pending when up to date', async () => {
    const query = async () => [{ last: 2000 }];
    expect((await getMigrationStatus(query, dir)).pending).toEqual([]);
  });

  it('rethrows unexpected database errors', async () => {
    const query = async () => {
      throw Object.assign(new Error('denied'), { code: 'ER_ACCESS_DENIED_ERROR' });
    };
    await expect(getMigrationStatus(query, dir)).rejects.toThrow('denied');
  });
});
