import { randomUUID } from 'crypto';
import { SshConnector, type SshConnectorParams, type SshTarget } from './ssh-connector';
import { TerminalState } from './terminal-state';
import type { ServerMessage } from '../../shared/terminal-protocol';

export type SessionConnector = Pick<SshConnector, 'connect' | 'write' | 'resize' | 'close'>;
export type TerminalSessionSettings = {
  scrollbackLines: number;
  outputBufferBytes: number;
  resumeTtlMs: number;
  keepaliveIntervalMs: number;
  keepaliveCountMax: number;
};

export type TerminalPeer = {
  send: (payload: ServerMessage) => void;
  close: () => void;
  isOpen: () => boolean;
};

export type TerminalSessionHandle = {
  id: string;
  write: (peer: TerminalPeer, data: string) => void;
  reply: (peer: TerminalPeer, restoreId: string, data: string) => void;
  resize: (peer: TerminalPeer, cols: number, rows: number) => void;
  detach: (peer: TerminalPeer) => void;
  completeRestore: (peer: TerminalPeer, restoreId: string, cols: number, rows: number) => void;
  close: () => void;
};

type Attachment = {
  peer: TerminalPeer;
  restoreId: string;
  phase: 'snapshotting' | 'awaiting-ready' | 'resizing' | 'interactive';
  timer?: NodeJS.Timeout;
};

export class ManagedTerminalSession implements TerminalSessionHandle {
  private connector: SessionConnector | undefined;
  private attachment: Attachment | undefined;
  private closeTimer: NodeJS.Timeout | undefined;
  private lifecycle: 'open' | 'ending' | 'closed' = 'open';
  private readonly state: TerminalState;
  private cols: number;
  private rows: number;

  readonly id: string;

  constructor(private readonly params: {
    id: string;
    target: SshTarget;
    cols: number;
    rows: number;
    settings: TerminalSessionSettings;
    onClosed: () => void;
    createConnector?: (params: SshConnectorParams) => SessionConnector;
  }) {
    this.id = params.id;
    this.cols = params.cols;
    this.rows = params.rows;
    this.state = new TerminalState(
      params.cols,
      params.rows,
      this.params.settings.scrollbackLines,
      this.params.settings.outputBufferBytes,
    );
  }

  connect() {
    const createConnector = this.params.createConnector ?? ((params: SshConnectorParams) => new SshConnector(params));
    this.connector = createConnector({
      target: this.params.target,
      cols: this.cols,
      rows: this.rows,
      keepaliveIntervalMs: this.params.settings.keepaliveIntervalMs,
      keepaliveCountMax: this.params.settings.keepaliveCountMax,
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
    if (this.lifecycle !== 'open') {
      sendJson(peer, { type: 'error', message: 'Session already closed' });
      safeClose(peer);
      return;
    }
    this.cancelCloseTimer();
    const previous = this.attachment;
    this.clearAttachment();
    if (previous && previous.peer !== peer) safeClose(previous.peer);

    const attachment: Attachment = { peer, restoreId: randomUUID(), phase: 'snapshotting' };
    this.attachment = attachment;
    attachment.timer = setTimeout(() => {
      if (!this.isCurrent(attachment)) return;
      this.detach(peer);
      safeClose(peer);
    }, 30_000);
    attachment.timer.unref();
    sendJson(peer, { type: 'session', sessionId: this.id, resumed });
    void this.state.snapshot((snapshot) => {
      if (!this.isCurrent(attachment)) return;
      // Sending can synchronously detach a slow peer; never revive its state.
      attachment.phase = 'awaiting-ready';
      sendJson(peer, { type: 'restore', restoreId: attachment.restoreId, ...snapshot });
    }).catch((error: unknown) => this.fail(error));
  }

  completeRestore(peer: TerminalPeer, restoreId: string, cols: number, rows: number) {
    const attachment = this.attachment;
    if (!attachment || attachment.peer !== peer || attachment.restoreId !== restoreId ||
      attachment.phase !== 'awaiting-ready' || this.lifecycle !== 'open') return;

    attachment.phase = 'resizing';
    void this.state.resize(cols, rows, () => {
      this.cols = cols;
      this.rows = rows;
      this.connector?.resize(cols, rows);
      attachment.phase = 'interactive';
      this.clearRestoreTimer(attachment);
      sendJson(peer, { type: 'restored', restoreId, cols, rows });
    }, () => this.isCurrent(attachment)).catch((error: unknown) => this.fail(error));
  }

  detach(peer: TerminalPeer) {
    if (this.lifecycle === 'closed' || this.attachment?.peer !== peer) return;
    this.clearAttachment();
    this.cancelCloseTimer();
    this.closeTimer = setTimeout(() => this.close(), this.params.settings.resumeTtlMs);
    this.closeTimer.unref();
  }

  write(peer: TerminalPeer, data: string) {
    if (this.lifecycle === 'open' && this.attachment?.peer === peer &&
      this.attachment.phase === 'interactive') this.connector?.write(data);
  }

  reply(peer: TerminalPeer, restoreId: string, data: string) {
    const attachment = this.attachment;
    if (this.lifecycle === 'open' && attachment?.peer === peer &&
      attachment.restoreId === restoreId && attachment.phase !== 'snapshotting') {
      this.connector?.write(data);
    }
  }

  resize(peer: TerminalPeer, cols: number, rows: number) {
    const attachment = this.attachment;
    if (!attachment || attachment.peer !== peer || attachment.phase !== 'interactive' ||
      this.lifecycle !== 'open') return;
    void this.state.resize(cols, rows, () => {
      this.cols = cols;
      this.rows = rows;
      this.connector?.resize(cols, rows);
    }, () => this.isCurrent(attachment)).catch((error: unknown) => this.fail(error));
  }

  close() {
    if (this.lifecycle === 'closed') return;
    this.lifecycle = 'closed';
    this.params.onClosed();
    this.cancelCloseTimer();
    const peer = this.attachment?.peer;
    this.clearAttachment();
    this.state.dispose();
    this.connector?.close();
    this.connector = undefined;
    if (peer) safeClose(peer);
  }

  isClosed() { return this.lifecycle !== 'open'; }

  private isCurrent(attachment: Attachment) {
    return this.lifecycle !== 'closed' && this.attachment === attachment;
  }

  private clearRestoreTimer(attachment: Attachment) {
    if (attachment.timer) clearTimeout(attachment.timer);
    attachment.timer = undefined;
  }

  private clearAttachment() {
    if (this.attachment) this.clearRestoreTimer(this.attachment);
    this.attachment = undefined;
  }

  private cancelCloseTimer() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  }

  private finish() {
    if (this.lifecycle !== 'open') return;
    this.lifecycle = 'ending';
    void this.state.flush(() => this.close()).catch((error: unknown) => this.fail(error));
  }

  private sendOutput(data: string) {
    void this.state.write(data, (output, sequence) => {
      if (this.attachment && this.attachment.phase !== 'snapshotting') {
        this.sendJson({ type: 'output', data: output, sequence });
      }
    }).catch((error: unknown) => this.fail(error));
  }

  private sendJson(payload: ServerMessage) {
    if (this.attachment) sendJson(this.attachment.peer, payload);
  }

  private fail(error: unknown) {
    if (this.lifecycle === 'closed') return;
    this.sendJson({ type: 'error', message: error instanceof Error ? error.message : 'Terminal state failed' });
    this.close();
  }
}

function safeClose(peer: TerminalPeer) {
  if (peer.isOpen()) {
    peer.close();
  }
}

function sendJson(peer: TerminalPeer, payload: ServerMessage) {
  if (peer.isOpen()) {
    peer.send(payload);
  }
}
