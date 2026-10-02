import { describe, expect, it } from 'vitest';
import { quoteEnvValue, readEnvValues, updateEnvContent } from './envFile';

describe('updateEnvContent', () => {
  it('replaces existing keys in place and keeps everything else', () => {
    const content = [
      '# comment',
      'DB_USER=u',
      "DB_PASSWORD='p#ss'",
      'EDITOR_PASSWORD_HASH=old',
      'LOG_LEVEL=info',
      '',
    ].join('\n');
    const updated = updateEnvContent(content, { EDITOR_PASSWORD_HASH: 'scrypt:1:2:3:a:b' });
    expect(updated).toBe(
      [
        '# comment',
        'DB_USER=u',
        "DB_PASSWORD='p#ss'",
        "EDITOR_PASSWORD_HASH='scrypt:1:2:3:a:b'",
        'LOG_LEVEL=info',
        '',
      ].join('\n'),
    );
  });

  it('appends missing keys after a blank line and removes duplicates', () => {
    const updated = updateEnvContent('A=1\nB=2\nA=3', { A: 'x', C: 'y' });
    expect(updated).toBe("A='x'\nB=2\n\nC='y'\n");
  });

  it('keeps CRLF line endings', () => {
    expect(updateEnvContent('A=1\r\nB=2\r\n', { B: 'z' })).toBe("A=1\r\nB='z'\r\n");
  });

  it('creates content from scratch', () => {
    expect(updateEnvContent('', { A: 'x' })).toBe("A='x'\n");
  });

  it('produces values that parse back unchanged', () => {
    const values = { SESSION_SECRET: 'a$b#c d', VIEWER_PASSWORD_HASH: 'scrypt:16384:8:1:x-_:y' };
    expect(readEnvValues(updateEnvContent('X=1\n', values))).toEqual({ X: '1', ...values });
  });

  it('refuses values that cannot be quoted safely', () => {
    expect(() => quoteEnvValue("it's")).toThrow();
    expect(() => quoteEnvValue('a\nb')).toThrow();
  });
});
