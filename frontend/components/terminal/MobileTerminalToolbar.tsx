import { useCallback, useRef } from 'react';
import type {
  FormEvent,
  RefObject,
  TouchEvent as ReactTouchEvent,
} from 'react';
import {
  CUSTOM_SHORTCUT_INPUT_MAX_CHARS,
  CUSTOM_SHORTCUT_LABEL_MAX_CHARS,
} from './shortcut-storage';
import {
  getBuiltInShortcutItemKey,
  getShortcutItemKey,
  getShortcutItemView,
  SHORTCUT_ACTIONS,
} from './shortcut-actions';
import type {
  BuiltInShortcutItem,
  CustomShortcutItem,
  ShortcutActionId,
  ShortcutItem,
} from './types';

const SHORTCUT_TOUCH_MOVE_TOLERANCE_PX = 10;

type ShortcutPressOptions = {
  preserveFocus?: boolean;
};

type MobileTerminalToolbarProps = {
  shortcutItems: readonly ShortcutItem[];
  customShortcutError: string;
  customShortcutInput: string;
  customShortcutLabel: string;
  isEditorOpen: boolean;
  isPasteOpen: boolean;
  pasteInputRef: RefObject<HTMLTextAreaElement | null>;
  pasteText: string;
  onAddCustomShortcut: (event: FormEvent<HTMLFormElement>) => void;
  onClosePaste: () => void;
  onCustomShortcutInputChange: (value: string) => void;
  onCustomShortcutLabelChange: (value: string) => void;
  onMoveShortcut: (itemKey: string, direction: -1 | 1) => void;
  onOpenCopy: () => void;
  onOpenPaste: () => void;
  onPasteSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPasteTextChange: (value: string) => void;
  onRemoveCustomShortcut: (itemId: string) => void;
  onResetShortcuts: () => void;
  onShortcutPress: (item: ShortcutItem, options?: ShortcutPressOptions) => void;
  onToggleEditor: () => void;
  onToggleShortcut: (actionId: ShortcutActionId) => void;
};

export function MobileTerminalToolbar({
  shortcutItems,
  customShortcutError,
  customShortcutInput,
  customShortcutLabel,
  isEditorOpen,
  isPasteOpen,
  pasteInputRef,
  pasteText,
  onAddCustomShortcut,
  onClosePaste,
  onCustomShortcutInputChange,
  onCustomShortcutLabelChange,
  onMoveShortcut,
  onOpenCopy,
  onOpenPaste,
  onPasteSubmit,
  onPasteTextChange,
  onRemoveCustomShortcut,
  onResetShortcuts,
  onShortcutPress,
  onToggleEditor,
  onToggleShortcut,
}: MobileTerminalToolbarProps) {
  const shortcutScrollRef = useRef<HTMLDivElement | null>(null);
  const shortcutTouchRef = useRef<{
    itemKey: string;
    startX: number;
    startY: number;
    lastX: number;
    moved: boolean;
  } | null>(null);
  const lastShortcutTouchAtRef = useRef(0);
  const selectedBuiltInIds = new Set(
    shortcutItems
      .filter((item): item is BuiltInShortcutItem => item.type === 'built-in')
      .map((item) => item.actionId)
  );
  const customItems = shortcutItems.filter(
    (item): item is CustomShortcutItem => item.type === 'custom'
  );

  const handleShortcutTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement>, itemKey: string) => {
      if (event.touches.length !== 1) {
        shortcutTouchRef.current = null;
        return;
      }

      const touch = event.touches[0];
      shortcutTouchRef.current = {
        itemKey,
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        moved: false,
      };
    },
    []
  );

  const handleShortcutTouchMove = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    const current = shortcutTouchRef.current;
    if (!current || event.touches.length !== 1) {
      shortcutTouchRef.current = null;
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - current.lastX;
    current.lastX = touch.clientX;

    if (
      Math.abs(touch.clientX - current.startX) > SHORTCUT_TOUCH_MOVE_TOLERANCE_PX ||
      Math.abs(touch.clientY - current.startY) > SHORTCUT_TOUCH_MOVE_TOLERANCE_PX
    ) {
      current.moved = true;
    }

    if (current.moved) {
      const scrollContainer = event.currentTarget.closest<HTMLElement>('.terminal-shortcut-scroll');
      if (scrollContainer) {
        scrollContainer.scrollLeft -= deltaX;
      }
      event.preventDefault();
    }
  }, []);

  const handleShortcutTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement>, item: ShortcutItem, itemKey: string) => {
      const current = shortcutTouchRef.current;
      shortcutTouchRef.current = null;

      if (!current || current.itemKey !== itemKey || current.moved) {
        lastShortcutTouchAtRef.current = Date.now();
        return;
      }

      event.preventDefault();
      lastShortcutTouchAtRef.current = Date.now();
      onShortcutPress(item, { preserveFocus: true });
    },
    [onShortcutPress]
  );

  const handleShortcutTouchCancel = useCallback(() => {
    shortcutTouchRef.current = null;
  }, []);

  return (
    <div className="mobile-terminal-bar" aria-label="Terminal 快捷键栏">
      {isPasteOpen ? (
        <form className="terminal-paste-panel" onSubmit={onPasteSubmit}>
          <textarea
            ref={pasteInputRef}
            className="terminal-paste-input"
            aria-label="粘贴输入"
            value={pasteText}
            onChange={(event) => onPasteTextChange(event.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="terminal-paste-actions">
            <button type="button" className="terminal-toolbar-button" onClick={onClosePaste}>
              关闭
            </button>
            <button type="submit" className="terminal-toolbar-button terminal-toolbar-primary">
              发送
            </button>
          </div>
        </form>
      ) : null}

      {isEditorOpen ? (
        <div className="terminal-shortcut-editor" role="dialog" aria-label="自定义快捷键">
          <div className="terminal-shortcut-editor-actions">
            <button type="button" className="terminal-toolbar-button" onClick={onResetShortcuts}>
              恢复默认
            </button>
          </div>
          <div className="terminal-shortcut-editor-list">
            {SHORTCUT_ACTIONS.map((action) => {
              const selected = selectedBuiltInIds.has(action.id);
              const itemKey = getBuiltInShortcutItemKey(action.id);
              const index = shortcutItems.findIndex((item) => getShortcutItemKey(item) === itemKey);

              return (
                <div key={action.id} className="terminal-shortcut-editor-item">
                  <label className="terminal-shortcut-toggle">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleShortcut(action.id)}
                    />
                    <span>{action.label}</span>
                  </label>
                  <button
                    type="button"
                    className="terminal-shortcut-order-button"
                    disabled={!selected || index <= 0}
                    aria-label={`${action.description} 上移`}
                    onClick={() => onMoveShortcut(itemKey, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="terminal-shortcut-order-button"
                    disabled={!selected || index < 0 || index >= shortcutItems.length - 1}
                    aria-label={`${action.description} 下移`}
                    onClick={() => onMoveShortcut(itemKey, 1)}
                  >
                    ↓
                  </button>
                </div>
              );
            })}
            {customItems.map((item) => {
              const itemKey = getShortcutItemKey(item);
              const index = shortcutItems.findIndex(
                (candidate) => getShortcutItemKey(candidate) === itemKey
              );

              return (
                <div
                  key={item.id}
                  className="terminal-shortcut-editor-item terminal-shortcut-editor-item-custom"
                >
                  <div className="terminal-shortcut-custom-summary">
                    <span>{item.label}</span>
                    <button
                      type="button"
                      className="terminal-shortcut-remove-button"
                      onClick={() => onRemoveCustomShortcut(item.id)}
                    >
                      删除
                    </button>
                  </div>
                  <button
                    type="button"
                    className="terminal-shortcut-order-button"
                    disabled={index <= 0}
                    aria-label={`${item.label} 上移`}
                    onClick={() => onMoveShortcut(itemKey, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="terminal-shortcut-order-button"
                    disabled={index < 0 || index >= shortcutItems.length - 1}
                    aria-label={`${item.label} 下移`}
                    onClick={() => onMoveShortcut(itemKey, 1)}
                  >
                    ↓
                  </button>
                </div>
              );
            })}
          </div>
          <form className="terminal-custom-shortcut-form" onSubmit={onAddCustomShortcut}>
            <input
              aria-label="自定义快捷键名称"
              value={customShortcutLabel}
              maxLength={CUSTOM_SHORTCUT_LABEL_MAX_CHARS}
              onChange={(event) => onCustomShortcutLabelChange(event.target.value)}
              placeholder="名称"
              autoComplete="off"
            />
            <input
              aria-label="自定义快捷键发送内容"
              value={customShortcutInput}
              maxLength={CUSTOM_SHORTCUT_INPUT_MAX_CHARS}
              onChange={(event) => onCustomShortcutInputChange(event.target.value)}
              placeholder="发送内容"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <button type="submit" className="terminal-toolbar-button terminal-toolbar-primary">
              添加
            </button>
            {customShortcutError ? (
              <div className="terminal-shortcut-error">{customShortcutError}</div>
            ) : null}
          </form>
        </div>
      ) : null}

      <div className="terminal-shortcut-row">
        <div ref={shortcutScrollRef} className="terminal-shortcut-scroll" aria-label="快捷键">
          {shortcutItems.map((item) => {
            const view = getShortcutItemView(item);
            if (!view) return null;
            const itemKey = getShortcutItemKey(item);

            return (
              <button
                key={itemKey}
                type="button"
                className="terminal-shortcut-button"
                aria-label={view.description}
                tabIndex={-1}
                onClick={(event) => {
                  if (Date.now() - lastShortcutTouchAtRef.current < 700) {
                    event.preventDefault();
                    return;
                  }

                  onShortcutPress(item);
                }}
                onTouchStart={(event) => handleShortcutTouchStart(event, itemKey)}
                onTouchMove={handleShortcutTouchMove}
                onTouchEnd={(event) => handleShortcutTouchEnd(event, item, itemKey)}
                onTouchCancel={handleShortcutTouchCancel}
              >
                {view.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="terminal-toolbar-button"
          aria-label="选择 terminal 文本"
          onClick={onOpenCopy}
        >
          选择
        </button>
        <button
          type="button"
          className="terminal-toolbar-button"
          aria-label="打开粘贴输入"
          onClick={onOpenPaste}
        >
          粘贴
        </button>
        <button
          type="button"
          className="terminal-toolbar-button"
          aria-label="自定义快捷键"
          aria-expanded={isEditorOpen}
          onClick={onToggleEditor}
        >
          快捷键
        </button>
      </div>
    </div>
  );
}
