import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { appRoot } from '../config';
import { readEnvValues, updateEnvContent } from './envFile';
import { generateSessionSecret, generateToken, hashSecret } from './secrets';

const ITEMS = ['viewer', 'editor', 'agent', 'session'] as const;
type Item = (typeof ITEMS)[number];

export const DEFAULT_VIEWER_PASSWORD = 'lk';
export const MIN_EDITOR_PASSWORD_LENGTH = 12;

export const hashSecretUsage = `Usage: hash-secret [--only viewer,editor,agent,session] [--logout-all] [--write] [--env-file <path>]

Generates the auth secrets (PLAN.md 4.5) and prints them as .env lines.
  (no --only)     viewer + editor password, new agent token; SESSION_SECRET only if missing
  --only <list>   just these items (session = new SESSION_SECRET, logs everyone out)
  --logout-all    bump SESSION_SECRET_VERSION (invalidates every session)
  --write         update the .env file in place (other lines are kept, chmod 600)
  --env-file      .env path (default: ENV_FILE or <cwd>/.env)
Restart the app afterwards (panel or cloudlinux-selector restart).`;

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  // readline echoes typed characters to its output; drop them while muted.
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    process.exit(130);
  });
  try {
    process.stdout.write(question);
    muted = true;
    return await rl.question('');
  } finally {
    muted = false;
    rl.close();
    process.stdout.write('\n');
  }
}

async function askViewerPassword(): Promise<string> {
  const value = await promptHidden(
    `Viewer password (Enter = "${DEFAULT_VIEWER_PASSWORD}", input hidden): `,
  );
  return value === '' ? DEFAULT_VIEWER_PASSWORD : value;
}

async function askEditorPassword(viewerPassword: string | undefined): Promise<string> {
  for (;;) {
    const value = await promptHidden('Editor password (input hidden): ');
    if (value.length < MIN_EDITOR_PASSWORD_LENGTH) {
      console.log(`At least ${MIN_EDITOR_PASSWORD_LENGTH} characters, try again.`);
      continue;
    }
    if (value === viewerPassword) {
      console.log('Must differ from the viewer password, try again.');
      continue;
    }
    if ((await promptHidden('Repeat the editor password: ')) !== value) {
      console.log('The passwords do not match, try again.');
      continue;
    }
    return value;
  }
}

function parseItems(only: string | undefined): Item[] | null {
  if (only === undefined) return null;
  const items = only.split(',').map((item) => item.trim());
  const unknown = items.filter((item) => !(ITEMS as readonly string[]).includes(item));
  if (unknown.length > 0) throw new Error(`Unknown --only item(s): ${unknown.join(', ')}`);
  return items as Item[];
}

export async function runHashSecret(args: string[]): Promise<void> {
  const { values: flags } = parseArgs({
    args,
    options: {
      only: { type: 'string' },
      'logout-all': { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
      'env-file': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (flags.help) {
    console.log(hashSecretUsage);
    return;
  }

  const envFile = path.resolve(
    flags['env-file'] ?? process.env.ENV_FILE ?? path.join(appRoot, '.env'),
  );
  const content = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const current = readEnvValues(content);

  const explicit = parseItems(flags.only);
  let items: Item[];
  if (explicit) items = explicit;
  else if (flags['logout-all']) items = [];
  else
    items = ['viewer', 'editor', 'agent', ...(current.SESSION_SECRET ? [] : ['session' as const])];

  if ((items.includes('viewer') || items.includes('editor')) && !process.stdin.isTTY) {
    throw new Error('hash-secret needs an interactive terminal (over SSH use `ssh -t`).');
  }

  const values: Record<string, string> = {};
  let viewerPassword: string | undefined;
  let agentToken: string | undefined;

  if (items.includes('viewer')) {
    viewerPassword = await askViewerPassword();
    values.VIEWER_PASSWORD_HASH = await hashSecret(viewerPassword);
  }
  if (items.includes('editor')) {
    values.EDITOR_PASSWORD_HASH = await hashSecret(await askEditorPassword(viewerPassword));
  }
  if (items.includes('agent')) {
    agentToken = generateToken();
    values.AGENT_TOKEN_HASH = await hashSecret(agentToken);
  }
  if (items.includes('session')) {
    values.SESSION_SECRET = generateSessionSecret();
  }
  if (flags['logout-all']) {
    const version = Number(current.SESSION_SECRET_VERSION ?? 1);
    values.SESSION_SECRET_VERSION = String((Number.isSafeInteger(version) ? version : 1) + 1);
  }
  if (Object.keys(values).length === 0) {
    console.log(hashSecretUsage);
    return;
  }

  if (agentToken) {
    console.log(
      `\nAgent token (shown only once, put it into the Windows sync script):\n  ${agentToken}\n`,
    );
  }

  if (flags.write) {
    writeFileSync(envFile, updateEnvContent(content, values), { mode: 0o600 });
    chmodSync(envFile, 0o600);
    console.log(`Updated ${envFile}: ${Object.keys(values).join(', ')}`);
  } else {
    console.log('Add these lines to .env:\n');
    console.log(updateEnvContent('', values));
  }
  console.log('Restart the app so that it reads the new values.');
}
