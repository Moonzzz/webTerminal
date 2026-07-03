import type { Terminal as XTermTerminal } from '@xterm/xterm';

const OSC_52_CLIPBOARD = 52;
const MAX_OSC_52_CLIPBOARD_CHARS = 1024 * 1024;

export function registerOsc52ClipboardHandler(term: XTermTerminal) {
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
