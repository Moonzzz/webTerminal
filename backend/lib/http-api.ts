import type { IncomingMessage, ServerResponse } from 'http';
import type { AuthService } from './auth';
import { SecureChannelError, type SecureChannelService } from './secure-channel';

type SecureLoginPayload = {
  username?: unknown;
  password?: unknown;
  challenge?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
  clientPublicKeyJwk?: unknown;
};

type SecureSessionPayload = {
  challenge?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
  clientPublicKeyJwk?: unknown;
};

export async function handleBackendRequest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
  secureChannel: SecureChannelService
) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/crypto/handshake' && (req.method === 'GET' || req.method === 'POST')) {
    sendJson(res, 200, secureChannel.createHandshake(getRequestContext(req, auth)));
    return true;
  }

  if (url.pathname === '/api/crypto/session' && req.method === 'POST') {
    const user = auth.authenticateRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }

    const body = await readJsonBody(req);
    const payload = decryptSecureHandshake<SecureSessionPayload>(
      res,
      secureChannel,
      body,
      'session',
      getRequestContext(req, auth)
    );
    if (!payload) return true;

    const encrypted = createEncryptedSecureSessionResponse(
      res,
      secureChannel,
      payload.clientPublicKeyJwk,
      user.username
    );
    if (!encrypted) return true;
    sendJson(res, 200, { secure: encrypted });
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const ip = auth.getClientIp(req);
    const body = await readJsonBody(req);
    const payload = decryptSecureHandshake<SecureLoginPayload>(
      res,
      secureChannel,
      body,
      'login',
      getRequestContext(req, auth)
    );
    if (!payload) return true;

    const username = typeof payload.username === 'string' ? payload.username : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const result = auth.validateLogin(ip, username, password);

    if (!result.ok) {
      sendJson(res, result.status, { error: result.message });
      return true;
    }

    auth.setSessionCookie(res, result.username);
    const encrypted = createEncryptedSecureSessionResponse(
      res,
      secureChannel,
      payload.clientPublicKeyJwk,
      result.username
    );
    if (!encrypted) return true;
    sendJson(res, 200, { secure: encrypted });
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    auth.clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = auth.authenticateRequest(req);
    if (!user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return true;
    }
    sendJson(res, 200, { username: user.username });
    return true;
  }

  return false;
}

export function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) {
      throw new Error('Request body too large');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getRequestContext(req: IncomingMessage, auth: AuthService) {
  const userAgent = req.headers['user-agent'];
  return {
    ip: auth.getClientIp(req),
    userAgent: typeof userAgent === 'string' ? userAgent : '',
  };
}

function decryptSecureHandshake<T extends { challenge?: unknown; timestamp?: unknown; requestId?: unknown }>(
  res: ServerResponse,
  secureChannel: SecureChannelService,
  body: unknown,
  purpose: 'login' | 'session',
  context: { ip: string; userAgent: string }
): T | undefined {
  try {
    return secureChannel.decryptHandshakePayload<T>(body, purpose, context);
  } catch (error) {
    if (error instanceof SecureChannelError) {
      sendJson(res, error.status, { error: error.message });
      return undefined;
    }
    throw error;
  }
}

function createEncryptedSecureSessionResponse(
  res: ServerResponse,
  secureChannel: SecureChannelService,
  clientPublicKeyJwk: unknown,
  username: string
) {
  try {
    return secureChannel.encryptHandshakeResponse(clientPublicKeyJwk, {
      ok: true,
      username,
      secureSession: secureChannel.createSession(username),
    });
  } catch {
    sendJson(res, 400, { error: 'Invalid secure client public key' });
    return undefined;
  }
}
