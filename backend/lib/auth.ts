import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { RuntimeConfig } from './config';

const AUTH_COOKIE = 'webTerminalAuth';

type FailedAttempt = {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
};

export type AuthResult =
  | { ok: true; username: string }
  | { ok: false; status: 401 | 423; message: string };

export class AuthService {
  private readonly failedAttempts = new Map<string, FailedAttempt>();

  constructor(private readonly config: RuntimeConfig) {}

  validateLogin(ip: string, username: string, password: string): AuthResult {
    const lock = this.getLock(ip);
    if (lock) {
      return { ok: false, status: 423, message: `IP locked until ${new Date(lock).toISOString()}` };
    }

    if (username === this.config.auth.username && password === this.config.auth.password) {
      this.failedAttempts.delete(ip);
      return { ok: true, username };
    }

    this.recordFailure(ip);
    const nextLock = this.getLock(ip);
    if (nextLock) {
      return { ok: false, status: 423, message: `IP locked until ${new Date(nextLock).toISOString()}` };
    }

    return { ok: false, status: 401, message: 'Invalid username or password' };
  }

  authenticateRequest(req: IncomingMessage): { username: string } | undefined {
    const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
    if (!token) return undefined;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return undefined;

    const expected = this.sign(payload);
    if (!safeEqual(signature, expected)) return undefined;

    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
        username?: unknown;
        expiresAt?: unknown;
      };

      if (
        session.username !== this.config.auth.username ||
        typeof session.expiresAt !== 'number' ||
        session.expiresAt < Date.now()
      ) {
        return undefined;
      }

      return { username: session.username };
    } catch {
      return undefined;
    }
  }

  setSessionCookie(res: ServerResponse, username: string) {
    const maxAge = this.config.auth.sessionTtlMinutes * 60;
    const payload = Buffer.from(
      JSON.stringify({
        username,
        expiresAt: Date.now() + maxAge * 1000,
      })
    ).toString('base64url');
    const token = `${payload}.${this.sign(payload)}`;
    res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge,
      secure: this.config.auth.secureCookie,
    }));
  }

  clearSessionCookie(res: ServerResponse) {
    res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE, '', {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 0,
      secure: this.config.auth.secureCookie,
    }));
  }

  getClientIp(req: IncomingMessage) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  private getLock(ip: string) {
    const attempt = this.failedAttempts.get(ip);
    if (!attempt?.lockedUntil) return undefined;

    if (attempt.lockedUntil <= Date.now()) {
      this.failedAttempts.delete(ip);
      return undefined;
    }

    return attempt.lockedUntil;
  }

  private recordFailure(ip: string) {
    const now = Date.now();
    const lockMs = this.config.auth.lockMinutes * 60 * 1000;
    const current = this.failedAttempts.get(ip);
    const attempt =
      current && current.firstFailedAt + lockMs > now
        ? current
        : { count: 0, firstFailedAt: now };

    attempt.count += 1;

    if (attempt.count >= this.config.auth.failedAttemptLimit) {
      attempt.lockedUntil = now + lockMs;
    }

    this.failedAttempts.set(ip, attempt);
  }

  private sign(payload: string) {
    return crypto
      .createHmac('sha256', this.config.auth.sessionSecret)
      .update(payload)
      .digest('base64url');
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(value: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!value) return cookies;

  for (const part of value.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (!name || rest.length === 0) continue;
    cookies[name] = decodeURIComponent(rest.join('='));
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    sameSite: 'Lax' | 'Strict' | 'None';
    path: string;
    maxAge: number;
    secure: boolean;
  }
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}
