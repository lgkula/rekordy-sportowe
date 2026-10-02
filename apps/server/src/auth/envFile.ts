import { parseEnv } from 'node:util';

/** Values we write never contain `'`, so single quotes keep `#`, `$` and spaces literal. */
export function quoteEnvValue(value: string): string {
  if (value.includes("'") || /[\r\n]/.test(value)) {
    throw new Error('Value cannot contain quotes or line breaks');
  }
  return `'${value}'`;
}

export function readEnvValues(content: string): Record<string, string | undefined> {
  return parseEnv(content);
}

/**
 * Sets `values` in `.env` content: the first existing `KEY=` line is replaced in place,
 * later duplicates are removed, missing keys are appended. Everything else is kept as is.
 */
export function updateEnvContent(content: string, values: Record<string, string>): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content === '' ? [] : content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const written = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (key === undefined || !(key in values)) {
      result.push(line);
    } else if (!written.has(key)) {
      result.push(`${key}=${quoteEnvValue(values[key]!)}`);
      written.add(key);
    }
  }

  const missing = Object.keys(values).filter((key) => !written.has(key));
  if (missing.length > 0) {
    if (result.length > 0 && result.at(-1) !== '') result.push('');
    for (const key of missing) result.push(`${key}=${quoteEnvValue(values[key]!)}`);
  }
  return result.join(eol) + eol;
}
