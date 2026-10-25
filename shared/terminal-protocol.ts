/** Wire contract only: no browser, SSH or encryption dependencies. */
export type TerminalTargetInput = {
  name?: string;
  host: string;
  port: number;
  username: string;
  password: string;
};

export type TerminalDimensions = { cols: number; rows: number };

export type TerminalSnapshot = TerminalDimensions & {
  data: string;
  sequence: number;
  scrollback: number;
};

export type ClientMessage =
  | { type: 'auth' }
  | ({ type: 'init'; target?: TerminalTargetInput; resumeSessionId?: string } & TerminalDimensions)
  | ({ type: 'restore-ready'; restoreId: string } & TerminalDimensions)
  | { type: 'terminal-reply'; restoreId: string; data: string }
  | { type: 'input'; data: string }
  | ({ type: 'resize' } & TerminalDimensions)
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'session'; sessionId: string; resumed?: boolean }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | ({ type: 'restore'; restoreId: string } & TerminalSnapshot)
  | ({ type: 'restored'; restoreId: string } & TerminalDimensions)
  | { type: 'output'; data: string; sequence: number }
  | { type: 'pong'; ts: number };

export const TERMINAL_TRANSPORT_LIMITS = {
  maxPendingBytes: 16 * 1024 * 1024,
  maxPendingMessages: 2048,
  maxInputChars: 64 * 1024,
} as const;
