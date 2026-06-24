import { createServer } from 'node:http';
import path from 'node:path';
import next from 'next';
import { AuthService } from './lib/auth';
import { getRuntimeConfig } from './lib/config';
import { handleBackendRequest, sendJson } from './lib/http-api';
import { SecureChannelService } from './lib/secure-channel';
import { setupWebSocketServer } from './lib/ws-server';

const dev = process.env.NODE_ENV !== 'production';
const config = getRuntimeConfig();
const auth = new AuthService(config);
const secureChannel = new SecureChannelService(config.auth.sessionTtlMinutes * 60 * 1000);
const frontendDir = path.join(process.cwd(), 'frontend');

const app = next({
  dev,
  hostname: config.server.hostname,
  port: config.server.port,
  dir: frontendDir,
});
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const server = createServer(async (req, res) => {
    try {
      if (await handleBackendRequest(req, res, auth, secureChannel)) {
        return;
      }

      if (isPublicRequest(req.url || '/') || auth.authenticateRequest(req)) {
        handle(req, res);
        return;
      }

      if (acceptsHtml(req.headers.accept)) {
        res.statusCode = 302;
        res.setHeader('Location', '/login');
        res.end();
      } else {
        sendJson(res, 401, { error: 'Unauthorized' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { error: message });
    }
  });

  setupWebSocketServer(server, auth, config, secureChannel);

  server.listen(config.server.port, config.server.hostname, () => {
    console.log(`> Ready on http://${config.server.hostname}:${config.server.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function isPublicRequest(rawUrl: string) {
  const url = new URL(rawUrl, 'http://localhost');
  return (
    url.pathname === '/login' ||
    url.pathname.startsWith('/_next/') ||
    url.pathname === '/favicon.ico'
  );
}

function acceptsHtml(value: string | undefined) {
  return !value || value.includes('text/html') || value.includes('*/*');
}
