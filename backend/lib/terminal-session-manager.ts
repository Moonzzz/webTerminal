import { randomUUID } from 'crypto';
import { getRuntimeConfig, isAllowedTarget } from './config';
import type { SshTarget } from './ssh-connector';
import type { TerminalTargetInput } from './terminal-protocol';
import { ManagedTerminalSession, type TerminalPeer, type TerminalSessionHandle } from './terminal-session';

type CreateTerminalSessionParams = {
  target?: TerminalTargetInput;
  peer: TerminalPeer;
  cols?: number;
  rows?: number;
};

type ResumeTerminalSessionParams = {
  sessionId: string;
  peer: TerminalPeer;
};

const sessions = new Map<string, ManagedTerminalSession>();

export function createTerminalSession({
  target,
  peer,
  cols = 120,
  rows = 30,
}: CreateTerminalSessionParams): TerminalSessionHandle | undefined {
  const sshTarget = createSshTarget(target);
  if (!sshTarget) {
    peer.send({ type: 'error', message: 'Invalid SSH target' });
    peer.close();
    return undefined;
  }

  if (!isAllowedTarget(sshTarget.host, sshTarget.port)) {
    peer.send({
      type: 'error',
      message: `Target is not allowed: ${sshTarget.host}:${sshTarget.port}`,
    });
    peer.close();
    return undefined;
  }

  const session = new ManagedTerminalSession({
    id: randomUUID(),
    target: sshTarget,
    cols,
    rows,
    settings: getRuntimeConfig().ssh,
    onClosed: () => { sessions.delete(session.id); },
  });
  sessions.set(session.id, session);
  session.attach(peer, false);
  session.connect();

  return session;
}

export function resumeTerminalSession({
  sessionId,
  peer,
}: ResumeTerminalSessionParams): TerminalSessionHandle | undefined {
  const session = sessions.get(sessionId);
  if (!session || session.isClosed()) {
    return undefined;
  }

  session.attach(peer, true);
  return session;
}

function createSshTarget(input: TerminalTargetInput | undefined): SshTarget | undefined {
  if (
    !input ||
    !isValidHost(input.host) ||
    !isValidPort(input.port) ||
    !input.username.trim() ||
    !input.password
  ) {
    return undefined;
  }

  const host = input.host.trim();
  const username = input.username.trim();
  const port = input.port;

  return {
    name: input.name?.trim() || `${username}@${host}:${port}`,
    host,
    port,
    username,
    password: input.password,
  };
}

function isValidHost(value: string) {
  const host = value.trim();
  return host.length > 0 && host.length <= 253 && !/[\s/\\]/.test(host);
}

function isValidPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
