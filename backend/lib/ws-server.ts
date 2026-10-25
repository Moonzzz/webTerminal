import WebSocket, { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Server as HttpsServer } from 'https';
import { createTerminalSession, resumeTerminalSession } from './terminal-session-manager';
import type { TerminalPeer, TerminalSessionHandle } from './terminal-session';
import { normalizeClientMessage, type ClientMessage } from './terminal-protocol';
import type { AuthService } from './auth';
import type { RuntimeConfig } from './config';
import { SecureChannelError, type SecureChannelService } from './secure-channel';
import { TERMINAL_TRANSPORT_LIMITS } from '../../shared/terminal-protocol';

type AliveWebSocket = WebSocket & {
  isAlive?: boolean;
};

const TERMINAL_WEBSOCKET_PATH = '/ws/terminal';

export function setupWebSocketServer(
  server: HttpServer | HttpsServer,
  auth: AuthService,
  config: RuntimeConfig,
  secureChannel: SecureChannelService
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: TERMINAL_TRANSPORT_LIMITS.maxPendingBytes,
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
    let pendingFrames = 0;
    let closing = false;
    let terminateTimer: NodeJS.Timeout | undefined;
    const disconnectSlowPeer = () => {
      if (closing) return;
      closing = true;
      session?.detach(peer);
      safeClose(ws, 1013, 'Terminal transport backlog exceeds limit');
      // Do not retain a stalled socket's buffered frames indefinitely.
      terminateTimer = setTimeout(() => ws.terminate(), 1000);
      terminateTimer.unref();
    };
    const peer: TerminalPeer = {
      send: (payload) => {
        if (closing || ws.readyState !== WebSocket.OPEN) return;
        if (!secureSessionId) {
          safeClose(ws, 1008, 'Secure channel required');
          return;
        }

        try {
          const frame = JSON.stringify(secureChannel.encryptEnvelope(secureSessionId, 'ws:server', payload));
          if (ws.bufferedAmount + Buffer.byteLength(frame) > TERMINAL_TRANSPORT_LIMITS.maxPendingBytes ||
            pendingFrames >= TERMINAL_TRANSPORT_LIMITS.maxPendingMessages) {
            disconnectSlowPeer();
            return;
          }
          pendingFrames++;
          ws.send(frame, (error) => {
            pendingFrames--;
            if (error) disconnectSlowPeer();
          });
        } catch {
          safeClose(ws, 1008, 'Secure channel expired');
        }
      },
      close: () => safeClose(ws),
      isOpen: () => !closing && ws.readyState === WebSocket.OPEN,
    };

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      if (closing) return;
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

      if (msg.type === 'restore-ready') {
        session.completeRestore(peer, msg.restoreId, msg.cols, msg.rows);
      } else if (msg.type === 'terminal-reply') {
        session.reply(peer, msg.restoreId, msg.data);
      } else if (msg.type === 'ping') {
        peer.send({ type: 'pong', ts: Date.now() });
      } else if (msg.type === 'input') {
        if (msg.data) {
          session.write(peer, msg.data);
        }
      } else if (msg.type === 'resize') {
        if (Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
          session.resize(peer, msg.cols, msg.rows);
        }
      }
    });

    ws.on('close', () => {
      closing = true;
      if (terminateTimer) clearTimeout(terminateTimer);
      session?.detach(peer);
    });
    ws.on('error', disconnectSlowPeer);
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

function safeClose(ws: WebSocket, code?: number, reason?: string) {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(code, reason);
  }
}
