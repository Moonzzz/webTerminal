import WebSocket, { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { createTerminalSession, resumeTerminalSession } from './terminal-session-manager';
import type { TerminalPeer, TerminalSessionHandle } from './terminal-session-manager';
import { normalizeClientMessage, type ClientMessage } from './terminal-protocol';
import type { AuthService } from './auth';
import type { RuntimeConfig } from './config';
import { SecureChannelError, type SecureChannelService } from './secure-channel';

type AliveWebSocket = WebSocket & {
  isAlive?: boolean;
};

const TERMINAL_WEBSOCKET_PATH = '/ws/terminal';

export function setupWebSocketServer(
  server: HttpServer,
  auth: AuthService,
  config: RuntimeConfig,
  secureChannel: SecureChannelService
) {
  const wss = new WebSocketServer({
    noServer: true,
  });

  const handleUpgrade = (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (!isTerminalWebSocketRequest(req.url)) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  };
  server.on('upgrade', handleUpgrade);

  wss.on('connection', (rawWs, req: IncomingMessage) => {
    const ws = rawWs as AliveWebSocket;
    const user = auth.authenticateRequest(req);
    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.isAlive = true;
    let session: TerminalSessionHandle | undefined;
    let secureSessionId: string | undefined;
    let secureAuthenticated = false;
    const peer: TerminalPeer = {
      send: (payload) => {
        if (!secureSessionId) {
          safeClose(ws, 1008, 'Secure channel required');
          return;
        }

        try {
          sendRaw(ws, secureChannel.encryptEnvelope(secureSessionId, 'ws:server', payload));
        } catch {
          safeClose(ws, 1008, 'Secure channel expired');
        }
      },
      close: () => safeClose(ws),
      isOpen: () => ws.readyState === WebSocket.OPEN,
    };

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      let encrypted: unknown;
      try {
        encrypted = JSON.parse(raw.toString());
      } catch {
        safeClose(ws, 1008, 'Invalid message JSON');
        return;
      }

      let msg: ClientMessage | undefined;
      try {
        const decrypted = secureChannel.decryptEnvelope<unknown>(encrypted, {
          channel: 'ws:client',
          username: user.username,
          sessionId: secureSessionId,
        });
        secureSessionId = decrypted.session.id;
        msg = normalizeClientMessage(decrypted.payload);
      } catch (error) {
        if (error instanceof SecureChannelError) {
          if (secureSessionId) {
            peer.send({ type: 'error', message: error.message });
          }
          safeClose(ws, 1008, error.message);
          return;
        }
        throw error;
      }

      if (!msg) {
        peer.send({ type: 'error', message: 'Invalid terminal message' });
        return;
      }

      if (!secureSessionId) {
        safeClose(ws, 1008, 'Secure channel required');
        return;
      }

      if (!secureAuthenticated && msg.type !== 'auth') {
        safeClose(ws, 1008, 'Secure auth required');
        return;
      }

      if (msg.type === 'auth') {
        secureAuthenticated = true;
        peer.send({ type: 'ready' });
        return;
      }

      if (msg.type === 'init') {
        if (session) {
          peer.send({ type: 'error', message: 'Session already initialized' });
          return;
        }

        if (msg.resumeSessionId) {
          session = resumeTerminalSession({
            sessionId: msg.resumeSessionId,
            peer,
            cols: msg.cols,
            rows: msg.rows,
          });

          if (session) {
            return;
          }

          peer.send({ type: 'status', message: 'Previous session expired, opening a new one' });
        }

        if (!msg.target) {
          peer.send({ type: 'error', message: 'Missing SSH target' });
          ws.close();
          return;
        }

        session = createTerminalSession({
          target: msg.target,
          peer,
          cols: msg.cols,
          rows: msg.rows,
        });
        return;
      }

      if (!session) {
        peer.send({ type: 'error', message: 'Session not initialized' });
        return;
      }

      if (msg.type === 'ping') {
        peer.send({ type: 'pong', ts: Date.now() });
      } else if (msg.type === 'input') {
        if (msg.data) {
          session.write(msg.data);
        }
      } else if (msg.type === 'resize') {
        if (Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
          session.resize(msg.cols, msg.rows);
        }
      }
    });

    ws.on('close', () => {
      session?.detach(peer);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as AliveWebSocket;
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }

      ws.isAlive = false;
      ws.ping();
    }
  }, config.websocket.heartbeatIntervalMs);
  heartbeat.unref();

  wss.on('close', () => {
    clearInterval(heartbeat);
    server.off('upgrade', handleUpgrade);
  });

  return wss;
}

function isTerminalWebSocketRequest(rawUrl: string | undefined) {
  if (!rawUrl) return false;
  return new URL(rawUrl, 'http://localhost').pathname === TERMINAL_WEBSOCKET_PATH;
}

function sendRaw(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function safeClose(ws: WebSocket, code?: number, reason?: string) {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(code, reason);
  }
}
