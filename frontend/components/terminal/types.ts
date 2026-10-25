import type { Terminal as XTermTerminal } from '@xterm/xterm';

export type ShortcutActionId =
  | 'tab'
  | 'esc'
  | 'ctrl-c'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'ctrl-d'
  | 'ctrl-z'
  | 'ctrl-l'
  | 'ctrl-u'
  | 'enter'
  | 'backspace'
  | 'home'
  | 'end'
  | 'page-up'
  | 'page-down';

export type ShortcutActionDefinition = {
  id: ShortcutActionId;
  label: string;
  description: string;
  input?: string;
  resolveInput?: (term: XTermTerminal) => string;
};

export type BuiltInShortcutItem = {
  type: 'built-in';
  actionId: ShortcutActionId;
};

export type CustomShortcutItem = {
  type: 'custom';
  id: string;
  label: string;
  input: string;
};

export type ShortcutItem = BuiltInShortcutItem | CustomShortcutItem;

export type TerminalTarget = {
  host: string;
  port: number;
  username: string;
  password?: string;
  name?: string;
};

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'session'; sessionId: string; resumed?: boolean }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'restore'; restoreId: string; data: string; sequence: number; cols: number; rows: number; scrollback: number }
  | { type: 'restored'; restoreId: string; cols: number; rows: number }
  | { type: 'output'; data: string; sequence: number }
  | { type: 'pong'; ts: number };
