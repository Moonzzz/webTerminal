'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ITerminalAddon, Terminal as XTermTerminal } from '@xterm/xterm';
import {
  decryptSecurePayload,
  encryptSecurePayload,
  ensureSecureSession,
  type SecureSession,
} from '@/lib/secure-channel';
import { registerOsc52ClipboardHandler } from './osc52-clipboard';
import { resolveShortcutInput } from './shortcut-actions';
import { readTerminalBufferText } from './terminal-buffer';
import { focusTerminal as focusXterm } from './terminal-focus';
import { setupMobileTouchScroll } from './touch-scroll';
import type { ServerMessage, ShortcutItem, TerminalTarget } from './types';

const CLIENT_KEEPALIVE_MS = 20_000;
const INPUT_FLUSH_MS = 16;
const MAX_INPUT_BUFFER_CHARS = 64 * 1024;
const MAX_WS_BUFFERED_AMOUNT = 256 * 1024;
const SESSION_STORAGE_PREFIX = 'webTerminal-terminal-session:';

type UseTerminalSessionParams = {
  nodeName: string;
  storageLoaded: boolean;
  needsPassword: boolean;
  sessionTarget?: TerminalTarget;
};

export function useTerminalSession({
  needsPassword,
  nodeName,
  sessionTarget,
  storageLoaded,
}: UseTerminalSessionParams) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<(ITerminalAddon & { fit: () => void }) | null>(null);
  const resizeTerminalRef = useRef<() => void>(() => {});

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
      focusXterm(term);
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
          focusXterm(term);
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
              focusXterm(term);
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
      resizeTerminalRef.current = onResize;
      window.addEventListener('resize', onResize);

      cleanup = () => {
        window.clearInterval(inputFlushTimer);
        window.clearInterval(keepaliveTimer);
        window.cancelAnimationFrame(resizeFrame);
        resizeObserver.disconnect();
        resizeTerminalRef.current = () => {};
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

  const sendShortcutItem = useCallback((item: ShortcutItem, options?: { preserveFocus?: boolean }) => {
    const term = termRef.current;
    if (!term) return;

    const input = resolveShortcutInput(item, term);

    if (!input) return;

    term.input(input, true);
    if (!options?.preserveFocus) {
      focusXterm(term);
    }
  }, []);

  const pasteText = useCallback((text: string) => {
    const term = termRef.current;
    if (term) {
      term.paste(text);
    }
  }, []);

  const focusTerminal = useCallback(() => {
    const term = termRef.current;
    if (term) {
      focusXterm(term);
    }
  }, []);

  const resizeTerminal = useCallback(() => {
    resizeTerminalRef.current();
  }, []);

  const readCopyText = useCallback(() => {
    const term = termRef.current;
    if (!term) return undefined;
    return readTerminalBufferText(term);
  }, []);

  const blurTerminal = useCallback(() => {
    termRef.current?.blur();
  }, []);

  return {
    blurTerminal,
    containerRef,
    focusTerminal,
    pasteText,
    readCopyText,
    resizeTerminal,
    sendShortcutItem,
  };
}

function getSessionStorageKey(target?: TerminalTarget) {
  if (target) {
    return `${SESSION_STORAGE_PREFIX}target:${target.username}@${target.host}:${target.port}`;
  }

  return undefined;
}
