import type { Terminal as XTermTerminal } from '@xterm/xterm';
import type {
  ShortcutActionDefinition,
  ShortcutActionId,
  ShortcutItem,
} from './types';

export const DEFAULT_SHORTCUT_ACTION_IDS: ShortcutActionId[] = [
  'tab',
  'esc',
  'ctrl-c',
  'arrow-up',
  'arrow-down',
  'arrow-left',
  'arrow-right',
];

export const SHORTCUT_ACTIONS: readonly ShortcutActionDefinition[] = [
  { id: 'tab', label: 'Tab', description: 'Tab', input: '\t' },
  { id: 'esc', label: 'Esc', description: 'Esc', input: '\x1b' },
  { id: 'ctrl-c', label: 'Ctrl+C', description: 'Ctrl+C', input: '\x03' },
  {
    id: 'arrow-up',
    label: 'Up',
    description: 'Arrow Up',
    resolveInput: (term) => getArrowKeyInput(term, 'A'),
  },
  {
    id: 'arrow-down',
    label: 'Down',
    description: 'Arrow Down',
    resolveInput: (term) => getArrowKeyInput(term, 'B'),
  },
  {
    id: 'arrow-right',
    label: 'Right',
    description: 'Arrow Right',
    resolveInput: (term) => getArrowKeyInput(term, 'C'),
  },
  {
    id: 'arrow-left',
    label: 'Left',
    description: 'Arrow Left',
    resolveInput: (term) => getArrowKeyInput(term, 'D'),
  },
  { id: 'ctrl-d', label: 'Ctrl+D', description: 'Ctrl+D', input: '\x04' },
  { id: 'ctrl-z', label: 'Ctrl+Z', description: 'Ctrl+Z', input: '\x1a' },
  { id: 'ctrl-l', label: 'Ctrl+L', description: 'Ctrl+L', input: '\x0c' },
  { id: 'ctrl-u', label: 'Ctrl+U', description: 'Ctrl+U', input: '\x15' },
  { id: 'enter', label: 'Enter', description: 'Enter', input: '\r' },
  { id: 'backspace', label: 'Backspace', description: 'Backspace', input: '\x7f' },
  { id: 'home', label: 'Home', description: 'Home', input: '\x1b[H' },
  { id: 'end', label: 'End', description: 'End', input: '\x1b[F' },
  { id: 'page-up', label: 'PgUp', description: 'Page Up', input: '\x1b[5~' },
  { id: 'page-down', label: 'PgDn', description: 'Page Down', input: '\x1b[6~' },
];

const SHORTCUT_ACTION_BY_ID = new Map<ShortcutActionId, ShortcutActionDefinition>(
  SHORTCUT_ACTIONS.map((action) => [action.id, action])
);
const SHORTCUT_ACTION_ID_SET = new Set<ShortcutActionId>(
  SHORTCUT_ACTIONS.map((action) => action.id)
);

export function getDefaultShortcutItems(): ShortcutItem[] {
  return DEFAULT_SHORTCUT_ACTION_IDS.map((actionId) => ({ type: 'built-in', actionId }));
}

export function getShortcutItemKey(item: ShortcutItem) {
  return item.type === 'built-in' ? getBuiltInShortcutItemKey(item.actionId) : `custom:${item.id}`;
}

export function getBuiltInShortcutItemKey(actionId: ShortcutActionId) {
  return `built-in:${actionId}`;
}

export function getShortcutItemView(item: ShortcutItem) {
  if (item.type === 'custom') {
    return {
      label: item.label,
      description: item.label,
    };
  }

  const action = SHORTCUT_ACTION_BY_ID.get(item.actionId);
  if (!action) return undefined;

  return {
    label: action.label,
    description: action.description,
  };
}

export function resolveShortcutInput(item: ShortcutItem, term: XTermTerminal) {
  if (item.type === 'custom') {
    return item.input;
  }

  const action = SHORTCUT_ACTION_BY_ID.get(item.actionId);
  if (!action) return undefined;

  return action.resolveInput ? action.resolveInput(term) : action.input;
}

export function isShortcutActionId(value: unknown): value is ShortcutActionId {
  return typeof value === 'string' && SHORTCUT_ACTION_ID_SET.has(value as ShortcutActionId);
}

function getArrowKeyInput(term: XTermTerminal, code: 'A' | 'B' | 'C' | 'D') {
  return term.modes.applicationCursorKeysMode ? `\x1bO${code}` : `\x1b[${code}`;
}
