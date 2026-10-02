import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

const rootPackage = JSON.parse(readFileSync('../../package.json', 'utf8')) as { version: string };

/**
 * Self-contained CommonJS bundles: every runtime dependency is inlined, so the host needs
 * no node_modules and no `npm install` (PLAN.md section 3.2).
 */
export default defineConfig({
  entry: { server: 'src/server.ts', tools: 'src/tools.ts' },
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  noExternal: [/.*/],
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  outExtension: () => ({ js: '.cjs' }),
  define: {
    __APP_VERSION__: JSON.stringify(`${rootPackage.version}+${gitSha()}`),
  },
});
