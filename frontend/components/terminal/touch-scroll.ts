import type { Terminal as XTermTerminal } from '@xterm/xterm';

const TOUCH_SCROLL_LONG_PRESS_MS = 320;
const TOUCH_SCROLL_START_PX = 12;

export function setupMobileTouchScroll(container: HTMLElement, term: XTermTerminal) {
  let tracking = false;
  let scrolling = false;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let startedAt = 0;
  let residualLines = 0;

  const reset = () => {
    tracking = false;
    scrolling = false;
    residualLines = 0;
  };

  const onTouchStart = (event: TouchEvent) => {
    if (!isMobileTerminalTouch() || event.touches.length !== 1) {
      reset();
      return;
    }
    if (shouldIgnoreTouchTarget(event.target)) {
      reset();
      return;
    }

    const touch = event.touches[0];
    tracking = true;
    scrolling = false;
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    startedAt = Date.now();
    residualLines = 0;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!tracking || event.touches.length !== 1) {
      reset();
      return;
    }
    if (term.hasSelection()) {
      reset();
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaYFromStart = touch.clientY - startY;
    const elapsed = Date.now() - startedAt;

    if (!scrolling) {
      if (elapsed > TOUCH_SCROLL_LONG_PRESS_MS) {
        reset();
        return;
      }
      if (
        Math.abs(deltaX) > TOUCH_SCROLL_START_PX &&
        Math.abs(deltaX) > Math.abs(deltaYFromStart)
      ) {
        reset();
        return;
      }
      if (Math.abs(deltaYFromStart) < TOUCH_SCROLL_START_PX) {
        return;
      }

      scrolling = true;
    }

    const deltaY = touch.clientY - lastY;
    lastY = touch.clientY;

    const lineHeight = getTerminalLineHeight(container, term);
    const nextResidualLines = residualLines + -deltaY / lineHeight;
    const wholeLines =
      nextResidualLines > 0 ? Math.floor(nextResidualLines) : Math.ceil(nextResidualLines);

    if (wholeLines !== 0) {
      term.scrollLines(wholeLines);
      residualLines = nextResidualLines - wholeLines;
    } else {
      residualLines = nextResidualLines;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
  };

  const listenerOptions: AddEventListenerOptions = { passive: false };
  container.addEventListener('touchstart', onTouchStart, listenerOptions);
  container.addEventListener('touchmove', onTouchMove, listenerOptions);
  container.addEventListener('touchend', reset);
  container.addEventListener('touchcancel', reset);

  return {
    dispose() {
      container.removeEventListener('touchstart', onTouchStart, listenerOptions);
      container.removeEventListener('touchmove', onTouchMove, listenerOptions);
      container.removeEventListener('touchend', reset);
      container.removeEventListener('touchcancel', reset);
    },
  };
}

export function isMobileTerminalTouch() {
  return (
    window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 640px)').matches
  );
}

export function shouldIgnoreTouchTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest('button, input, textarea, select, a, [contenteditable="true"], .mobile-terminal-bar')
  );
}

function getTerminalLineHeight(container: HTMLElement, term: XTermTerminal) {
  const screenElement = container.querySelector<HTMLElement>('.xterm-screen');
  const screenHeight = screenElement?.clientHeight || container.clientHeight || 1;

  return Math.max(8, screenHeight / Math.max(term.rows, 1));
}
