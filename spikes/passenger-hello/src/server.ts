/**
 * Passenger spike (Part 0): a minimal Fastify app used to verify how the Seohost panel
 * (CloudLinux Node.js Selector / Passenger) runs a bundled CommonJS app.
 * Reports runtime facts; never prints environment variable values.
 */
import Fastify from 'fastify';

const startedAt = new Date().toISOString();
const app = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024 });

app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
  done(null, body),
);

app.get('/', async () => ({
  spike: 'passenger-hello',
  startedAt,
  node: process.version,
  nodeEnv: process.env.NODE_ENV ?? null,
  portEnv: process.env.PORT ?? null,
  cwd: process.cwd(),
  execPath: process.execPath,
  argv: process.argv,
  pid: process.pid,
  ppid: process.ppid,
  uptimeS: Math.round(process.uptime()),
  memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  envNames: Object.keys(process.env).sort(),
}));

app.post('/upload', async (request) => {
  const body = request.body as Buffer | undefined;
  return { receivedBytes: body?.length ?? 0 };
});

const portEnv = process.env.PORT;
const listenOptions =
  portEnv && !/^\d+$/.test(portEnv)
    ? { path: portEnv } // Some runners pass a socket path in PORT.
    : { port: Number(portEnv) || 3000, host: '127.0.0.1' };

app.listen(listenOptions).then(
  (address) => app.log.info({ address, listenOptions }, 'spike listening'),
  (error: unknown) => {
    app.log.error(error);
    process.exit(1);
  },
);
