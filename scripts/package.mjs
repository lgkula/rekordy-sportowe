// Assembles the self-contained deploy artifact:
//   deploy/rekordy-sportowe/        (app.js, package.json, dist/, drizzle/, ...)
//   deploy/rekordy-sportowe.tar.gz  (uploaded by scripts/deploy.mjs)
// Usage: npm run package [-- --no-build]
import { execSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deployDir = path.join(root, 'deploy');
const name = 'rekordy-sportowe';
const out = path.join(deployDir, name);
const archive = `${name}.tar.gz`;

function run(command) {
  execSync(command, { cwd: root, stdio: 'inherit' });
}

function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

function gitDirty() {
  try {
    return (
      execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim().length > 0
    );
  } catch {
    return false;
  }
}

if (!process.argv.includes('--no-build')) run('npm run build');

const server = path.join(root, 'apps', 'server');
const web = path.join(root, 'apps', 'web', 'dist');
for (const required of [path.join(server, 'dist', 'server.cjs'), path.join(web, 'index.html')]) {
  if (!existsSync(required)) throw new Error(`Missing build output: ${required}`);
}

rmSync(deployDir, { recursive: true, force: true });
mkdirSync(path.join(out, 'dist'), { recursive: true });

cpSync(path.join(server, 'dist'), path.join(out, 'dist'), { recursive: true });
cpSync(web, path.join(out, 'dist', 'web'), { recursive: true });
cpSync(path.join(server, 'drizzle'), path.join(out, 'drizzle'), { recursive: true });
cpSync(path.join(server, 'deploy', 'app.js'), path.join(out, 'app.js'));
cpSync(path.join(server, '.env.example'), path.join(out, '.env.example'));

const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
// No "type" field: app.js must be loaded as CommonJS by Passenger.
// No dependencies: everything is bundled into dist/*.cjs.
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify(
    {
      name,
      version: rootPackage.version,
      private: true,
      main: 'app.js',
      engines: rootPackage.engines,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(out, 'build-info.json'),
  `${JSON.stringify(
    {
      version: rootPackage.version,
      commit: gitSha(),
      dirty: gitDirty(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

// Relative paths only: GNU tar (Git Bash) misreads Windows drive letters as remote hosts.
const tar = spawnSync('tar', ['-czf', archive, '-C', name, '.'], {
  cwd: deployDir,
  stdio: 'inherit',
});
if (tar.status !== 0) throw new Error('tar failed');

console.log(`\nArtifact: ${path.join(deployDir, archive)}`);
