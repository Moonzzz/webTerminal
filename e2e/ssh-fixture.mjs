import { generateKeyPairSync } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import ssh2 from 'ssh2';

const { Server: SshServer } = ssh2;

const host = process.env.WEBTERMINAL_E2E_SSH_HOST || '127.0.0.1';
const port = Number(process.env.WEBTERMINAL_E2E_SSH_PORT || 2022);
const httpPort = Number(process.env.WEBTERMINAL_E2E_FIXTURE_PORT || 3201);
const username = process.env.WEBTERMINAL_E2E_SSH_USERNAME || 'mobile-e2e';
const password = process.env.WEBTERMINAL_E2E_SSH_PASSWORD || 'mobile-e2e-password';

const state = {
  inputs: [],
  windowChanges: [],
};

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' });

const sshServer = new SshServer({ hostKeys: [hostKey] }, (client) => {
  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
      ctx.accept();
      return;
    }

    ctx.reject();
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();

      session.on('pty', (acceptPty, _rejectPty, info) => {
        state.windowChanges.push({ cols: info.cols, rows: info.rows });
        acceptPty?.();
      });

      session.on('window-change', (acceptWindowChange, _rejectWindowChange, info) => {
        state.windowChanges.push({ cols: info.cols, rows: info.rows });
        acceptWindowChange?.();
      });

      session.on('shell', (acceptShell) => {
        const stream = acceptShell();
        stream.write('WEBTERMINAL_E2E_READY\r\n');
        for (let index = 1; index <= 180; index += 1) {
          stream.write(`WEBTERMINAL_E2E_LINE_${String(index).padStart(3, '0')}\r\n`);
        }
        stream.write('WEBTERMINAL_E2E_PROMPT$ ');

        stream.on('data', (chunk) => {
          const input = chunk.toString('utf8');
          state.inputs.push(input);
          stream.write(input);
        });
      });
    });
  });
});

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/reset' && req.method === 'POST') {
    state.inputs = [];
    state.windowChanges = [];
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/state' && req.method === 'GET') {
    sendJson(res, 200, state);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

await Promise.all([
  listen(sshServer, port, host),
  listen(httpServer, httpPort, '127.0.0.1'),
]);

console.log(`> E2E SSH fixture ready on ${host}:${port}`);
console.log(`> E2E fixture API ready on http://127.0.0.1:${httpPort}`);

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function listen(server, listenPort, listenHost) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, listenHost, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function shutdown() {
  httpServer.close();
  sshServer.close();
}
