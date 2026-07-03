'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, TouchEvent as ReactTouchEvent } from 'react';
import type { ITerminalAddon, Terminal as XTermTerminal } from '@xterm/xterm';
import {
  decryptSecurePayload,
  encryptSecurePayload,
  ensureSecureSession,
  type SecureSession,
} from '@/lib/secure-channel';
import { MobileTerminalToolbar } from './terminal/MobileTerminalToolbar';
import { TerminalCopyOverlay } from './terminal/TerminalCopyOverlay';
import { getDefaultShortcutItems, getShortcutItemKey, resolveShortcutInput } from './terminal/shortcut-actions';
import {
  normalizeCustomShortcutDraft,
  readStoredShortcutItems,
  writeStoredShortcutItems,
} from './terminal/shortcut-storage';
import { readTerminalBufferText } from './terminal/terminal-buffer';
import { focusTerminal } from './terminal/terminal-focus';
import { registerOsc52ClipboardHandler } from './terminal/osc52-clipboard';
import {
  isMobileTerminalTouch,
  setupMobileTouchScroll,
  shouldIgnoreTouchTarget,
} from './terminal/touch-scroll';
import type {
  BuiltInShortcutItem,
  ServerMessage,
  ShortcutActionId,
  ShortcutItem,
  TerminalTarget,
} from './terminal/types';

const TARGET_STORAGE_KEY = 'webTerminal-custom-node';
const SESSION_STORAGE_PREFIX = 'webTerminal-terminal-session:';
const CLIENT_KEEPALIVE_MS = 20_000;
const INPUT_FLUSH_MS = 16;
const MAX_INPUT_BUFFER_CHARS = 64 * 1024;
const MAX_WS_BUFFERED_AMOUNT = 256 * 1024;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<(ITerminalAddon & { fit: () => void }) | null>(null);
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

  useEffect(() => {
    if (!containerRef.current || !storageLoaded || needsPassword) return;

    let disposed = false;
    let cleanup = () => {};

    async function startTerminal() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (disposed || !containerRef.current) return;

      const terminalContainer = containerRef.current;

      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: 14,
        scrollback: 5000,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        theme: {
          background: '#0f1419',
          foreground: '#d6deeb',
          cursor: '#f8f8f2',
          selectionBackground: '#34495e',
        },
      });
      const fitAddon = new FitAddon();

      term.loadAddon(fitAddon);
      term.open(terminalContainer);
      fitAddon.fit();
      focusTerminal(term);
      const disposeOsc52 = registerOsc52ClipboardHandler(term);
      const disposeTouchScroll = setupMobileTouchScroll(terminalContainer, term);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      const sessionNodeName = sessionTarget?.name || nodeName;
      const sessionStorageKey = getSessionStorageKey(sessionTarget);

      if (!sessionTarget) {
        term.writeln('Missing SSH target. Return to the home page and enter node information again.');
        cleanup = () => {
          disposeTouchScroll.dispose();
          disposeOsc52.dispose();
          term.dispose();
        };
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      let secureSession: SecureSession;
      let pendingInput = '';

      term.writeln(`Connecting to ${sessionNodeName}...`);

      try {
        secureSession = await ensureSecureSession();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Secure channel failed';
        term.writeln(`\r\n[ERROR] ${message}`);
        cleanup = () => {
          disposeTouchScroll.dispose();
          disposeOsc52.dispose();
          term.dispose();
        };
        return;
      }

      if (disposed) {
        disposeTouchScroll.dispose();
        disposeOsc52.dispose();
        term.dispose();
        return;
      }

      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
      wsRef.current = ws;
      let serverSequence = 0;
      let sendQueue = Promise.resolve();
      let receiveQueue = Promise.resolve();

      const sendMessageNow = async (payload: unknown) => {
        const activeWs = wsRef.current;
        if (disposed || activeWs?.readyState !== WebSocket.OPEN) return;
        const encrypted = await encryptSecurePayload(secureSession, 'ws:client', payload);
        activeWs.send(JSON.stringify(encrypted));
      };

      const enqueueMessage = (payload: unknown) => {
        sendQueue = sendQueue
          .catch(() => {})
          .then(() => sendMessageNow(payload))
          .catch((caught) => {
            const message = caught instanceof Error ? caught.message : 'Secure send failed';
            term.writeln(`\r\n[ERROR] ${message}`);
            ws.close();
          });
        return sendQueue;
      };

      const flushInput = () => {
        const activeWs = wsRef.current;
        if (!pendingInput || activeWs?.readyState !== WebSocket.OPEN) return;
        if (activeWs.bufferedAmount > MAX_WS_BUFFERED_AMOUNT) return;

        const data = pendingInput;
        pendingInput = '';
        void enqueueMessage({ type: 'input', data });
      };

      const inputFlushTimer = window.setInterval(flushInput, INPUT_FLUSH_MS);
      const keepaliveTimer = window.setInterval(() => {
        void enqueueMessage({ type: 'ping' });
      }, CLIENT_KEEPALIVE_MS);

      ws.onopen = () => {
        void (async () => {
          fitAddon.fit();
          focusTerminal(term);
          const cols = term.cols || 120;
          const rows = term.rows || 30;
          const resumeSessionId = sessionStorageKey
            ? window.sessionStorage.getItem(sessionStorageKey) || undefined
            : undefined;

          await enqueueMessage({ type: 'auth' });
          await enqueueMessage({
            type: 'init',
            target: sessionTarget,
            resumeSessionId,
            cols,
            rows,
          });
          flushInput();
        })();
      };

      ws.onmessage = (event) => {
        receiveQueue = receiveQueue
          .catch(() => {})
          .then(async () => {
            const encrypted = JSON.parse(event.data);
            const decrypted = await decryptSecurePayload<ServerMessage>(
              secureSession,
              encrypted,
              'ws:server',
              serverSequence
            );
            serverSequence = decrypted.sequence;
            const msg = decrypted.payload;

            if (msg.type === 'ready') {
              return;
            }
            if (msg.type === 'output') {
              term.write(msg.data);
            } else if (msg.type === 'session') {
              if (sessionStorageKey) {
                window.sessionStorage.setItem(sessionStorageKey, msg.sessionId);
              }
              focusTerminal(term);
            } else if (msg.type === 'pong') {
              return;
            } else if (msg.type === 'status') {
              term.writeln(`\r\n[${msg.message}]`);
            } else if (msg.type === 'error') {
              term.writeln(`\r\n[ERROR] ${msg.message}`);
            }
          })
          .catch((caught) => {
            const message = caught instanceof Error ? caught.message : 'Secure receive failed';
            term.writeln(`\r\n[ERROR] ${message}`);
            ws.close();
          });
      };

      ws.onclose = () => {
        term.writeln('\r\n[Disconnected]');
      };

      const disposeData = term.onData((data) => {
        if (pendingInput.length + data.length > MAX_INPUT_BUFFER_CHARS) {
          pendingInput = pendingInput.slice(-Math.floor(MAX_INPUT_BUFFER_CHARS / 2));
        }
        pendingInput += data;
        flushInput();
      });

      let resizeFrame = 0;
      const onResize = () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          if (!fitAddonRef.current || !termRef.current || !wsRef.current) return;
          fitAddonRef.current.fit();
          if (wsRef.current.readyState !== WebSocket.OPEN) return;
          void enqueueMessage({
            type: 'resize',
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          });
        });
      };

      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(terminalContainer);
      window.addEventListener('resize', onResize);

      cleanup = () => {
        window.clearInterval(inputFlushTimer);
        window.clearInterval(keepaliveTimer);
        window.cancelAnimationFrame(resizeFrame);
        resizeObserver.disconnect();
        window.removeEventListener('resize', onResize);
        disposeData.dispose();
        disposeTouchScroll.dispose();
        disposeOsc52.dispose();
        ws.close();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
        wsRef.current = null;
      };
    }

    startTerminal();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [needsPassword, nodeName, sessionTarget, storageLoaded]);

  const sendShortcutItem = useCallback((item: ShortcutItem) => {
    const term = termRef.current;
    if (!term) return;

    const input = resolveShortcutInput(item, term);

    if (!input) return;

    term.input(input, true);
    focusTerminal(term);
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
    const term = termRef.current;
    if (term) {
      focusTerminal(term);
    }
  }, []);

  const submitPaste = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!pasteText) {
        pasteInputRef.current?.focus();
        return;
      }

      const term = termRef.current;
      if (term) {
        term.paste(pasteText);
      }

      setPasteText('');
      setPastePanelOpen(false);
      if (term) {
        focusTerminal(term);
      }
    },
    [pasteText]
  );

  const openCopyMode = useCallback(() => {
    const term = termRef.current;
    if (!term) return;

    setPastePanelOpen(false);
    setShortcutEditorOpen(false);
    setCopyModeText(readTerminalBufferText(term));
    setCopyModeOpen(true);
    term.blur();
  }, []);

  const closeCopyMode = useCallback(() => {
    setCopyModeOpen(false);
    setCopyModeText('');
    const term = termRef.current;
    if (term) {
      focusTerminal(term);
    }
  }, []);

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

function getSessionStorageKey(target?: TerminalTarget) {
  if (target) {
    return `${SESSION_STORAGE_PREFIX}target:${target.username}@${target.host}:${target.port}`;
  }

  return undefined;
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
