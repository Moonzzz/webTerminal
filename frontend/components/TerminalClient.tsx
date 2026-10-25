'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, TouchEvent as ReactTouchEvent } from 'react';
import { MobileTerminalToolbar } from './terminal/MobileTerminalToolbar';
import { TerminalCopyOverlay } from './terminal/TerminalCopyOverlay';
import {
  getDefaultShortcutItems,
  getShortcutItemKey,
} from './terminal/shortcut-actions';
import {
  normalizeCustomShortcutDraft,
  readStoredShortcutItems,
  writeStoredShortcutItems,
} from './terminal/shortcut-storage';
import {
  isMobileTerminalTouch,
  shouldIgnoreTouchTarget,
} from './terminal/touch-scroll';
import { useTerminalSession } from './terminal/useTerminalSession';
import { useTerminalViewport } from './terminal/useTerminalViewport';
import type {
  BuiltInShortcutItem,
  ShortcutActionId,
  ShortcutItem,
  TerminalTarget,
} from './terminal/types';

const TARGET_STORAGE_KEY = 'webTerminal-custom-node';
const COPY_MODE_LONG_PRESS_MS = 520;
const COPY_MODE_MOVE_TOLERANCE_PX = 10;

type Props = {
  nodeName: string;
  useStoredTarget?: boolean;
};

export default function TerminalClient({
  nodeName,
  useStoredTarget = false,
}: Props) {
  const pasteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const copyLongPressTimerRef = useRef<number | undefined>(undefined);
  const copyLongPressStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const [storedTarget, setStoredTarget] = useState<TerminalTarget | undefined>();
  const [storageLoaded, setStorageLoaded] = useState(!useStoredTarget);
  const [passwordInput, setPasswordInput] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [shortcutItems, setShortcutItems] = useState<ShortcutItem[]>(getDefaultShortcutItems);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [pastePanelOpen, setPastePanelOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [customShortcutLabel, setCustomShortcutLabel] = useState('');
  const [customShortcutInput, setCustomShortcutInput] = useState('');
  const [customShortcutError, setCustomShortcutError] = useState('');
  const [copyModeOpen, setCopyModeOpen] = useState(false);
  const [copyModeText, setCopyModeText] = useState('');
  const sessionTarget = useMemo(() => {
    const base = storedTarget;
    if (!base) return undefined;
    if (base.password || !sshPassword) return base;
    return { ...base, password: sshPassword };
  }, [sshPassword, storedTarget]);
  const needsPassword = Boolean(storageLoaded && sessionTarget && !sessionTarget.password);
  const {
    blurTerminal,
    containerRef,
    focusTerminal,
    pasteText: pasteTextToTerminal,
    readCopyText,
    resizeTerminal,
    sendShortcutItem,
  } = useTerminalSession({
    needsPassword,
    nodeName,
    sessionTarget,
    storageLoaded,
  });

  useTerminalViewport({
    anchorRef: containerRef,
    onViewportChange: resizeTerminal,
  });

  useEffect(() => {
    if (!useStoredTarget) {
      setStorageLoaded(true);
      return;
    }

    setStoredTarget(readStoredTarget());
    setStorageLoaded(true);
  }, [useStoredTarget]);

  useEffect(() => {
    setShortcutItems(readStoredShortcutItems());
  }, []);

  useEffect(() => {
    return () => {
      clearCopyLongPressTimer(copyLongPressTimerRef);
    };
  }, []);

  const toggleShortcutEditor = useCallback(() => {
    setCopyModeOpen(false);
    setPastePanelOpen(false);
    setShortcutEditorOpen((isOpen) => !isOpen);
  }, []);

  const openPastePanel = useCallback(() => {
    setCopyModeOpen(false);
    setShortcutEditorOpen(false);
    setPastePanelOpen(true);
    window.requestAnimationFrame(() => {
      pasteInputRef.current?.focus();
    });
  }, []);

  const closePastePanel = useCallback(() => {
    setPastePanelOpen(false);
    setPasteText('');
    focusTerminal();
  }, [focusTerminal]);

  const submitPaste = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!pasteText) {
        pasteInputRef.current?.focus();
        return;
      }

      pasteTextToTerminal(pasteText);

      setPasteText('');
      setPastePanelOpen(false);
      focusTerminal();
    },
    [focusTerminal, pasteText, pasteTextToTerminal]
  );

  const openCopyMode = useCallback(() => {
    const text = readCopyText();
    if (text === undefined) return;

    setPastePanelOpen(false);
    setShortcutEditorOpen(false);
    setCopyModeText(text);
    setCopyModeOpen(true);
    blurTerminal();
  }, [blurTerminal, readCopyText]);

  const closeCopyMode = useCallback(() => {
    setCopyModeOpen(false);
    setCopyModeText('');
    focusTerminal();
  }, [focusTerminal]);

  const handleTerminalTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (!isMobileTerminalTouch() || event.touches.length !== 1 || copyModeOpen) {
        return;
      }
      if (shouldIgnoreTouchTarget(event.target)) {
        return;
      }

      const touch = event.touches[0];
      copyLongPressStartRef.current = { x: touch.clientX, y: touch.clientY };
      clearCopyLongPressTimer(copyLongPressTimerRef);
      copyLongPressTimerRef.current = window.setTimeout(() => {
        copyLongPressTimerRef.current = undefined;
        copyLongPressStartRef.current = undefined;
        openCopyMode();
      }, COPY_MODE_LONG_PRESS_MS);
    },
    [copyModeOpen, openCopyMode]
  );

  const handleTerminalTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const start = copyLongPressStartRef.current;
    if (!start || event.touches.length !== 1) {
      clearCopyLongPressTimer(copyLongPressTimerRef);
      copyLongPressStartRef.current = undefined;
      return;
    }

    const touch = event.touches[0];
    if (
      Math.abs(touch.clientX - start.x) > COPY_MODE_MOVE_TOLERANCE_PX ||
      Math.abs(touch.clientY - start.y) > COPY_MODE_MOVE_TOLERANCE_PX
    ) {
      clearCopyLongPressTimer(copyLongPressTimerRef);
      copyLongPressStartRef.current = undefined;
    }
  }, []);

  const handleTerminalTouchEnd = useCallback(() => {
    clearCopyLongPressTimer(copyLongPressTimerRef);
    copyLongPressStartRef.current = undefined;
  }, []);

  const toggleShortcutAction = useCallback((actionId: ShortcutActionId) => {
    setShortcutItems((current) => {
      const exists = current.some((item) => isBuiltInShortcutItem(item, actionId));
      const addedItem: BuiltInShortcutItem = { type: 'built-in', actionId };
      const next = exists
        ? current.filter((item) => !isBuiltInShortcutItem(item, actionId))
        : [...current, addedItem];

      writeStoredShortcutItems(next);
      return next;
    });
  }, []);

  const moveShortcutItem = useCallback((itemKey: string, direction: -1 | 1) => {
    setShortcutItems((current) => {
      const index = current.findIndex((item) => getShortcutItemKey(item) === itemKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      writeStoredShortcutItems(next);
      return next;
    });
  }, []);

  const removeCustomShortcut = useCallback((itemId: string) => {
    setShortcutItems((current) => {
      const next = current.filter((item) => item.type !== 'custom' || item.id !== itemId);
      writeStoredShortcutItems(next);
      return next;
    });
  }, []);

  const addCustomShortcut = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalized = normalizeCustomShortcutDraft(customShortcutLabel, customShortcutInput);

      if (!normalized) {
        setCustomShortcutError('请输入名称和发送内容');
        return;
      }

      setShortcutItems((current) => {
        const next = [...current, normalized];
        writeStoredShortcutItems(next);
        return next;
      });
      setCustomShortcutLabel('');
      setCustomShortcutInput('');
      setCustomShortcutError('');
    },
    [customShortcutInput, customShortcutLabel]
  );

  const resetShortcutActions = useCallback(() => {
    const next = getDefaultShortcutItems();
    setShortcutItems(next);
    writeStoredShortcutItems(next);
    setCustomShortcutError('');
  }, []);

  const submitPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passwordInput) {
      setPasswordError('请输入 SSH 密码');
      return;
    }

    setPasswordError('');
    setSshPassword(passwordInput);
    setPasswordInput('');
  };

  return (
    <div className="terminal-client">
      <div
        ref={containerRef}
        className="terminal-container"
        onTouchStart={handleTerminalTouchStart}
        onTouchMove={handleTerminalTouchMove}
        onTouchEnd={handleTerminalTouchEnd}
        onTouchCancel={handleTerminalTouchEnd}
      />
      {copyModeOpen ? <TerminalCopyOverlay text={copyModeText} onClose={closeCopyMode} /> : null}
      {storageLoaded && !needsPassword ? (
        <MobileTerminalToolbar
          shortcutItems={shortcutItems}
          customShortcutError={customShortcutError}
          customShortcutInput={customShortcutInput}
          customShortcutLabel={customShortcutLabel}
          isEditorOpen={shortcutEditorOpen}
          isPasteOpen={pastePanelOpen}
          pasteInputRef={pasteInputRef}
          pasteText={pasteText}
          onAddCustomShortcut={addCustomShortcut}
          onClosePaste={closePastePanel}
          onCustomShortcutInputChange={setCustomShortcutInput}
          onCustomShortcutLabelChange={setCustomShortcutLabel}
          onMoveShortcut={moveShortcutItem}
          onOpenCopy={openCopyMode}
          onOpenPaste={openPastePanel}
          onPasteSubmit={submitPaste}
          onPasteTextChange={setPasteText}
          onRemoveCustomShortcut={removeCustomShortcut}
          onResetShortcuts={resetShortcutActions}
          onShortcutPress={sendShortcutItem}
          onToggleEditor={toggleShortcutEditor}
          onToggleShortcut={toggleShortcutAction}
        />
      ) : null}
      {needsPassword ? (
        <form
          className="ssh-password-panel"
          autoComplete="off"
          data-form-type="other"
          onSubmit={submitPassword}
        >
          <div className="ssh-password-title">输入 SSH 密码</div>
          <div className="ssh-password-target">
            {sessionTarget?.username}@{sessionTarget?.host}:{sessionTarget?.port}
          </div>
          <input
            aria-label="SSH 密码"
            name="ssh-session-secret"
            className="ssh-secret-input"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            type="text"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            inputMode="text"
            spellCheck={false}
            data-1p-ignore
            data-bwignore
            data-lpignore="true"
          />
          <button type="submit">连接</button>
          {passwordError ? <div className="form-error">{passwordError}</div> : null}
        </form>
      ) : null}
    </div>
  );
}

function readStoredTarget() {
  try {
    const raw = window.sessionStorage.getItem(TARGET_STORAGE_KEY);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const host = typeof parsed.host === 'string' ? parsed.host.trim() : '';
    const username = typeof parsed.username === 'string' ? parsed.username.trim() : '';
    const port = typeof parsed.port === 'number' ? parsed.port : Number(parsed.port);
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : undefined;

    if (!host || !username || !Number.isInteger(port)) {
      return undefined;
    }

    return {
      name: name || `${username}@${host}:${port}`,
      host,
      port,
      username,
    };
  } catch {
    return undefined;
  }
}

function clearCopyLongPressTimer(timerRef: { current: number | undefined }) {
  if (timerRef.current !== undefined) {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }
}

function isBuiltInShortcutItem(item: ShortcutItem, actionId: ShortcutActionId) {
  return item.type === 'built-in' && item.actionId === actionId;
}
