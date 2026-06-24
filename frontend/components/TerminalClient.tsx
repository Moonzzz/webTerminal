'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ITerminalAddon, Terminal as XTermTerminal } from '@xterm/xterm';
import {
  decryptSecurePayload,
  encryptSecurePayload,
  ensureSecureSession,
  type SecureSession,
} from '@/lib/secure-channel';

const TARGET_STORAGE_KEY = 'webTerminal-custom-node';
const SESSION_STORAGE_PREFIX = 'webTerminal-terminal-session:';
const CLIENT_KEEPALIVE_MS = 20_000;
const INPUT_FLUSH_MS = 16;
const MAX_INPUT_BUFFER_CHARS = 64 * 1024;
const MAX_WS_BUFFERED_AMOUNT = 256 * 1024;
const OSC_52_CLIPBOARD = 52;
const MAX_OSC_52_CLIPBOARD_CHARS = 1024 * 1024;

type TerminalTarget = {
  host: string;
  port: number;
  username: string;
  password?: string;
  name?: string;
};

type Props = {
  nodeName: string;
  useStoredTarget?: boolean;
};

type ServerMessage =
  | { type: 'ready' }
  | { type: 'session'; sessionId: string; resumed?: boolean }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'output'; data: string }
  | { type: 'pong'; ts: number };

export default function TerminalClient({
  nodeName,
  useStoredTarget = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<(ITerminalAddon & { fit: () => void }) | null>(null);
  const [storedTarget, setStoredTarget] = useState<TerminalTarget | undefined>();
  const [storageLoaded, setStorageLoaded] = useState(!useStoredTarget);
  const [passwordInput, setPasswordInput] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
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

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      const sessionNodeName = sessionTarget?.name || nodeName;
      const sessionStorageKey = getSessionStorageKey(sessionTarget);

      if (!sessionTarget) {
        term.writeln('Missing SSH target. Return to the home page and enter node information again.');
        cleanup = () => {
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
          disposeOsc52.dispose();
          term.dispose();
        };
        return;
      }

      if (disposed) {
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
      <div ref={containerRef} className="terminal-container" />
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

function focusTerminal(term: XTermTerminal) {
  window.requestAnimationFrame(() => {
    term.focus();
  });
}

function registerOsc52ClipboardHandler(term: XTermTerminal) {
  return term.parser.registerOscHandler(OSC_52_CLIPBOARD, async (data) => {
    const clipboardText = parseOsc52ClipboardText(data);
    if (clipboardText === undefined) {
      return false;
    }

    await writeTextToClipboard(clipboardText);
    return true;
  });
}

function parseOsc52ClipboardText(data: string) {
  const separatorIndex = data.indexOf(';');
  if (separatorIndex < 0) return undefined;

  const encodedText = data.slice(separatorIndex + 1).trim();
  if (!encodedText || encodedText === '?') return undefined;

  try {
    const decoded = decodeBase64Utf8(encodedText);
    if (decoded.length > MAX_OSC_52_CLIPBOARD_CHARS) {
      return decoded.slice(0, MAX_OSC_52_CLIPBOARD_CHARS);
    }

    return decoded;
  } catch {
    return undefined;
  }
}

function decodeBase64Utf8(value: string) {
  const binary = window.atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

async function writeTextToClipboard(text: string) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back to the legacy copy path below when the async Clipboard API is denied.
  }

  copyTextWithHiddenTextarea(text);
}

function copyTextWithHiddenTextarea(text: string) {
  const activeElement = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  try {
    textarea.select();
    document.execCommand('copy');
  } finally {
    textarea.remove();

    if (activeElement instanceof HTMLElement) {
      activeElement.focus({ preventScroll: true });
    }
  }
}
