import type { ClientMessage, ServerMessage, TerminalDimensions } from '../../../shared/terminal-protocol';

type RestoreMessage = Extract<ServerMessage, { type: 'restore' | 'restored' | 'output' }>;
type RestoreState =
  | { phase: 'waiting-snapshot' | 'closed' }
  | { phase: 'parsing-snapshot' | 'catching-up' | 'interactive'; restoreId: string; sequence: number };

type RestoreOptions = {
  terminal: {
    reset: () => void;
    resize: (cols: number, rows: number) => void;
    write: (data: string, complete: () => void) => void;
    options: { scrollback?: number };
  };
  send: (message: ClientMessage) => Promise<void>;
  onInput: (data: string) => void;
  proposeDimensions: () => TerminalDimensions | undefined;
  onPhaseChange: (phase: RestoreState['phase']) => void;
};

/** Owns recovery order and permissions; it has no socket, DOM or React lifecycle. */
export class TerminalRestoreController {
  private state: RestoreState = { phase: 'waiting-snapshot' };
  private writeSource: 'snapshot' | 'live' | undefined;
  private finishWrite: (() => void) | undefined;
  private snapshotParsed = false;

  constructor(private readonly options: RestoreOptions) {}

  get interactive() { return this.state.phase === 'interactive'; }
  get hasSnapshot() { return this.snapshotParsed; }
  get acceptsSideEffects() {
    return this.writeSource !== 'snapshot' &&
      (this.state.phase === 'catching-up' || this.interactive);
  }

  async handle(message: RestoreMessage) {
    if (this.state.phase === 'closed') return;
    const { terminal } = this.options;
    switch (message.type) {
      case 'restore': {
        if (this.state.phase !== 'waiting-snapshot') throw new Error('Unexpected terminal snapshot');
        const state = { phase: 'parsing-snapshot', restoreId: message.restoreId, sequence: message.sequence } as const;
        this.transition(state);
        terminal.reset();
        terminal.options.scrollback = message.scrollback;
        terminal.resize(message.cols, message.rows);
        await this.write(message.data, 'snapshot');
        if (!this.isCurrent(state)) return;
        this.snapshotParsed = true;
        this.transition({ ...state, phase: 'catching-up' });
        const dimensions = this.options.proposeDimensions() ?? message;
        await this.options.send({ type: 'restore-ready', restoreId: message.restoreId,
          cols: dimensions.cols, rows: dimensions.rows });
        return;
      }
      case 'restored': {
        if (this.state.phase !== 'catching-up' || message.restoreId !== this.state.restoreId) {
          throw new Error('Unexpected restore acknowledgement');
        }
        terminal.resize(message.cols, message.rows);
        this.transition({ ...this.state, phase: 'interactive' });
        return;
      }
      case 'output': {
        const state = this.state;
        if ((state.phase !== 'catching-up' && state.phase !== 'interactive') ||
          message.sequence !== state.sequence + 1) throw new Error('Terminal output sequence mismatch');
        await this.write(message.data, 'live');
        if (this.isCurrent(state)) state.sequence = message.sequence;
      }
    }
  }

  onTerminalData(data: string) {
    if (this.writeSource === 'snapshot' || this.state.phase === 'closed') return;
    if (this.writeSource === 'live' && this.state.phase === 'catching-up') {
      // xterm emits query replies while parsing. Keyboard and application input
      // are gated by interactive at their entry points during recovery. Once
      // interactive, both kinds of data use the ordinary buffered input path.
      void this.options.send({ type: 'terminal-reply', restoreId: this.state.restoreId, data });
    } else if (this.interactive) {
      this.options.onInput(data);
    }
  }

  close() {
    if (this.state.phase === 'closed') return;
    this.transition({ phase: 'closed' });
    this.finishWrite?.();
    this.finishWrite = undefined;
  }

  private transition(state: RestoreState) {
    this.state = state;
    this.options.onPhaseChange(state.phase);
  }

  private isCurrent(state: RestoreState) { return this.state === state; }

  private async write(data: string, source: 'snapshot' | 'live') {
    this.writeSource = source;
    try {
      await new Promise<void>((resolve) => {
        this.finishWrite = resolve;
        this.options.terminal.write(data, resolve);
      });
    } finally {
      this.finishWrite = undefined;
      this.writeSource = undefined;
    }
  }
}
