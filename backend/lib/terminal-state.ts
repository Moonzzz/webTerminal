import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';

export type TerminalSnapshot = {
  data: string;
  sequence: number;
  cols: number;
  rows: number;
  scrollback: number;
};

/** Keeps incomplete VT instructions out of snapshots; terminal interpretation stays in xterm. */
class OutputFramer {
  private pending = '';
  private mode: 'text' | 'escape' | 'csi' | 'osc' | 'string' = 'text';
  private escapeIntermediate = false;

  get bytes() {
    return Buffer.byteLength(this.pending);
  }

  push(data: string) {
    const offset = this.pending.length;
    const combined = this.pending + data;
    let boundary = 0;
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (code === 0x18 || code === 0x1a) {
        this.mode = 'text';
      } else if (this.mode === 'osc' || this.mode === 'string') {
        if (code === 0x1b) {
          this.mode = 'escape';
          this.escapeIntermediate = false;
        } else if (code === 0x9c || (this.mode === 'osc' && code === 7)) {
          this.mode = 'text';
        }
      } else if (code === 0x1b) {
        this.mode = 'escape';
        this.escapeIntermediate = false;
      } else if (code === 0x9b) {
        this.mode = 'csi';
      } else if (code === 0x9d) {
        this.mode = 'osc';
      } else if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) {
        this.mode = 'string';
      } else if (this.mode === 'escape') {
        if (code >= 0x20 && code <= 0x2f) this.escapeIntermediate = true;
        else if (!this.escapeIntermediate && code === 0x5b) this.mode = 'csi';
        else if (!this.escapeIntermediate && code === 0x5d) this.mode = 'osc';
        else if (!this.escapeIntermediate && [0x50, 0x58, 0x5e, 0x5f].includes(code)) this.mode = 'string';
        else if (code >= 0x30 && code <= 0x7e) this.mode = 'text';
      } else if (this.mode === 'csi' && code >= 0x40 && code <= 0x7e) {
        this.mode = 'text';
      }
      if (this.mode === 'text') boundary = offset + i + 1;
    }
    this.pending = combined.slice(boundary);
    return combined.slice(0, boundary);
  }
}

export class TerminalState {
  private readonly terminal: Terminal;
  private readonly serializer = new SerializeAddon();
  private readonly framer = new OutputFramer();
  private queue: Promise<unknown> = Promise.resolve();
  private queuedBytes = 0;
  private sequence = 0;
  private disposed = false;
  private failure: unknown;
  private finishWrite: (() => void) | undefined;

  constructor(
    cols: number,
    rows: number,
    private readonly scrollback = 5000,
    private readonly maxPendingBytes = 4 * 1024 * 1024,
  ) {
    this.terminal = new Terminal({ cols, rows, scrollback, convertEol: true, allowProposedApi: true });
    this.terminal.loadAddon(this.serializer);
  }

  write(data: string, publish: (data: string, sequence: number) => void) {
    return this.enqueue(async () => {
      const complete = this.framer.push(data);
      if (this.framer.bytes > this.maxPendingBytes) throw new Error('Terminal control sequence exceeds buffer limit');
      if (!complete) return;
      await this.parse(complete);
      if (!this.disposed) publish(complete, ++this.sequence);
    }, Buffer.byteLength(data));
  }

  snapshot(publish: (snapshot: TerminalSnapshot) => void) {
    return this.enqueue(async () => {
      // SerializeAddon 0.14 restores tracking but omits mouse encoding. Query
      // the emulator through DECRQM instead of accessing xterm private fields.
      let mouseEncoding = '';
      const listener = this.terminal.onData((reply) => {
        if (reply === '\x1b[?1006;1$y') mouseEncoding = '\x1b[?1006h';
        if (reply === '\x1b[?1016;1$y') mouseEncoding = '\x1b[?1016h';
      });
      try {
        await this.parse('\x1b[?1006$p\x1b[?1016$p');
      } finally {
        listener.dispose();
      }
      if (this.disposed) return;
      publish({
        data: this.serializer.serialize({ scrollback: this.scrollback }) + mouseEncoding,
        sequence: this.sequence,
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        scrollback: this.scrollback,
      });
    });
  }

  resize(cols: number, rows: number, complete?: () => void, isCurrent: () => boolean = () => true) {
    return this.enqueue(() => {
      if (!isCurrent()) return;
      this.terminal.resize(cols, rows);
      complete?.();
    });
  }

  flush(complete: () => void) {
    return this.enqueue(complete);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terminal.dispose();
    this.finishWrite?.();
    this.finishWrite = undefined;
  }

  private parse(data: string) {
    return new Promise<void>((resolve) => {
      this.finishWrite = resolve;
      this.terminal.write(data, () => {
        this.finishWrite = undefined;
        resolve();
      });
    });
  }

  private enqueue(operation: () => void | Promise<void>, bytes = 0): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Terminal state closed'));
    if (this.queuedBytes + this.framer.bytes + bytes > this.maxPendingBytes) {
      this.failure = new Error('Terminal output exceeds buffer limit');
      return Promise.reject(this.failure);
    }
    this.queuedBytes += bytes;
    const result = this.queue.then(async () => {
      if (this.disposed) throw new Error('Terminal state closed');
      if (this.failure) throw this.failure;
      await operation();
    }).finally(() => { this.queuedBytes -= bytes; });
    this.queue = result.catch((error: unknown) => { this.failure = error; });
    return result;
  }
}
