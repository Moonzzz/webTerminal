import { randomUUID } from 'crypto';
import { getRuntimeConfig, isAllowedTarget } from './config';
import { SshConnector, type SshTarget } from './ssh-connector';
import type { TerminalTargetInput } from './terminal-protocol';

export type TerminalPeer = {
  send: (payload: unknown) => void;
  close: () => void;
  isOpen: () => boolean;
};

type CreateTerminalSessionParams = {
  target?: TerminalTargetInput;
  peer: TerminalPeer;
  cols?: number;
  rows?: number;
};

type ResumeTerminalSessionParams = {
  sessionId: string;
  peer: TerminalPeer;
  cols?: number;
  rows?: number;
};

export type TerminalSessionHandle = {
  id: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  detach: (peer: TerminalPeer) => void;
  close: () => void;
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
    sendJson(peer, { type: 'error', message: 'Invalid SSH target' });
    peer.close();
    return undefined;
  }

  if (!isAllowedTarget(sshTarget.host, sshTarget.port)) {
    sendJson(peer, {
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
  });
  sessions.set(session.id, session);
  session.attach(peer, false);
  session.connect();

  return session;
}

export function resumeTerminalSession({
  sessionId,
  peer,
  cols = 120,
  rows = 30,
}: ResumeTerminalSessionParams): TerminalSessionHandle | undefined {
  const session = sessions.get(sessionId);
  if (!session || session.isClosed()) {
    return undefined;
  }

  session.attach(peer, true);
  session.resize(cols, rows);
  return session;
}

class ManagedTerminalSession implements TerminalSessionHandle {
  private connector: SshConnector | undefined;
  private attachedPeer: TerminalPeer | null = null;
  private closeTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private replayChunks: Array<{ data: string; bytes: number }> = [];
  private replayBytes = 0;
  private readonly config = getRuntimeConfig();
  private cols: number;
  private rows: number;

  readonly id: string;

  constructor(
    private readonly params: {
      id: string;
      target: SshTarget;
      cols: number;
      rows: number;
    }
  ) {
    this.id = params.id;
    this.cols = params.cols;
    this.rows = params.rows;
  }

  connect() {
    this.connector = new SshConnector({
      target: this.params.target,
      cols: this.cols,
      rows: this.rows,
      keepaliveIntervalMs: this.config.ssh.keepaliveIntervalMs,
      keepaliveCountMax: this.config.ssh.keepaliveCountMax,
      onStatus: (message) => this.sendJson({ type: 'status', message }),
      onOutput: (data) => this.sendOutput(data),
      onError: (message) => {
        this.sendJson({ type: 'error', message });
        this.close();
      },
      onClose: () => this.close(),
    });
    this.connector.connect();
  }

  attach(peer: TerminalPeer, replay: boolean) {
    if (this.closed) {
      sendJson(peer, { type: 'error', message: 'Session already closed' });
      safeClose(peer);
      return;
    }

    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }

    if (this.attachedPeer && this.attachedPeer !== peer) {
      safeClose(this.attachedPeer);
    }

    this.attachedPeer = peer;
    sendJson(peer, { type: 'session', sessionId: this.id, resumed: replay });

    if (replay) {
      sendJson(peer, { type: 'status', message: 'Session resumed' });
      for (const chunk of this.replayChunks) {
        sendJson(peer, { type: 'output', data: chunk.data });
      }
    }
  }

  detach(peer: TerminalPeer) {
    if (this.closed || this.attachedPeer !== peer) {
      return;
    }

    this.attachedPeer = null;
    this.closeTimer = setTimeout(() => {
      this.close();
    }, this.config.ssh.resumeTtlMs);
    this.closeTimer.unref();
  }

  write(data: string) {
    this.connector?.write(data);
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.connector?.resize(cols, rows);
  }

  close() {
    if (this.closed) return;

    this.closed = true;
    sessions.delete(this.id);

    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }

    this.connector?.close();
    this.connector = undefined;

    if (this.attachedPeer) {
      safeClose(this.attachedPeer);
      this.attachedPeer = null;
    }
  }

  isClosed() {
    return this.closed;
  }

  private sendOutput(data: string) {
    this.addReplayChunk(data);
    this.sendJson({ type: 'output', data });
  }

  private sendJson(payload: unknown) {
    if (this.attachedPeer) {
      sendJson(this.attachedPeer, payload);
    }
  }

  private addReplayChunk(data: string) {
    let nextData = data;
    let bytes = Buffer.byteLength(nextData);
    const maxReplayBytes = this.config.ssh.replayBufferBytes;

    if (bytes > maxReplayBytes) {
      nextData = nextData.slice(-maxReplayBytes);
      bytes = Buffer.byteLength(nextData);
    }

    this.replayChunks.push({ data: nextData, bytes });
    this.replayBytes += bytes;

    while (this.replayBytes > maxReplayBytes && this.replayChunks.length > 1) {
      const removed = this.replayChunks.shift();
      if (removed) {
        this.replayBytes -= removed.bytes;
      }
    }
  }
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

function safeClose(peer: TerminalPeer) {
  if (peer.isOpen()) {
    peer.close();
  }
}

function sendJson(peer: TerminalPeer, payload: unknown) {
  if (peer.isOpen()) {
    peer.send(payload);
  }
}

function isValidHost(value: string) {
  const host = value.trim();
  return host.length > 0 && host.length <= 253 && !/[\s/\\]/.test(host);
}

function isValidPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
