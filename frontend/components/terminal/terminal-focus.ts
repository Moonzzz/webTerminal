import type { Terminal as XTermTerminal } from '@xterm/xterm';

export function focusTerminal(term: XTermTerminal) {
  window.requestAnimationFrame(() => {
    term.focus();
  });
}
