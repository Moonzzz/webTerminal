import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
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

  const requestListener: RequestListener = async (req, res) => {
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
  };
  const { server, protocol } = createDevAwareServer(requestListener);

  setupWebSocketServer(server, auth, config, secureChannel);

  server.listen(config.server.port, config.server.hostname, () => {
    console.log(`> Ready on ${protocol}://${config.server.hostname}:${config.server.port}`);
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
    isE2ETestHarnessRequest(url.pathname) ||
    url.pathname.startsWith('/_next/') ||
    url.pathname === '/favicon.ico'
  );
}

function isE2ETestHarnessRequest(pathname: string) {
  return process.env.WEBTERMINAL_E2E === '1' && pathname === '/terminal/test-harness';
}

function acceptsHtml(value: string | undefined) {
  return !value || value.includes('text/html') || value.includes('*/*');
}

function createDevAwareServer(requestListener: RequestListener) {
  const keyPath = process.env.WEBTERMINAL_HTTPS_KEY;
  const certPath = process.env.WEBTERMINAL_HTTPS_CERT;

  if (dev && keyPath && certPath) {
    return {
      server: createHttpsServer(
        {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        },
        requestListener
      ),
      protocol: 'https',
    };
  }

  return {
    server: createHttpServer(requestListener),
    protocol: 'http',
  };
}
