'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { ITerminalAddon, Terminal as XTermTerminal } from '@xterm/xterm';
import { MobileTerminalToolbar } from '../MobileTerminalToolbar';
import { getDefaultShortcutItems, resolveShortcutInput } from '../shortcut-actions';
import type { ShortcutActionId, ShortcutItem } from '../types';
import { setupMobileTouchScroll } from '../touch-scroll';

type ResizeTerminal = () => void;

type TerminalTestMetrics = {
  cols: number;
  rows: number;
  wheelCount: number;
  wheelDeltaY: number;
  viewportY: number;
  baseY: number;
  scrollEvents: number;
  shortcutSentCount: number;
  lastShortcutInput: string;
  resizeCount: number;
};

type TerminalTestControls = {
  resetMetrics: () => void;
  scrollToBottom: () => void;
  refit: () => void;
};

declare global {
  interface Window {
    __terminalTestMetrics?: TerminalTestMetrics;
    __terminalTestControls?: TerminalTestControls;
  }
}

const TEST_LINE_COUNT = 360;
const SYNTHETIC_WHEEL_LINE_HEIGHT_PX = 18;
const EXTRA_SHORTCUT_ITEMS: ShortcutItem[] = [
  { type: 'built-in', actionId: 'ctrl-d' },
  { type: 'built-in', actionId: 'ctrl-z' },
  { type: 'built-in', actionId: 'ctrl-l' },
  { type: 'built-in', actionId: 'ctrl-u' },
  { type: 'built-in', actionId: 'enter' },
  { type: 'built-in', actionId: 'backspace' },
  { type: 'built-in', actionId: 'home' },
  { type: 'built-in', actionId: 'end' },
  { type: 'built-in', actionId: 'page-up' },
  { type: 'built-in', actionId: 'page-down' },
  { type: 'custom', id: 'custom-alpha', label: 'Alpha', input: 'alpha' },
  { type: 'custom', id: 'custom-beta', label: 'Beta', input: 'beta' },
];

export function TerminalTestHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<(ITerminalAddon & { fit: () => void }) | null>(null);
  const pasteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeTerminalRef = useRef<ResizeTerminal>(() => {});
  const shortcutItems = useMemo(
    () => [...getDefaultShortcutItems(), ...EXTRA_SHORTCUT_ITEMS],
    []
  );
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    window.__terminalTestMetrics = createInitialMetrics();

    return () => {
      delete window.__terminalTestMetrics;
      delete window.__terminalTestControls;
    };
  }, []);

  useEffect(() => {
    const pageElement = containerRef.current?.closest<HTMLElement>('.terminal-page');
    const visualViewport = window.visualViewport;
    if (!pageElement || !visualViewport) return;

    let resizeFrame = 0;
    const updateVisualViewport = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        pageElement.style.setProperty(
          '--terminal-visual-viewport-top',
          `${visualViewport.offsetTop}px`
        );
        pageElement.style.setProperty(
          '--terminal-visual-viewport-height',
          `${visualViewport.height}px`
        );
        pageElement.style.setProperty(
          '--terminal-visual-viewport-width',
          `${visualViewport.width}px`
        );
        resizeTerminalRef.current();
      });
    };

    updateVisualViewport();
    visualViewport.addEventListener('resize', updateVisualViewport);
    visualViewport.addEventListener('scroll', updateVisualViewport);

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      visualViewport.removeEventListener('resize', updateVisualViewport);
      visualViewport.removeEventListener('scroll', updateVisualViewport);
      pageElement.style.removeProperty('--terminal-visual-viewport-top');
      pageElement.style.removeProperty('--terminal-visual-viewport-height');
      pageElement.style.removeProperty('--terminal-visual-viewport-width');
    };
  }, []);

  useEffect(() => {
    const terminalContainer = containerRef.current;
    if (!terminalContainer) return;

    let disposed = false;
    let resizeFrame = 0;

    async function startTerminal(terminalElement: HTMLDivElement) {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (disposed || !terminalElement.isConnected) return;

      const term = new Terminal({
        cursorBlink: false,
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
      term.open(terminalElement);
      fitAddon.fit();

      const disposeTouchScroll = setupMobileTouchScroll(terminalElement, term);
      const disposeScroll = term.onScroll(() => {
        const metrics = ensureMetrics();
        metrics.scrollEvents += 1;
        updateMetricsFromTerminal(term);
      });

      const onWheel = (event: WheelEvent) => {
        const metrics = ensureMetrics();
        metrics.wheelCount += 1;
        metrics.wheelDeltaY += event.deltaY;
        mirrorSyntheticWheelIfNeeded(term, event);
      };

      const onResize = () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          fitAddon.fit();
          const metrics = ensureMetrics();
          metrics.resizeCount += 1;
          updateMetricsFromTerminal(term);
        });
      };

      terminalElement.addEventListener('wheel', onWheel, { capture: true });
      window.addEventListener('resize', onResize);
      resizeTerminalRef.current = onResize;
      window.__terminalTestControls = {
        resetMetrics: () => {
          window.__terminalTestMetrics = createInitialMetrics();
          updateMetricsFromTerminal(term);
        },
        scrollToBottom: () => {
          term.scrollToBottom();
          updateMetricsFromTerminal(term);
        },
        refit: onResize,
      };

      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(terminalElement);

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      writeTestLines(term, () => {
        if (disposed) return;

        term.scrollToBottom();
        updateMetricsFromTerminal(term);
      });

      return () => {
        window.cancelAnimationFrame(resizeFrame);
        resizeObserver.disconnect();
        window.removeEventListener('resize', onResize);
        terminalElement.removeEventListener('wheel', onWheel, { capture: true });
        resizeTerminalRef.current = () => {};
        delete window.__terminalTestControls;
        disposeScroll.dispose();
        disposeTouchScroll.dispose();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }

    let cleanup: (() => void) | undefined;
    startTerminal(terminalContainer).then((dispose) => {
      cleanup = dispose;
      if (disposed) {
        cleanup?.();
      }
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const sendShortcutItem = useCallback((item: ShortcutItem) => {
    const term = termRef.current;
    if (!term) return;

    const input = resolveShortcutInput(item, term);
    if (!input) return;

    const metrics = ensureMetrics();
    metrics.shortcutSentCount += 1;
    metrics.lastShortcutInput = input;
    term.input(input, true);
  }, []);

  const noopFormSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  }, []);

  const noopShortcutToggle = useCallback((_actionId: ShortcutActionId) => {}, []);

  return (
    <div className="terminal-client" data-testid="terminal-test-harness">
      <div ref={containerRef} className="terminal-container" data-testid="terminal-container" />
      <MobileTerminalToolbar
        shortcutItems={shortcutItems}
        customShortcutError=""
        customShortcutInput=""
        customShortcutLabel=""
        isEditorOpen={false}
        isPasteOpen={false}
        pasteInputRef={pasteInputRef}
        pasteText={pasteText}
        onAddCustomShortcut={noopFormSubmit}
        onClosePaste={() => {}}
        onCustomShortcutInputChange={() => {}}
        onCustomShortcutLabelChange={() => {}}
        onMoveShortcut={() => {}}
        onOpenCopy={() => {}}
        onOpenPaste={() => {}}
        onPasteSubmit={noopFormSubmit}
        onPasteTextChange={setPasteText}
        onRemoveCustomShortcut={() => {}}
        onResetShortcuts={() => {}}
        onShortcutPress={sendShortcutItem}
        onToggleEditor={() => {}}
        onToggleShortcut={noopShortcutToggle}
      />
    </div>
  );
}

function createInitialMetrics(): TerminalTestMetrics {
  return {
    cols: 0,
    rows: 0,
    wheelCount: 0,
    wheelDeltaY: 0,
    viewportY: 0,
    baseY: 0,
    scrollEvents: 0,
    shortcutSentCount: 0,
    lastShortcutInput: '',
    resizeCount: 0,
  };
}

function ensureMetrics() {
  if (!window.__terminalTestMetrics) {
    window.__terminalTestMetrics = createInitialMetrics();
  }

  return window.__terminalTestMetrics;
}

function writeTestLines(term: XTermTerminal, callback: () => void) {
  const lines: string[] = [];

  for (let index = 1; index <= TEST_LINE_COUNT; index += 1) {
    lines.push(`test line ${String(index).padStart(3, '0')} ${'0123456789abcdef'.repeat(8)}`);
  }

  term.write(`${lines.join('\r\n')}\r\n`, callback);
}

function updateMetricsFromTerminal(term: XTermTerminal) {
  const metrics = ensureMetrics();
  const buffer = term.buffer.active;

  metrics.cols = term.cols;
  metrics.rows = term.rows;
  metrics.viewportY = buffer.viewportY;
  metrics.baseY = buffer.baseY;
}

function mirrorSyntheticWheelIfNeeded(term: XTermTerminal, event: WheelEvent) {
  if (event.isTrusted || event.deltaY === 0) return;

  const viewportYBefore = term.buffer.active.viewportY;
  window.requestAnimationFrame(() => {
    if (term.buffer.active.viewportY !== viewportYBefore) {
      updateMetricsFromTerminal(term);
      return;
    }

    const lines = Math.trunc(event.deltaY / SYNTHETIC_WHEEL_LINE_HEIGHT_PX);
    if (!lines) return;

    term.scrollLines(lines);
    updateMetricsFromTerminal(term);
  });
}
