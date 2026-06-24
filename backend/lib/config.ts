import fs from 'fs';
import path from 'path';

export type AllowedTarget = {
  host: string;
  port: number;
};

export type RuntimeConfig = {
  server: {
    hostname: string;
    port: number;
  };
  auth: {
    username: string;
    password: string;
    sessionSecret: string;
    sessionTtlMinutes: number;
    failedAttemptLimit: number;
    lockMinutes: number;
    secureCookie: boolean;
  };
  ssh: {
    allowedTargets: AllowedTarget[];
    resumeTtlMs: number;
    replayBufferBytes: number;
    keepaliveIntervalMs: number;
    keepaliveCountMax: number;
  };
  websocket: {
    heartbeatIntervalMs: number;
  };
};

let cachedConfig: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = path.join(process.cwd(), 'config', 'server.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = resolveEnvPlaceholders(JSON.parse(raw)) as Record<string, unknown>;
  cachedConfig = normalizeConfig(parsed);
  return cachedConfig;
}

export function isAllowedTarget(host: string, port: number) {
  const normalizedHost = normalizeHost(host);
  return getRuntimeConfig().ssh.allowedTargets.some(
    (target) => normalizeHost(target.host) === normalizedHost && target.port === port
  );
}

function resolveEnvPlaceholders(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)(?::([^}]*))?\}/gi, (_, name: string, fallback = '') => {
      return process.env[name] ?? fallback;
    });
  }

  if (Array.isArray(value)) {
    return value.map(resolveEnvPlaceholders);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveEnvPlaceholders(item),
      ])
    );
  }

  return value;
}

function normalizeConfig(value: Record<string, unknown>): RuntimeConfig {
  const server = readObject(value, 'server');
  const auth = readObject(value, 'auth');
  const ssh = readObject(value, 'ssh');
  const websocket = readObject(value, 'websocket');

  return {
    server: {
      hostname: readString(server, 'hostname'),
      port: readNumber(server, 'port', 3000),
    },
    auth: {
      username: readString(auth, 'username'),
      password: readString(auth, 'password'),
      sessionSecret: readString(auth, 'sessionSecret'),
      sessionTtlMinutes: readNumber(auth, 'sessionTtlMinutes', 720),
      failedAttemptLimit: readNumber(auth, 'failedAttemptLimit', 5),
      lockMinutes: readNumber(auth, 'lockMinutes', 30),
      secureCookie: readBoolean(auth, 'secureCookie', false),
    },
    ssh: {
      allowedTargets: readAllowedTargets(ssh.allowedTargets),
      resumeTtlMs: readNumber(ssh, 'resumeTtlMs', 300000),
      replayBufferBytes: readNumber(ssh, 'replayBufferBytes', 524288),
      keepaliveIntervalMs: readNumber(ssh, 'keepaliveIntervalMs', 20000),
      keepaliveCountMax: readNumber(ssh, 'keepaliveCountMax', 3),
    },
    websocket: {
      heartbeatIntervalMs: readNumber(websocket, 'heartbeatIntervalMs', 20000),
    },
  };
}

function readAllowedTargets(value: unknown): AllowedTarget[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map(parseAllowedTarget);
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') {
        return parseAllowedTarget(item);
      }

      if (!item || typeof item !== 'object') {
        throw new Error('Invalid allowed target');
      }

      const record = item as Record<string, unknown>;
      return {
        host: readString(record, 'host'),
        port: readNumber(record, 'port', 22),
      };
    });
  }

  return [];
}

function parseAllowedTarget(value: string): AllowedTarget {
  const separator = value.lastIndexOf(':');
  if (separator <= 0) {
    throw new Error(`Invalid allowed target "${value}", expected host:port`);
  }

  const host = value.slice(0, separator).trim();
  const port = Number(value.slice(separator + 1));

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid allowed target "${value}", expected host:port`);
  }

  return { host, port };
}

function readObject(item: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = item[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Config field "${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Config field "${key}" must be a non-empty string`);
  }
  return value.trim();
}

function readNumber(item: Record<string, unknown>, key: string, fallback: number): number {
  const value = item[key];
  if (value === undefined || value === '') return fallback;

  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Config field "${key}" must be a number`);
  }

  return numeric;
}

function readBoolean(item: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = item[key];
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

function normalizeHost(value: string) {
  return value.trim().toLowerCase();
}
