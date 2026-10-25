import { TERMINAL_TRANSPORT_LIMITS, type ClientMessage, type TerminalTargetInput } from '../../shared/terminal-protocol';

export type { ClientMessage, TerminalTargetInput } from '../../shared/terminal-protocol';

export function normalizeClientMessage(value: unknown): ClientMessage | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const input = value as Record<string, unknown>;

  if (input.type === 'auth') {
    return { type: 'auth' };
  }

  if (input.type === 'init') {
    return {
      type: 'init',
      target: normalizeTarget(input.target),
      resumeSessionId: normalizeSessionId(input.resumeSessionId),
      cols: normalizeSize(input.cols, 120),
      rows: normalizeSize(input.rows, 30),
    };
  }

  if (input.type === 'restore-ready') {
    const restoreId = normalizeSessionId(input.restoreId);
    if (!restoreId) return undefined;
    return {
      type: 'restore-ready',
      restoreId,
      cols: normalizeSize(input.cols, 120),
      rows: normalizeSize(input.rows, 30),
    };
  }

  if (input.type === 'terminal-reply') {
    const restoreId = normalizeSessionId(input.restoreId);
    if (!restoreId || typeof input.data !== 'string' || input.data.length > TERMINAL_TRANSPORT_LIMITS.maxInputChars) return undefined;
    return { type: 'terminal-reply', restoreId, data: input.data };
  }

  if (input.type === 'input') {
    if (typeof input.data !== 'string' || input.data.length > TERMINAL_TRANSPORT_LIMITS.maxInputChars) return undefined;
    return {
      type: 'input',
      data: input.data,
    };
  }

  if (input.type === 'resize') {
    return {
      type: 'resize',
      cols: normalizeSize(input.cols, 120),
      rows: normalizeSize(input.rows, 30),
    };
  }

  if (input.type === 'ping') {
    return { type: 'ping' };
  }

  return undefined;
}

function normalizeTarget(value: unknown): TerminalTargetInput | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const input = value as Record<string, unknown>;
  const host = typeof input.host === 'string' ? input.host.trim() : '';
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const port = typeof input.port === 'number' ? input.port : Number(input.port);
  const name = typeof input.name === 'string' ? input.name.trim() : undefined;

  if (!host || !username || !password || !Number.isInteger(port)) {
    return undefined;
  }

  return {
    name,
    host,
    port,
    username,
    password,
  };
}

function normalizeSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 500) {
    return fallback;
  }
  return value;
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sessionId = value.trim();
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return undefined;
  return sessionId;
}
