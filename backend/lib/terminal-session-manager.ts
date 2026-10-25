import { randomUUID } from 'crypto';
import { getRuntimeConfig, isAllowedTarget } from './config';
import { SshConnector, type SshTarget } from './ssh-connector';
import type { TerminalTargetInput } from './terminal-protocol';
import { TerminalState } from './terminal-state';

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
};

export type TerminalSessionHandle = {
  id: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  detach: (peer: TerminalPeer) => void;
  completeRestore: (peer: TerminalPeer, restoreId: string, cols: number, rows: number) => void;
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
}: ResumeTerminalSessionParams): TerminalSessionHandle | undefined {
  const session = sessions.get(sessionId);
  if (!session || session.isClosed()) {
    return undefined;
  }

  session.attach(peer, true);
  return session;
}

class ManagedTerminalSession implements TerminalSessionHandle {
  private connector: SshConnector | undefined;
  private attachedPeer: TerminalPeer | null = null;
  private closeTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private ending = false;
  private readonly state: TerminalState;
  private outputEnabled = false;
  private interactive = false;
  private restoreAcknowledged = false;
  private restoreId = '';
  private restoreTimer: NodeJS.Timeout | undefined;
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
    this.state = new TerminalState(
      params.cols,
      params.rows,
      this.config.ssh.scrollbackLines,
      this.config.ssh.outputBufferBytes,
    );
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
      onClose: () => this.finish(),
    });
    this.connector.connect();
  }

  attach(peer: TerminalPeer, resumed: boolean) {
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
    this.outputEnabled = false;
    this.interactive = false;
    this.restoreAcknowledged = false;
    const restoreId = this.restoreId = randomUUID();
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => {
      if (this.attachedPeer === peer && this.restoreId === restoreId) {
        this.detach(peer);
        safeClose(peer);
      }
    }, 30_000);
    this.restoreTimer.unref();
    sendJson(peer, { type: 'session', sessionId: this.id, resumed });
    void this.state.snapshot((snapshot) => {
      if (this.closed || this.attachedPeer !== peer || this.restoreId !== restoreId) return;
      sendJson(peer, { type: 'restore', restoreId, ...snapshot });
      this.outputEnabled = true;
    }).catch((error: unknown) => this.fail(error));
  }

  completeRestore(peer: TerminalPeer, restoreId: string, cols: number, rows: number) {
    if (
      this.closed || this.attachedPeer !== peer || restoreId !== this.restoreId ||
      this.restoreAcknowledged || !this.outputEnabled
    ) return;
    this.restoreAcknowledged = true;
    void this.state.resize(cols, rows, () => {
      if (this.closed || this.attachedPeer !== peer || restoreId !== this.restoreId) return;
      this.cols = cols;
      this.rows = rows;
      this.connector?.resize(cols, rows);
      this.interactive = true;
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = undefined;
      sendJson(peer, { type: 'restored', restoreId, cols, rows });
    }, () => !this.closed && this.attachedPeer === peer && this.restoreId === restoreId).catch((error: unknown) => this.fail(error));
  }

  detach(peer: TerminalPeer) {
    if (this.closed || this.attachedPeer !== peer) {
      return;
    }

    this.attachedPeer = null;
    this.outputEnabled = false;
    this.interactive = false;
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = undefined;
    this.closeTimer = setTimeout(() => {
      this.close();
    }, this.config.ssh.resumeTtlMs);
    this.closeTimer.unref();
  }

  write(data: string) {
    if (this.interactive && !this.ending) this.connector?.write(data);
  }

  resize(cols: number, rows: number) {
    if (!this.interactive || this.closed) return;
    const peer = this.attachedPeer;
    const restoreId = this.restoreId;
    void this.state.resize(cols, rows, () => {
      this.cols = cols;
      this.rows = rows;
      this.connector?.resize(cols, rows);
    }, () => !this.closed && this.attachedPeer === peer && this.restoreId === restoreId)
      .catch((error: unknown) => this.fail(error));
  }

  close() {
    if (this.closed) return;

    this.closed = true;
    sessions.delete(this.id);

    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }

    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = undefined;
    this.state.dispose();
    this.connector?.close();
    this.connector = undefined;

    if (this.attachedPeer) {
      safeClose(this.attachedPeer);
      this.attachedPeer = null;
    }
  }

  isClosed() {
    return this.closed || this.ending;
  }

  private finish() {
    if (this.closed || this.ending) return;
    this.ending = true;
    void this.state.flush(() => this.close()).catch((error: unknown) => this.fail(error));
  }

  private sendOutput(data: string) {
    void this.state.write(data, (output, sequence) => {
      if (this.outputEnabled) this.sendJson({ type: 'output', data: output, sequence });
    }).catch((error: unknown) => this.fail(error));
  }

  private sendJson(payload: unknown) {
    if (this.attachedPeer) sendJson(this.attachedPeer, payload);
  }

  private fail(error: unknown) {
    if (this.closed) return;
    this.sendJson({ type: 'error', message: error instanceof Error ? error.message : 'Terminal state failed' });
    this.close();
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
