'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal as XTermTerminal } from '@xterm/xterm';
import { registerOsc52ClipboardHandler } from './osc52-clipboard';
import { resolveShortcutInput } from './shortcut-actions';
import { readTerminalBufferText } from './terminal-buffer';
import { focusTerminal as focusXterm } from './terminal-focus';
import { setupMobileTouchScroll } from './touch-scroll';
import type { ShortcutItem, TerminalTarget } from './types';
import { TerminalRestoreController } from './terminal-restore-controller';
import { SecureTerminalTransport } from './secure-terminal-transport';

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
  const controllerRef = useRef<TerminalRestoreController | null>(null);

  useEffect(() => {
    if (!containerRef.current || !storageLoaded || needsPassword) return;
    setTerminalReady(false);
    setConnectionStatus('正在连接…');
    let disposed = false;
    const resources: Array<() => void> = [];
    const cleanup = () => {
      for (const release of resources.splice(0).reverse()) release();
    };

    async function startTerminal() {
      if (!sessionTarget) {
        setConnectionStatus('缺少 SSH 目标，请返回首页重新输入节点信息。');
        return;
      }
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'), import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;
      const terminalContainer = containerRef.current;
      const term = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: 14,
        scrollback: 5000,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        theme: {
          background: '#0f1419', foreground: '#d6deeb', cursor: '#f8f8f2', selectionBackground: '#34495e',
        },
      });
      termRef.current = term;
      resources.push(() => { term.dispose(); termRef.current = null; });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainer);
      fitAddon.fit();

      const sessionStorageKey = getSessionStorageKey(sessionTarget);
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const controller = new TerminalRestoreController({
        terminal: term,
        send: (message) => transport.send(message),
        onInput: (data) => transport.input(data),
        proposeDimensions: () => fitAddon.proposeDimensions(),
        onPhaseChange: (phase) => {
          if (disposed) return;
          if (phase === 'parsing-snapshot') {
            setTerminalReady(false);
            setConnectionStatus('正在恢复终端…');
          } else if (phase === 'interactive') {
            setTerminalReady(true);
            setConnectionStatus('');
            fitAddon.fit();
            focusXterm(term);
          }
        },
      });
      controllerRef.current = controller;
      resources.push(() => { controller.close(); controllerRef.current = null; });
      // No user keyboard input may be mistaken for a parser reply during recovery.
      term.attachCustomKeyEventHandler(() => controller.interactive && transport.isOpen);
      const dataListener = term.onData((data) => controller.onTerminalData(data));
      const clipboard = registerOsc52ClipboardHandler(term, () => controller.acceptsSideEffects);
      const touchScroll = setupMobileTouchScroll(terminalContainer, term);
      resources.push(() => { dataListener.dispose(); clipboard.dispose(); touchScroll.dispose(); });

      const transport = new SecureTerminalTransport({
        url: `${protocol}://${window.location.host}/ws/terminal`,
        onOpen: async () => {
          fitAddon.fit();
          const resumeSessionId = window.sessionStorage.getItem(sessionStorageKey) || undefined;
          await transport.send({ type: 'auth' });
          await transport.send({ type: 'init', target: { ...sessionTarget, password: sessionTarget.password || '' },
            resumeSessionId, cols: term.cols || 120, rows: term.rows || 30 });
        },
        onMessage: async (message) => {
          if (disposed) return;
          switch (message.type) {
            case 'restore': case 'restored': case 'output':
              await controller.handle(message);
              break;
            case 'session':
              window.sessionStorage.setItem(sessionStorageKey, message.sessionId);
              setConnectionStatus(message.resumed ? '正在恢复会话…' : '正在建立会话…');
              break;
            case 'status':
              if (!controller.interactive) setConnectionStatus(message.message);
              break;
            case 'error':
              setConnectionStatus(`错误：${message.message}`);
              break;
          }
        },
        onError: (error) => {
          controller.close();
          if (!disposed) {
            setTerminalReady(controller.hasSnapshot);
            setConnectionStatus(`错误：${error.message}`);
          }
        },
        onClose: () => {
          controller.close();
          if (!disposed) {
            setTerminalReady(controller.hasSnapshot);
            setConnectionStatus((current) => current.startsWith('错误：') ? current : '连接已断开，可刷新页面恢复会话。');
          }
        },
      });
      resources.push(() => transport.dispose());

      let resizeFrame = 0;
      const observer = new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          if (!disposed && controller.interactive && transport.isOpen) fitAddon.fit();
        });
      });
      observer.observe(terminalContainer);
      const resizeListener = term.onResize(({ cols, rows }) => {
        if (controller.interactive) void transport.send({ type: 'resize', cols, rows });
      });
      resources.push(() => {
        window.cancelAnimationFrame(resizeFrame);
        observer.disconnect();
        resizeListener.dispose();
      });
      setConnectionStatus(`正在连接 ${sessionTarget.name || nodeName}…`);
      await transport.connect();
    }

    void startTerminal().catch((error: unknown) => {
      if (!disposed) setConnectionStatus(`错误：${error instanceof Error ? error.message : '终端初始化失败'}`);
      cleanup();
    });
    return () => { disposed = true; cleanup(); };
  }, [needsPassword, nodeName, sessionTarget, storageLoaded]);

  const sendShortcutItem = useCallback((item: ShortcutItem, options?: { preserveFocus?: boolean }) => {
    const term = termRef.current;
    if (!term || !controllerRef.current?.interactive) return;

    const input = resolveShortcutInput(item, term);

    if (!input) return;

    term.input(input, true);
    if (!options?.preserveFocus) {
      focusXterm(term);
    }
  }, []);

  const pasteText = useCallback((text: string) => {
    const term = termRef.current;
    if (term && controllerRef.current?.interactive) {
      term.paste(text);
    }
  }, []);

  const focusTerminal = useCallback(() => {
    const term = termRef.current;
    if (term && controllerRef.current?.interactive) {
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

function getSessionStorageKey(target: TerminalTarget) {
  return `${SESSION_STORAGE_PREFIX}target:${target.username}@${target.host}:${target.port}`;
}
