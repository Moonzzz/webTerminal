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
