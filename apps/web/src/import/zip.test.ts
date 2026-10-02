import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractFitFiles, isZipName } from './zip';

const fit = (size: number, fill = 1) => new Uint8Array(size).fill(fill);
const LIMIT = 1000;

describe('extractFitFiles', () => {
  it('unpacks a Garmin Connect "export original" archive', () => {
    const zip = zipSync({ '24361800117_ACTIVITY.fit': fit(500) });
    const result = extractFitFiles(zip, LIMIT);
    expect(result).toEqual({
      ok: true,
      files: [{ name: '24361800117_ACTIVITY.fit', bytes: fit(500) }],
      tooLarge: [],
    });
  });

  it('takes FIT files from any folder and skips everything else', () => {
    const zip = zipSync({
      'b/2_ACTIVITY.FIT': fit(10, 2),
      'a/1_ACTIVITY.fit': [fit(10, 1), { level: 0 }],
      'readme.txt': new TextEncoder().encode('x'),
      '__MACOSX/a/._1_ACTIVITY.fit': fit(4),
      '.hidden.fit': fit(4),
    });
    const result = extractFitFiles(zip, LIMIT);
    expect(result.ok && result.files.map((f) => [f.name, f.bytes[0]])).toEqual([
      ['1_ACTIVITY.fit', 1],
      ['2_ACTIVITY.FIT', 2],
    ]);
  });

  it('leaves FIT files over the limit in the archive', () => {
    const zip = zipSync({ 'small.fit': fit(10), 'big.fit': fit(LIMIT + 1) });
    expect(extractFitFiles(zip, LIMIT)).toMatchObject({
      ok: true,
      files: [{ name: 'small.fit' }],
      tooLarge: ['big.fit'],
    });
  });

  it('reports an archive without FIT files', () => {
    const zip = zipSync({ 'notes.txt': new TextEncoder().encode('x') });
    expect(extractFitFiles(zip, LIMIT)).toEqual({ ok: false, error: 'zip_no_fit' });
  });

  it('reports a damaged archive', () => {
    expect(extractFitFiles(new TextEncoder().encode('not a zip'), LIMIT)).toEqual({
      ok: false,
      error: 'zip_corrupt',
    });
    const zip = zipSync({ 'a.fit': fit(500) });
    expect(extractFitFiles(zip.slice(0, zip.length - 30), LIMIT)).toMatchObject({ ok: false });
  });

  it('recognises archive names', () => {
    expect(isZipName('24361800117.zip')).toBe(true);
    expect(isZipName('EXPORT.ZIP')).toBe(true);
    expect(isZipName('a.fit')).toBe(false);
  });
});
