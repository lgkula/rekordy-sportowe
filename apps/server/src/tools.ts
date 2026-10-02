import { runHashSecret } from './auth/hashSecretCommand';
import { loadConfig } from './config';
import { runMigrations } from './db/migrations';

/**
 * Maintenance CLI, run over SSH from the application root:
 *   node dist/tools.cjs <command>
 * Locally: `npm run tools -w @rekordy/server -- <command>`.
 */
const commands: Record<string, { description: string; run: (args: string[]) => Promise<void> }> = {
  migrate: {
    description: 'Apply pending database migrations',
    run: async () => {
      const config = loadConfig();
      const status = await runMigrations(config);
      console.log(
        `Migrations: ${status.applied}/${status.total} applied` +
          (status.pending.length ? `, pending: ${status.pending.join(', ')}` : ''),
      );
      if (status.pending.length) process.exitCode = 1;
    },
  },
  'hash-secret': {
    description: 'Generate password hashes, agent token and session secret (--help)',
    run: runHashSecret,
  },
};

function printHelp(): void {
  console.log('Usage: node dist/tools.cjs <command>\n\nCommands:');
  for (const [name, { description }] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(12)} ${description}`);
  }
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const command = name ? commands[name] : undefined;
  if (!command) {
    printHelp();
    process.exitCode = name && name !== 'help' ? 1 : 0;
    return;
  }
  await command.run(process.argv.slice(3));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
