# Passenger spike

A minimal Fastify app bundled into one CommonJS file. It verifies how the Seohost Node.js selector (CloudLinux / Passenger) runs the app before the real deployment depends on it.

```bash
npm run spike:build            # -> spikes/passenger-hello/dist/{app.js,package.json,dist/server.cjs}
ssh seohost 'mkdir -p ~/nodejsapp/rekordy-sportowe/dist'
scp spikes/passenger-hello/dist/app.js spikes/passenger-hello/dist/package.json seohost:nodejsapp/rekordy-sportowe/
scp spikes/passenger-hello/dist/dist/server.cjs seohost:nodejsapp/rekordy-sportowe/dist/
```

Endpoints:

- `GET /`: runtime facts (Node version, `NODE_ENV`, `PORT`, cwd, pid, environment variable **names** only).
- `POST /upload` (`application/octet-stream`): returns the number of bytes received, to probe request size limits.

The first `npm run deploy` replaces it with the real app.
