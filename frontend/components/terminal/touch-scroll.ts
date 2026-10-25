import type { Terminal as XTermTerminal } from '@xterm/xterm';

const TOUCH_SCROLL_START_PX = 12;
const TOUCH_SCROLL_WHEEL_SCALE = 2.4;
const TOUCH_SCROLL_MOMENTUM_MIN_VELOCITY = 0.32;
const TOUCH_SCROLL_MOMENTUM_FRICTION = 0.88;
const TOUCH_SCROLL_MOMENTUM_FRAME_MS = 16;
const TOUCH_SCROLL_MOMENTUM_MAX_DELTA = 90;
const TOUCH_SCROLL_DELTA_MAX = 120;

export function setupMobileTouchScroll(container: HTMLElement, term: XTermTerminal) {
  let tracking = false;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let lastMoveAt = 0;
  let velocityY = 0;
  let momentumFrame = 0;
  let verticalGesture = false;

  const stopMomentum = () => {
    if (!momentumFrame) return;
    window.cancelAnimationFrame(momentumFrame);
    momentumFrame = 0;
  };

  const reset = () => {
    tracking = false;
    verticalGesture = false;
    velocityY = 0;
    stopMomentum();
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
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    lastMoveAt = event.timeStamp || performance.now();
    velocityY = 0;
    verticalGesture = false;
    stopMomentum();
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
    const deltaY = touch.clientY - lastY;
    const movedAt = event.timeStamp || performance.now();
    const elapsed = Math.max(1, movedAt - lastMoveAt);
    lastY = touch.clientY;
    lastMoveAt = movedAt;

    if (!verticalGesture) {
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

      verticalGesture = true;
    }

    const scrollTarget = getXtermScrollTarget(container);
    if (!scrollTarget) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    velocityY = deltaY / elapsed;
    dispatchTerminalWheel(scrollTarget, deltaY);
  };

  const onTouchEnd = () => {
    if (verticalGesture) {
      startMomentum();
      tracking = false;
      verticalGesture = false;
      return;
    }

    reset();
  };

  const startMomentum = () => {
    const scrollTarget = getXtermScrollTarget(container);
    if (!scrollTarget || Math.abs(velocityY) < TOUCH_SCROLL_MOMENTUM_MIN_VELOCITY) {
      velocityY = 0;
      return;
    }

    let currentVelocity = velocityY;
    velocityY = 0;

    const step = () => {
      currentVelocity *= TOUCH_SCROLL_MOMENTUM_FRICTION;
      if (Math.abs(currentVelocity) < TOUCH_SCROLL_MOMENTUM_MIN_VELOCITY) {
        momentumFrame = 0;
        return;
      }

      const deltaY = clamp(
        currentVelocity * TOUCH_SCROLL_MOMENTUM_FRAME_MS,
        -TOUCH_SCROLL_MOMENTUM_MAX_DELTA,
        TOUCH_SCROLL_MOMENTUM_MAX_DELTA
      );
      dispatchTerminalWheel(scrollTarget, deltaY);
      momentumFrame = window.requestAnimationFrame(step);
    };

    momentumFrame = window.requestAnimationFrame(step);
  };

  const listenerOptions: AddEventListenerOptions = { passive: false, capture: true };
  container.addEventListener('touchstart', onTouchStart, listenerOptions);
  container.addEventListener('touchmove', onTouchMove, listenerOptions);
  container.addEventListener('touchend', onTouchEnd);
  container.addEventListener('touchcancel', reset);

  return {
    dispose() {
      stopMomentum();
      container.removeEventListener('touchstart', onTouchStart, listenerOptions);
      container.removeEventListener('touchmove', onTouchMove, listenerOptions);
      container.removeEventListener('touchend', onTouchEnd);
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

  if (target.closest('.xterm')) {
    return false;
  }

  return Boolean(
    target.closest('button, input, textarea, select, a, [contenteditable="true"], .mobile-terminal-bar')
  );
}

function getXtermScrollTarget(container: HTMLElement) {
  return (
    container.querySelector<HTMLElement>('.xterm-scrollable-element') ||
    container.querySelector<HTMLElement>('.xterm-screen') ||
    container.querySelector<HTMLElement>('.xterm-viewport')
  );
}

function dispatchTerminalWheel(target: HTMLElement, deltaY: number) {
  const clampedDeltaY = clamp(deltaY, -TOUCH_SCROLL_DELTA_MAX, TOUCH_SCROLL_DELTA_MAX);

  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaY: -clampedDeltaY * TOUCH_SCROLL_WHEEL_SCALE,
  });

  // Chromium gives synthetic events legacy wheel deltas with the opposite
  // convention to native events. Let xterm normalize the standard delta fields.
  Object.defineProperties(event, {
    wheelDeltaY: { value: undefined },
    wheelDeltaX: { value: undefined },
    wheelDelta: { value: undefined },
  });
  target.dispatchEvent(event);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
