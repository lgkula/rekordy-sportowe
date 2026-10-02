// Deploys to Seohost: build + package -> scp -> (over SSH) unpack, migrate, restart -> health check.
// Runs locally or in GitHub Actions. It never starts the Node process on the host by hand:
// the restart goes through the hosting panel's Node.js selector (PLAN.md D7).
//
// Usage: npm run deploy [-- --skip-build]
// Environment (defaults in brackets):
//   DEPLOY_SSH_HOST  [seohost]                                 ssh alias from ~/.ssh/config
//   DEPLOY_APP_ROOT  [nodejsapp/rekordy-sportowe]              app root relative to $HOME
//   DEPLOY_NODE_BIN  [/opt/alt/alt-nodejs22/root/usr/bin/node] Node 22 on the host
//   DEPLOY_URL       [https://sport.kula.opole.pl]
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.DEPLOY_SSH_HOST ?? 'seohost';
const appRoot = process.env.DEPLOY_APP_ROOT ?? 'nodejsapp/rekordy-sportowe';
const nodeBin = process.env.DEPLOY_NODE_BIN ?? '/opt/alt/alt-nodejs22/root/usr/bin/node';
const url = (process.env.DEPLOY_URL ?? 'https://sport.kula.opole.pl').replace(/\/$/, '');
const remoteArchive = 'tmp/rekordy-sportowe-deploy.tar.gz';

function step(title) {
  console.log(`\n=== ${title}`);
}

function exec(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Version the server reports after this deploy (`<version>+<commit>`, as in /api/health). */
function expectedVersion() {
  const info = JSON.parse(
    readFileSync(path.join(root, 'deploy', 'rekordy-sportowe', 'build-info.json'), 'utf8'),
  );
  return `${info.version}+${info.commit}`;
}

/**
 * Waits until /api/health is ok AND reports the deployed version: right after the restart an
 * old process may still answer, which must not count as a successful deploy.
 */
async function waitForHealth(version, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      // The host's bot protection answers 429 to curl-like user agents; use an explicit one.
      const res = await fetch(`${url}/api/health`, {
        headers: { accept: 'application/json', 'user-agent': 'rekordy-sportowe-deploy/1.0' },
      });
      const text = await res.text();
      last = `HTTP ${res.status} ${text}`;
      if (res.ok) {
        let reported;
        try {
          reported = JSON.parse(text).version;
        } catch {
          reported = undefined;
        }
        if (reported === version) return text;
        last = `still version ${reported ?? '?'}, expected ${version}: ${text}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`Health check failed: ${last}`);
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    step('Build + package');
    execSync('node scripts/package.mjs', { cwd: root, stdio: 'inherit' });
  }

  step(`Upload to ${host}:${remoteArchive}`);
  exec('ssh', [host, 'mkdir -p tmp']);
  exec('scp', ['-q', path.join('deploy', 'rekordy-sportowe.tar.gz'), `${host}:${remoteArchive}`]);

  step('Install, migrate, restart (on the host)');
  const remoteScript = readFileSync(path.join(root, 'scripts', 'deploy-remote.sh'), 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  const envPrefix = [
    `APP_ROOT=${shellQuote(appRoot)}`,
    `NODE_BIN=${shellQuote(nodeBin)}`,
    `ARCHIVE=${shellQuote(remoteArchive)}`,
  ].join(' ');
  exec('ssh', [host, `${envPrefix} bash -s`], {
    input: remoteScript,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  const version = expectedVersion();
  step(`Health check ${url}/api/health (expecting ${version})`);
  console.log(await waitForHealth(version));
  console.log('\nDeploy OK');
}

main().catch((error) => {
  console.error(`\nDeploy FAILED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
