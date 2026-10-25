import { decryptSecurePayload, encryptSecurePayload, ensureSecureSession, type SecureSession } from '../../lib/secure-channel';
import { BoundedTaskQueue } from '../../../shared/bounded-task-queue';
import { TERMINAL_TRANSPORT_LIMITS as limits, type ClientMessage, type ServerMessage } from '../../../shared/terminal-protocol';

const INPUT_FLUSH_MS = 16;
const INPUT_HIGH_WATER_BYTES = 256 * 1024;
const KEEPALIVE_MS = 20_000;

type TransportOptions = {
  url: string;
  onOpen: () => Promise<void>;
  onMessage: (message: ServerMessage) => Promise<void>;
  onError: (error: Error) => void;
  onClose: () => void;
};

/** Owns secure wire ordering, admission limits and socket lifetime only. */
export class SecureTerminalTransport {
  private readonly outgoing = new BoundedTaskQueue(limits);
  private readonly incoming = new BoundedTaskQueue(limits);
  private readonly encoder = new TextEncoder();
  private socket?: WebSocket;
  private secureSession?: SecureSession;
  private serverSequence = 0;
  private pendingInput = '';
  private disposed = false;
  private failed = false;
  private inputTimer?: ReturnType<typeof setInterval>;
  private keepaliveTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: TransportOptions) {}

  get isOpen() { return !this.disposed && !this.failed && this.socket?.readyState === WebSocket.OPEN; }

  async connect() {
    try {
      this.secureSession = await ensureSecureSession();
      if (this.disposed || this.failed) return;
      const socket = this.socket = new WebSocket(this.options.url);
      socket.onopen = () => {
        this.inputTimer = setInterval(() => this.flushInput(), INPUT_FLUSH_MS);
        this.keepaliveTimer = setInterval(() => { void this.send({ type: 'ping' }); }, KEEPALIVE_MS);
        void this.options.onOpen().catch((error: unknown) => this.fail(error));
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        if (this.disposed || this.failed) return;
        const bytes = this.encoder.encode(event.data).byteLength;
        void this.incoming.enqueue(bytes, async () => {
          if (this.disposed || this.failed) return;
          const decrypted = await decryptSecurePayload<ServerMessage>(
            this.secureSession!, JSON.parse(event.data), 'ws:server', this.serverSequence);
          if (this.disposed || this.failed) return;
          this.serverSequence = decrypted.sequence;
          await this.options.onMessage(decrypted.payload);
        }).catch((error: unknown) => this.fail(error));
      };
      socket.onerror = () => this.fail(new Error('终端网络连接异常'));
      socket.onclose = () => {
        this.clearTimers();
        this.outgoing.stop();
        // Normal close drains already received final output before notifying UI.
        void this.incoming.drain().then(() => {
          if (!this.disposed) this.options.onClose();
        });
      };
    } catch (error) {
      this.fail(error);
    }
  }

  send(message: ClientMessage): Promise<void> {
    if (!this.isOpen) return Promise.resolve();
    const bytes = this.encoder.encode(JSON.stringify(message)).byteLength;
    return this.outgoing.enqueue(bytes, async () => {
      if (!this.isOpen) return;
      const envelope = await encryptSecurePayload(this.secureSession!, 'ws:client', message);
      if (!this.isOpen) return;
      const frame = JSON.stringify(envelope);
      if (this.socket!.bufferedAmount + this.encoder.encode(frame).byteLength > limits.maxPendingBytes) {
        throw new Error('Terminal transport backlog exceeds limit');
      }
      this.socket!.send(frame);
    }).catch((error: unknown) => this.fail(error));
  }

  input(data: string) {
    if (!this.isOpen) return;
    if (this.pendingInput.length + data.length > limits.maxInputChars) {
      this.fail(new Error('Terminal input backlog exceeds limit'));
      return;
    }
    this.pendingInput += data;
    this.flushInput();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.outgoing.stop();
    this.incoming.stop();
    this.socket?.close();
  }

  private flushInput() {
    if (!this.pendingInput || !this.isOpen || this.socket!.bufferedAmount > INPUT_HIGH_WATER_BYTES) return;
    const data = this.pendingInput;
    this.pendingInput = '';
    void this.send({ type: 'input', data });
  }

  private clearTimers() {
    clearInterval(this.inputTimer);
    clearInterval(this.keepaliveTimer);
    this.pendingInput = '';
  }

  private fail(caught: unknown) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.clearTimers();
    this.outgoing.stop();
    this.incoming.stop();
    this.options.onError(caught instanceof Error ? caught : new Error('Secure terminal transport failed'));
    this.socket?.close();
  }
}
