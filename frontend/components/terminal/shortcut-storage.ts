import { getDefaultShortcutItems, isShortcutActionId } from './shortcut-actions';
import type { CustomShortcutItem, ShortcutActionId, ShortcutItem } from './types';

export const CUSTOM_SHORTCUT_LABEL_MAX_CHARS = 14;
export const CUSTOM_SHORTCUT_INPUT_MAX_CHARS = 256;

const SHORTCUT_STORAGE_KEY = 'webTerminal-terminal-shortcuts';
const SHORTCUT_STORAGE_VERSION = 2;

export function readStoredShortcutItems() {
  if (typeof window === 'undefined') return getDefaultShortcutItems();

  try {
    const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (!raw) return getDefaultShortcutItems();

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return getDefaultShortcutItems();
    }

    if (parsed.version === 1) {
      return normalizeShortcutItems(parsed.items, getDefaultShortcutItems());
    }

    if (parsed.version !== SHORTCUT_STORAGE_VERSION) {
      return getDefaultShortcutItems();
    }

    return normalizeShortcutItems(parsed.items, getDefaultShortcutItems());
  } catch {
    return getDefaultShortcutItems();
  }
}

export function writeStoredShortcutItems(items: readonly ShortcutItem[]) {
  try {
    window.localStorage.setItem(
      SHORTCUT_STORAGE_KEY,
      JSON.stringify({
        version: SHORTCUT_STORAGE_VERSION,
        items: normalizeShortcutItems(items, getDefaultShortcutItems()),
      })
    );
  } catch {}
}

function normalizeShortcutItems(value: unknown, fallback: readonly ShortcutItem[]) {
  if (!Array.isArray(value)) return [...fallback];

  const normalized: ShortcutItem[] = [];
  const seen = new Set<ShortcutActionId>();
  const seenCustom = new Set<string>();

  for (const item of value) {
    if (isShortcutActionId(item)) {
      if (seen.has(item)) continue;

      normalized.push({ type: 'built-in', actionId: item });
      seen.add(item);
      continue;
    }

    const normalizedItem = normalizeStoredShortcutItem(item);
    if (!normalizedItem) continue;

    if (normalizedItem.type === 'built-in') {
      if (seen.has(normalizedItem.actionId)) continue;

      normalized.push(normalizedItem);
      seen.add(normalizedItem.actionId);
      continue;
    }

    if (seenCustom.has(normalizedItem.id)) continue;

    normalized.push(normalizedItem);
    seenCustom.add(normalizedItem.id);
  }

  if (value.length > 0 && normalized.length === 0) {
    return [...fallback];
  }

  return normalized;
}

function normalizeStoredShortcutItem(value: unknown): ShortcutItem | undefined {
  if (!isRecord(value)) return undefined;

  if (value.type === 'built-in' && isShortcutActionId(value.actionId)) {
    return {
      type: 'built-in',
      actionId: value.actionId,
    };
  }

  if (value.type === 'custom') {
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const label = normalizeCustomShortcutLabel(value.label);
    const input = normalizeStoredCustomShortcutInput(value.input);
    if (!id || !label || !input) return undefined;

    return {
      type: 'custom',
      id,
      label,
      input,
    };
  }

  return undefined;
}

export function normalizeCustomShortcutDraft(
  label: string,
  input: string
): CustomShortcutItem | undefined {
  const normalizedLabel = normalizeCustomShortcutLabel(label);
  const normalizedInput = normalizeCustomShortcutInput(input);
  if (!normalizedLabel || !normalizedInput) return undefined;

  return {
    type: 'custom',
    id: createCustomShortcutId(),
    label: normalizedLabel,
    input: normalizedInput,
  };
}

function normalizeCustomShortcutLabel(value: unknown) {
  if (typeof value !== 'string') return '';

  return value.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_SHORTCUT_LABEL_MAX_CHARS);
}

function normalizeCustomShortcutInput(value: unknown) {
  if (typeof value !== 'string') return '';

  const trimmed = value.trim();
  if (!trimmed) return '';

  return decodeShortcutInput(trimmed).slice(0, CUSTOM_SHORTCUT_INPUT_MAX_CHARS);
}

function normalizeStoredCustomShortcutInput(value: unknown) {
  if (typeof value !== 'string') return '';
  if (!value) return '';

  return value.slice(0, CUSTOM_SHORTCUT_INPUT_MAX_CHARS);
}

function decodeShortcutInput(value: string) {
  return value.replace(/\\(x[0-9a-fA-F]{2}|n|r|t|e|b|f|\\)/g, (_, sequence: string) => {
    if (sequence.startsWith('x')) {
      return String.fromCharCode(Number.parseInt(sequence.slice(1), 16));
    }

    switch (sequence) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'e':
        return '\x1b';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '\\':
        return '\\';
      default:
        return sequence;
    }
  });
}

function createCustomShortcutId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
