'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal as XTermTerminal } from '@xterm/xterm';
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
  const [connectionStatus, setConnectionStatus] = useState('正在连接…');
  const [terminalReady, setTerminalReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current || !storageLoaded || needsPassword) return;

    setTerminalReady(false);
    setConnectionStatus('正在连接…');
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
      let sessionInitialized = false;
      let connectionClosed = false;
      const disposeOsc52 = registerOsc52ClipboardHandler(term, () => sessionInitialized);
      const disposeTouchScroll = setupMobileTouchScroll(terminalContainer, term);

      termRef.current = term;
      cleanup = () => {
        disposeTouchScroll.dispose();
        disposeOsc52.dispose();
        term.dispose();
        termRef.current = null;
      };

      const sessionNodeName = sessionTarget?.name || nodeName;
      const sessionStorageKey = getSessionStorageKey(sessionTarget);

      if (!sessionTarget) {
        setConnectionStatus('缺少 SSH 目标，请返回首页重新输入节点信息。');
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      let secureSession: SecureSession;
      let pendingInput = '';

      setConnectionStatus(`正在连接 ${sessionNodeName}…`);

      try {
        secureSession = await ensureSecureSession();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Secure channel failed';
        if (!disposed) setConnectionStatus(`错误：${message}`);
        return;
      }

      if (disposed) return;

      const ws = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
      wsRef.current = ws;
      let serverSequence = 0;
      let sendQueue = Promise.resolve();
      let receiveQueue = Promise.resolve();
      let outputSequence = 0;
      let restoreId = '';

      const sendMessageNow = async (payload: unknown) => {
        if (disposed || connectionClosed || ws.readyState !== WebSocket.OPEN) return;
        const encrypted = await encryptSecurePayload(secureSession, 'ws:client', payload);
        if (!disposed && !connectionClosed && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(encrypted));
        }
      };

      const enqueueMessage = (payload: unknown) => {
        sendQueue = sendQueue
          .catch(() => {})
          .then(() => sendMessageNow(payload))
          .catch((caught) => {
            const message = caught instanceof Error ? caught.message : 'Secure send failed';
            if (!disposed) setConnectionStatus(`错误：${message}`);
            ws.close();
          });
        return sendQueue;
      };

      const flushInput = () => {
        const activeWs = wsRef.current;
        if (!sessionInitialized || !pendingInput || activeWs?.readyState !== WebSocket.OPEN) return;
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
        })();
      };

      ws.onmessage = (event) => {
        receiveQueue = receiveQueue
          .catch(() => {})
          .then(async () => {
            if (disposed || connectionClosed) return;
            const encrypted = JSON.parse(event.data);
            const decrypted = await decryptSecurePayload<ServerMessage>(
              secureSession,
              encrypted,
              'ws:server',
              serverSequence
            );
            if (disposed || connectionClosed) return;
            serverSequence = decrypted.sequence;
            const msg = decrypted.payload;

            if (msg.type === 'ready') {
              return;
            }
            if (msg.type === 'restore') {
              sessionInitialized = false;
              setTerminalReady(false);
              setConnectionStatus('正在恢复终端…');
              restoreId = msg.restoreId;
              term.reset();
              term.options.scrollback = msg.scrollback;
              term.resize(msg.cols, msg.rows);
              await new Promise<void>((resolve) => term.write(msg.data, resolve));
              if (disposed || connectionClosed) return;
              outputSequence = msg.sequence;
              const dimensions = fitAddon.proposeDimensions();
              await enqueueMessage({ type: 'restore-ready', restoreId,
                cols: dimensions?.cols || term.cols, rows: dimensions?.rows || term.rows });
            } else if (msg.type === 'restored') {
              if (msg.restoreId !== restoreId) throw new Error('Unexpected restore acknowledgement');
              term.resize(msg.cols, msg.rows);
              sessionInitialized = true;
              setConnectionStatus('');
              setTerminalReady(true);
              fitAddon.fit();
              focusXterm(term);
            } else if (msg.type === 'output') {
              if (!restoreId || msg.sequence !== outputSequence + 1) {
                throw new Error('Terminal output sequence mismatch');
              }
              await new Promise<void>((resolve) => term.write(msg.data, resolve));
              outputSequence = msg.sequence;
            } else if (msg.type === 'session') {
              if (sessionStorageKey) {
                window.sessionStorage.setItem(sessionStorageKey, msg.sessionId);
              }
              setConnectionStatus(msg.resumed ? '正在恢复会话…' : '正在建立会话…');
            } else if (msg.type === 'pong') {
              return;
            } else if (msg.type === 'status') {
              if (!sessionInitialized) setConnectionStatus(msg.message);
            } else if (msg.type === 'error') {
              setConnectionStatus(`错误：${msg.message}`);
            }
          })
          .catch((caught) => {
            const message = caught instanceof Error ? caught.message : 'Secure receive failed';
            if (!disposed) setConnectionStatus(`错误：${message}`);
            ws.close();
          });
      };

      ws.onclose = () => {
        sessionInitialized = false;
        pendingInput = '';
        // A socket can close before its last encrypted messages finish parsing.
        void receiveQueue.finally(() => {
          connectionClosed = true;
          sessionInitialized = false;
          if (!disposed) {
            if (restoreId) setTerminalReady(true);
            setConnectionStatus((current) => current.startsWith('错误：') ? current : '连接已断开，可刷新页面恢复会话。');
          }
        });
      };

      const disposeData = term.onData((data) => {
        if (!sessionInitialized || disposed || connectionClosed || ws.readyState !== WebSocket.OPEN) return;
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
          if (!disposed && sessionInitialized) fitAddon.fit();
        });
      };

      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(terminalContainer);
      const disposeResize = term.onResize(({ cols, rows }) => {
        if (sessionInitialized && ws.readyState === WebSocket.OPEN) {
          void enqueueMessage({ type: 'resize', cols, rows });
        }
      });

      cleanup = () => {
        connectionClosed = true;
        sessionInitialized = false;
        window.clearInterval(inputFlushTimer);
        window.clearInterval(keepaliveTimer);
        window.cancelAnimationFrame(resizeFrame);
        resizeObserver.disconnect();
        disposeResize.dispose();
        disposeData.dispose();
        disposeTouchScroll.dispose();
        disposeOsc52.dispose();
        ws.close();
        term.dispose();
        termRef.current = null;
        wsRef.current = null;
      };
    }

    void startTerminal().catch((error: unknown) => {
      if (!disposed) setConnectionStatus(`错误：${error instanceof Error ? error.message : '终端初始化失败'}`);
      cleanup();
    });

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

  const readCopyText = useCallback(() => {
    const term = termRef.current;
    if (!term) return undefined;
    return readTerminalBufferText(term);
  }, []);

  const blurTerminal = useCallback(() => {
    termRef.current?.blur();
  }, []);

  return {
    connectionStatus,
    terminalReady,
    blurTerminal,
    containerRef,
    focusTerminal,
    pasteText,
    readCopyText,
    sendShortcutItem,
  };
}

function getSessionStorageKey(target?: TerminalTarget) {
  if (target) {
    return `${SESSION_STORAGE_PREFIX}target:${target.username}@${target.host}:${target.port}`;
  }

  return undefined;
}
