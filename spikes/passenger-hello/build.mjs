// Bundles the Passenger spike into dist/server.cjs (all dependencies inlined) + app.js.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(dir, 'dist');
mkdirSync(path.join(out, 'dist'), { recursive: true });

await build({
  entryPoints: [path.join(dir, 'src', 'server.ts')],
  outfile: path.join(out, 'dist', 'server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'info',
});

copyFileSync(
  path.join(dir, '..', '..', 'apps', 'server', 'deploy', 'app.js'),
  path.join(out, 'app.js'),
);
// Without its own package.json, app.js would inherit "type": "module" from a parent folder.
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify({ name: 'rekordy-sportowe-spike', private: true, main: 'app.js' }, null, 2)}\n`,
);
console.log(`Spike ready in ${out} (upload app.js + dist/ to the app root)`);
